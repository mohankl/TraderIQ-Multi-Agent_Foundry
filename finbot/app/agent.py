from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

from app.config import settings


_credential = DefaultAzureCredential()
_project_client = AIProjectClient(
    endpoint=settings.azure_existing_aiproject_endpoint,
    credential=_credential,
)
_openai_client = _project_client.get_openai_client()


def run_agent(query: str, thread_id: str | None) -> tuple[str, str]:
    """Send a query to the Foundry agent and return (result_text, response_id).

    `thread_id` on the wire actually carries the previous response_id used
    by the Responses API to continue a conversation. If it's None, a fresh
    conversation starts.
    """
    kwargs = {
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
    if thread_id:
        kwargs["previous_response_id"] = thread_id

    response = _openai_client.responses.create(**kwargs)
    return (response.output_text or "Agent produced no text response.", response.id)
