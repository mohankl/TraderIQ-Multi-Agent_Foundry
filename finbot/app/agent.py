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


def _extract_chart_payloads(response: Any) -> list[dict[str, Any]]:
    """Pull get_price_history tool results out of a Foundry response.

    Each result becomes a UI render payload: `{kind: "chart", chartType, ticker,
    period, points, stats}`. The frontend routes these through its component
    registry into a ChartCard.
    """
    payloads: list[dict[str, Any]] = []
    for item in getattr(response, "output", None) or []:
        item_type = getattr(item, "type", None)
        name = getattr(item, "name", None)
        if item_type not in {"mcp_call", "tool_call", "function_call"}:
            continue
        if name != "get_price_history":
            continue
        raw = getattr(item, "output", None)
        if not isinstance(raw, str):
            continue
        try:
            tool_result = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if not isinstance(tool_result, dict) or "points" not in tool_result:
            continue
        payloads.append(
            {
                "kind": "chart",
                "chartType": "line",
                "ticker": tool_result.get("ticker"),
                "period": tool_result.get("period"),
                "points": tool_result.get("points", []),
                "stats": tool_result.get("stats", {}),
            }
        )
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

    chart_payloads: list[dict[str, Any]] = []
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
        result_text = response.output_text or "Agent produced no text response."
        new_thread_id = response.id
        chart_payloads = _extract_chart_payloads(response)

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

    for payload in chart_payloads:
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
