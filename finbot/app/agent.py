import uuid
from typing import AsyncGenerator

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

from app.config import settings

_credential = DefaultAzureCredential()
_project_client = AIProjectClient(
    endpoint=settings.azure_existing_aiproject_endpoint,
    credential=_credential,
)
_openai_client = _project_client.get_openai_client()


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

    yield encoder.encode(
        RunFinishedEvent(
            type=EventType.RUN_FINISHED,
            thread_id=new_thread_id,
            run_id=run_id,
        )
    )
