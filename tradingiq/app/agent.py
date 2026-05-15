import json
import uuid
from typing import Any, AsyncGenerator

from ag_ui.core import (
    CustomEvent,
    EventType,
    RunFinishedEvent,
    RunStartedEvent,
    StepFinishedEvent,
    StepStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)
from ag_ui.encoder import EventEncoder
from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential
from opentelemetry import trace

from app.config import settings

_credential = DefaultAzureCredential()
_project_client = AIProjectClient(
    endpoint=settings.azure_existing_aiproject_endpoint,
    credential=_credential,
)
_openai_client = _project_client.get_openai_client()
_tracer = trace.get_tracer("tradingiq.agent")


def _extract_render_payload(item: Any, tool_call_id: str | None) -> dict[str, Any] | None:
    """Decode an mcp_call.output string. If it's a self-describing
    {data, render} envelope, merge to flat payload and attach provenance.
    Otherwise return None — the tool didn't ask for inline UI."""
    raw = getattr(item, "output", None)
    if not isinstance(raw, str):
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    render = parsed.get("render")
    data = parsed.get("data")
    if not isinstance(render, dict) or not isinstance(data, dict):
        return None
    kind = render.get("kind")
    if not isinstance(kind, str) or not kind:
        return None
    merged: dict[str, Any] = {"kind": kind}
    for k, v in render.items():
        if k != "kind":
            merged[k] = v
    merged.update(data)
    if tool_call_id and "source_tool_call_id" not in merged:
        merged["source_tool_call_id"] = tool_call_id
    return merged


def _step_name_for_tool(name: str | None) -> str:
    """Human-readable step name for a Foundry MCP tool call."""
    return f"tool:{name}" if name else "tool"


async def run_agent_stream(
    query: str,
    thread_id: str | None,
    run_id: str,
) -> AsyncGenerator[str, None]:
    """Call Foundry agent and stream AG-UI protocol events back to the client.

    Yields encoded SSE strings. thread_id carries the previous Foundry
    response_id for conversation continuity; None starts a fresh conversation.

    Streaming flow (v10.2):
      RUN_STARTED
      [for each MCP tool call:
         STEP_STARTED("tool:<name>")
         (... agent thinks ...)
         CUSTOM ui.render (if envelope present)
         STEP_FINISHED("tool:<name>")]
      TEXT_MESSAGE_START
      TEXT_MESSAGE_CONTENT (× many small deltas)
      TEXT_MESSAGE_END
      RUN_FINISHED(thread_id=response.id)
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

        # Per-output-index state. Foundry assigns each item an output_index;
        # we use that to remember whether a given step is open and what the
        # tool name was when STEP_FINISHED arrives.
        open_steps: dict[int, str] = {}
        pending_approvals: list[str] = []
        answer_msg_id: str | None = None
        text_started = False  # is a TEXT_MESSAGE_START currently open
        any_text_emitted = False  # did we ever stream any text at all
        final_response_id = ""
        had_error: Exception | None = None

        try:
            stream = _openai_client.responses.create(**kwargs)
            for event in stream:
                etype = getattr(event, "type", None)

                if etype == "response.created":
                    rid = getattr(getattr(event, "response", None), "id", None)
                    if rid:
                        span.set_attribute("response.id", rid)

                elif etype == "response.output_item.added":
                    item = getattr(event, "item", None)
                    idx = getattr(event, "output_index", None)
                    it_type = getattr(item, "type", None)
                    if it_type == "mcp_call":
                        tool_name = getattr(item, "name", None) or "tool"
                        step_name = _step_name_for_tool(tool_name)
                        if isinstance(idx, int):
                            open_steps[idx] = step_name
                        yield encoder.encode(
                            StepStartedEvent(
                                type=EventType.STEP_STARTED,
                                step_name=step_name,
                            )
                        )
                    elif it_type == "mcp_approval_request":
                        name = getattr(item, "name", None)
                        if isinstance(name, str) and name and name not in pending_approvals:
                            pending_approvals.append(name)

                elif etype == "response.output_item.done":
                    item = getattr(event, "item", None)
                    idx = getattr(event, "output_index", None)
                    it_type = getattr(item, "type", None)
                    if it_type == "mcp_call":
                        tool_call_id = getattr(item, "id", None)
                        payload = _extract_render_payload(item, tool_call_id)
                        if payload is not None:
                            yield encoder.encode(
                                CustomEvent(
                                    type=EventType.CUSTOM,
                                    name="ui.render",
                                    value=payload,
                                )
                            )
                        step_name = (
                            open_steps.pop(idx, None)
                            if isinstance(idx, int)
                            else None
                        ) or _step_name_for_tool(getattr(item, "name", None))
                        yield encoder.encode(
                            StepFinishedEvent(
                                type=EventType.STEP_FINISHED,
                                step_name=step_name,
                            )
                        )
                    elif it_type == "message":
                        if text_started and answer_msg_id:
                            yield encoder.encode(
                                TextMessageEndEvent(
                                    type=EventType.TEXT_MESSAGE_END,
                                    message_id=answer_msg_id,
                                )
                            )
                            text_started = False

                elif etype == "response.output_text.delta":
                    delta = getattr(event, "delta", None)
                    if not isinstance(delta, str) or not delta:
                        continue
                    if not text_started:
                        answer_msg_id = str(uuid.uuid4())
                        yield encoder.encode(
                            TextMessageStartEvent(
                                type=EventType.TEXT_MESSAGE_START,
                                message_id=answer_msg_id,
                                role="assistant",
                            )
                        )
                        text_started = True
                        any_text_emitted = True
                    yield encoder.encode(
                        TextMessageContentEvent(
                            type=EventType.TEXT_MESSAGE_CONTENT,
                            message_id=answer_msg_id or "",
                            delta=delta,
                        )
                    )

                elif etype == "response.completed":
                    rid = getattr(getattr(event, "response", None), "id", None)
                    if rid:
                        final_response_id = rid

        except Exception as exc:
            had_error = exc
            span.record_exception(exc)

        # Close any straggling steps (defensive — shouldn't happen on a clean run)
        for step_name in list(open_steps.values()):
            yield encoder.encode(
                StepFinishedEvent(type=EventType.STEP_FINISHED, step_name=step_name)
            )
        open_steps.clear()

        # Close a still-open text stream defensively (rare — Foundry normally
        # closes the message item before response.completed).
        if text_started and answer_msg_id:
            yield encoder.encode(
                TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END,
                    message_id=answer_msg_id,
                )
            )
            text_started = False

        # If we never streamed any text and the run is wedged on approvals,
        # tell the user clearly and DROP the response id so the next message
        # doesn't inherit the pending-approval thread.
        if not any_text_emitted:
            if pending_approvals:
                tools = ", ".join(f"`{t}`" for t in pending_approvals)
                fallback = (
                    f"This run is blocked: the agent wanted to call {tools}, "
                    "but those tools require approval. In the Microsoft Foundry "
                    "portal, open this agent's MCP settings and set the listed "
                    "tools to auto-approve (or approve them once). After saving "
                    "a new agent version, update the deployed version and try "
                    "again."
                )
                final_response_id = ""  # don't poison the thread
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
            thread_id=final_response_id or (thread_id or ""),
            run_id=run_id,
        )
    )
