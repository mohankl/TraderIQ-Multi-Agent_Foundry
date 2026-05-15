import json
import uuid
from typing import Any, AsyncGenerator

from ag_ui.core import (
    CustomEvent,
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

from app.config import settings

_credential = DefaultAzureCredential()
_project_client = AIProjectClient(
    endpoint=settings.azure_existing_aiproject_endpoint,
    credential=_credential,
)
_openai_client = _project_client.get_openai_client()


_TOOL_CALL_ITEM_TYPES = {"mcp_call", "tool_call", "function_call"}


def _find_pending_approvals(response: Any) -> list[str]:
    """Return the names of tools the agent wanted to call but couldn't (approval pending).

    Foundry surfaces these as `mcp_approval_request` items in `response.output`.
    When present, the agent typically returns no text and the run is effectively
    blocked until the approval is granted in the Foundry portal.
    """
    pending: list[str] = []
    for item in getattr(response, "output", None) or []:
        if getattr(item, "type", None) == "mcp_approval_request":
            name = getattr(item, "name", None)
            if isinstance(name, str) and name and name not in pending:
                pending.append(name)
    return pending


def _iter_tool_outputs(response: Any):
    """Yield (tool_call_id, parsed_dict_output) for every tool-call item in a response."""
    for item in getattr(response, "output", None) or []:
        if getattr(item, "type", None) not in _TOOL_CALL_ITEM_TYPES:
            continue
        raw = getattr(item, "output", None)
        if not isinstance(raw, str):
            continue
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            yield getattr(item, "id", None), parsed


def _extract_render_payloads(response: Any) -> list[dict[str, Any]]:
    """Forward any self-describing tool envelopes to the frontend.

    Convention: an MCP tool that wants the frontend to render an inline
    component returns `{"data": {...}, "render": {"kind": "<name>", ...hints}}`.
    FastAPI is generic — it does not know what `kind`s exist. It merges the
    render hints with the data into a flat payload `{kind, ...hints, ...data}`
    and emits one AG-UI CUSTOM event per envelope. The frontend's render-slot
    registry decides how to render each kind.

    For provenance, we also attach the originating tool-call id as
    `source_tool_call_id`. The MCP tool may include an `as_of` field inside
    `data`; that travels through unchanged. Both fields drive the small
    footer on each rendered card.

    Tools that don't want UI just return their data shape with no `render`
    key and are skipped here.
    """
    payloads: list[dict[str, Any]] = []
    for tool_call_id, output in _iter_tool_outputs(response):
        render = output.get("render")
        data = output.get("data")
        if not isinstance(render, dict) or not isinstance(data, dict):
            continue
        kind = render.get("kind")
        if not isinstance(kind, str) or not kind:
            continue
        # Flat shape: kind, then any extra render hints (e.g. chartType),
        # then the actual data fields. Data fields win on key collision.
        merged: dict[str, Any] = {"kind": kind}
        for k, v in render.items():
            if k == "kind":
                continue
            merged[k] = v
        merged.update(data)
        if tool_call_id and "source_tool_call_id" not in merged:
            merged["source_tool_call_id"] = tool_call_id
        payloads.append(merged)
    return payloads


async def run_agent_stream(
    query: str,
    thread_id: str | None,
    run_id: str,
) -> AsyncGenerator[str, None]:
    """Call Foundry agent and stream AG-UI protocol events back to the client.

    Yields encoded SSE strings. thread_id carries the previous Foundry
    response_id for conversation continuity; None starts a fresh conversation.
    """
    encoder = EventEncoder()

    yield encoder.encode(
        RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id or "", run_id=run_id)
    )

    render_payloads: list[dict[str, Any]] = []
    try:
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
        }
        if thread_id and thread_id.startswith("resp_"):
            kwargs["previous_response_id"] = thread_id

        response = _openai_client.responses.create(**kwargs)
        pending = _find_pending_approvals(response)
        if pending:
            # The Foundry agent wanted to call these tools but they require
            # approval. The run is now wedged for this conversation; tell the
            # user clearly and DROP the response id so the next message starts
            # a fresh thread instead of inheriting the pending approval.
            tools = ", ".join(f"`{t}`" for t in pending)
            result_text = (
                f"This run is blocked: the agent wanted to call {tools}, "
                "but those tools require approval. In the Microsoft Foundry "
                "portal, open this agent's MCP settings and set the listed "
                "tools to auto-approve (or approve them once). After saving "
                "a new agent version, update the deployed version and try "
                "again."
            )
            new_thread_id = ""
            render_payloads = []
        else:
            result_text = response.output_text or "Agent produced no text response."
            new_thread_id = response.id
            render_payloads = _extract_render_payloads(response)

    except Exception as exc:
        result_text = f"Error: {exc}"
        new_thread_id = thread_id or ""

    # Stream the real answer
    answer_msg_id = str(uuid.uuid4())
    yield encoder.encode(
        TextMessageStartEvent(
            type=EventType.TEXT_MESSAGE_START,
            message_id=answer_msg_id,
            role="assistant",
        )
    )
    yield encoder.encode(
        TextMessageContentEvent(
            type=EventType.TEXT_MESSAGE_CONTENT,
            message_id=answer_msg_id,
            delta=result_text,
        )
    )
    yield encoder.encode(
        TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=answer_msg_id)
    )

    for payload in render_payloads:
        yield encoder.encode(
            CustomEvent(
                type=EventType.CUSTOM,
                name="ui.render",
                value=payload,
            )
        )

    yield encoder.encode(
        RunFinishedEvent(
            type=EventType.RUN_FINISHED,
            thread_id=new_thread_id,
            run_id=run_id,
        )
    )
