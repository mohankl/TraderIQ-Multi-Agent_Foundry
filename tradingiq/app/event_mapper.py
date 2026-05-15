"""Pure mapper from Foundry Responses-API stream events onto AG-UI events.

This module is deliberately free of I/O: no AIProjectClient, no tracer, no
encoder. The caller (`app.agent.run_agent_stream`) wraps it in a span and
encodes the yielded events for SSE. Keeping it pure makes the event-
mapping logic directly unit-testable with fixture events.
"""

import json
import uuid
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Any

from ag_ui.core import (
    CustomEvent,
    EventType,
    StepFinishedEvent,
    StepStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
)


@dataclass
class MapperResult:
    """Out-of-band state surfaced after the stream is exhausted.

    Used by the caller to decide whether to splice a fallback message and
    what thread_id to put on RUN_FINISHED."""
    any_text_emitted: bool
    pending_approvals: list[str]
    final_response_id: str


def extract_render_payload(item: Any, tool_call_id: str | None) -> dict[str, Any] | None:
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


def step_name_for_tool(name: str | None) -> str:
    return f"tool:{name}" if name else "tool"


def map_foundry_stream(
    foundry_events: Iterable[Any],
    state: MapperResult,
) -> Iterator[Any]:
    """Map Foundry Responses-API events onto AG-UI event objects.

    The mapper is a synchronous iterator — the caller iterates Foundry
    events (which arrive synchronously from the SDK iterator) and forwards
    each yielded AG-UI event after encoding it. The `state` argument is
    mutated as the stream is processed; the caller reads `any_text_emitted`,
    `pending_approvals`, and `final_response_id` once the iterator is
    exhausted to decide on fallback messaging.

    Streaming flow (v10.2):
      [for each MCP tool call:
         STEP_STARTED("tool:<name>")
         (... agent thinks ...)
         CUSTOM ui.render (if envelope present)
         STEP_FINISHED("tool:<name>")]
      TEXT_MESSAGE_START
      TEXT_MESSAGE_CONTENT (x many small deltas)
      TEXT_MESSAGE_END
    """
    open_steps: dict[int, str] = {}
    answer_msg_id: str | None = None
    text_started = False

    for event in foundry_events:
        etype = getattr(event, "type", None)

        if etype == "response.created":
            # Pass-through — caller's tracer wants the id, but we don't yield.
            continue

        if etype == "response.output_item.added":
            item = getattr(event, "item", None)
            idx = getattr(event, "output_index", None)
            it_type = getattr(item, "type", None)
            if it_type == "mcp_call":
                tool_name = getattr(item, "name", None) or "tool"
                name = step_name_for_tool(tool_name)
                if isinstance(idx, int):
                    open_steps[idx] = name
                yield StepStartedEvent(type=EventType.STEP_STARTED, step_name=name)
            elif it_type == "mcp_approval_request":
                req_name = getattr(item, "name", None)
                if isinstance(req_name, str) and req_name and req_name not in state.pending_approvals:
                    state.pending_approvals.append(req_name)
            continue

        if etype == "response.output_item.done":
            item = getattr(event, "item", None)
            idx = getattr(event, "output_index", None)
            it_type = getattr(item, "type", None)
            if it_type == "mcp_call":
                tool_call_id = getattr(item, "id", None)
                payload = extract_render_payload(item, tool_call_id)
                if payload is not None:
                    yield CustomEvent(type=EventType.CUSTOM, name="ui.render", value=payload)
                name = (
                    open_steps.pop(idx, None)
                    if isinstance(idx, int)
                    else None
                ) or step_name_for_tool(getattr(item, "name", None))
                yield StepFinishedEvent(type=EventType.STEP_FINISHED, step_name=name)
            elif it_type == "message" and text_started and answer_msg_id:
                yield TextMessageEndEvent(
                    type=EventType.TEXT_MESSAGE_END, message_id=answer_msg_id
                )
                text_started = False
            continue

        if etype == "response.output_text.delta":
            delta = getattr(event, "delta", None)
            if not isinstance(delta, str) or not delta:
                continue
            if not text_started:
                answer_msg_id = str(uuid.uuid4())
                yield TextMessageStartEvent(
                    type=EventType.TEXT_MESSAGE_START,
                    message_id=answer_msg_id,
                    role="assistant",
                )
                text_started = True
                state.any_text_emitted = True
            yield TextMessageContentEvent(
                type=EventType.TEXT_MESSAGE_CONTENT,
                message_id=answer_msg_id or "",
                delta=delta,
            )
            continue

        if etype == "response.completed":
            rid = getattr(getattr(event, "response", None), "id", None)
            if rid:
                state.final_response_id = rid
            continue

    # Close any straggling steps (defensive — shouldn't happen on a clean run).
    for name in list(open_steps.values()):
        yield StepFinishedEvent(type=EventType.STEP_FINISHED, step_name=name)

    # Close a still-open text stream defensively (rare — Foundry normally
    # closes the message item before response.completed).
    if text_started and answer_msg_id:
        yield TextMessageEndEvent(
            type=EventType.TEXT_MESSAGE_END, message_id=answer_msg_id
        )
