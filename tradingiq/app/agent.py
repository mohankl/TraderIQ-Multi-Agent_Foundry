import uuid
from collections.abc import AsyncGenerator

from ag_ui.core import (
    EventType,
    RunFinishedEvent,
    RunStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from ag_ui.encoder import EventEncoder
from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential
from opentelemetry import trace

from app.config import settings
from app.event_mapper import MapperResult, map_foundry_stream

_credential = DefaultAzureCredential()
_project_client = AIProjectClient(
    endpoint=settings.azure_existing_aiproject_endpoint,
    credential=_credential,
)
_openai_client = _project_client.get_openai_client()
_tracer = trace.get_tracer("tradingiq.agent")


async def run_agent_stream(
    query: str,
    thread_id: str | None,
    run_id: str,
) -> AsyncGenerator[str]:
    """Call Foundry agent and stream AG-UI protocol events back to the client.

    Yields encoded SSE strings. thread_id carries the previous Foundry
    response_id for conversation continuity; None starts a fresh conversation.

    Most of the work is delegated to `event_mapper.map_foundry_stream`, which
    is pure (no clients, no tracing) and unit-tested. This function owns the
    Foundry call, the OpenTelemetry span, SSE encoding, and the fallback-
    message splice for runs that never produced text.
    """
    encoder = EventEncoder()

    yield encoder.encode(
        RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id or "", run_id=run_id)
    )

    with _tracer.start_as_current_span("agent.run") as span:
        span.set_attribute("agent.name", settings.azure_existing_agent_name)
        span.set_attribute("agent.version", settings.azure_existing_agent_version)
        span.set_attribute("run.id", run_id)
        if thread_id:
            span.set_attribute("previous_response_id", thread_id)

        kwargs: dict = {
            "input": [{"role": "user", "content": query}],
            "extra_body": {
                "agent_reference": {
                    "name": settings.azure_existing_agent_name,
                    "version": settings.azure_existing_agent_version,
                    "type": "agent_reference",
                }
            },
            "timeout": settings.run_timeout_seconds,
            "stream": True,
        }
        if thread_id and thread_id.startswith("resp_"):
            kwargs["previous_response_id"] = thread_id

        state = MapperResult(
            any_text_emitted=False,
            pending_approvals=[],
            final_response_id="",
        )
        had_error: Exception | None = None

        try:
            stream = _openai_client.responses.create(**kwargs)
            # Surface response.id to the tracer as soon as it arrives by
            # peeking at the events; the mapper already filters that type.
            def _tee_for_tracer(events):
                for ev in events:
                    if getattr(ev, "type", None) == "response.created":
                        rid = getattr(getattr(ev, "response", None), "id", None)
                        if rid:
                            span.set_attribute("response.id", rid)
                    yield ev

            for ag_event in map_foundry_stream(_tee_for_tracer(stream), state):
                yield encoder.encode(ag_event)

        except Exception as exc:
            had_error = exc
            span.record_exception(exc)

        # Splice a fallback message if the run produced no text at all.
        if not state.any_text_emitted:
            if state.pending_approvals:
                tools = ", ".join(f"`{t}`" for t in state.pending_approvals)
                fallback = (
                    f"This run is blocked: the agent wanted to call {tools}, "
                    "but those tools require approval. In the Microsoft Foundry "
                    "portal, open this agent's MCP settings and set the listed "
                    "tools to auto-approve (or approve them once). After saving "
                    "a new agent version, update the deployed version and try "
                    "again."
                )
                state.final_response_id = ""  # don't poison the thread
                span.set_attribute("run.blocked_on_approval", True)
            elif had_error is not None:
                fallback = f"Error: {had_error}"
            else:
                fallback = "Agent produced no text response."
            msg_id = str(uuid.uuid4())
            yield encoder.encode(
                TextMessageStartEvent(
                    type=EventType.TEXT_MESSAGE_START,
                    message_id=msg_id,
                    role="assistant",
                )
            )
            yield encoder.encode(
                TextMessageContentEvent(
                    type=EventType.TEXT_MESSAGE_CONTENT,
                    message_id=msg_id,
                    delta=fallback,
                )
            )
            yield encoder.encode(
                TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=msg_id)
            )

    yield encoder.encode(
        RunFinishedEvent(
            type=EventType.RUN_FINISHED,
            thread_id=state.final_response_id or (thread_id or ""),
            run_id=run_id,
        )
    )
