# Copyright (c) Microsoft. All rights reserved.

import os

import httpx
from agent_framework import (
    Agent,
    AgentResponse,
    AgentResponseUpdate,
    Content,
    MCPStreamableHTTPTool,
    Message,
    ResponseStream,
    agent_middleware,
)
from agent_framework.foundry import FoundryChatClient
from agent_framework_foundry_hosting import ResponsesHostServer
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

import agent_framework._mcp as _mcp_module

_orig_normalize = _mcp_module._normalize_mcp_name
_mcp_module._normalize_mcp_name = lambda name: _orig_normalize(name).replace(".", "_")

class ToolboxAuth(httpx.Auth):
    """httpx Auth that injects a fresh bearer token on every request."""

    def auth_flow(self, request: httpx.Request):
        credential = DefaultAzureCredential()
        token = credential.get_token("https://ai.azure.com/.default").token
        request.headers["Authorization"] = f"Bearer {token}"
        yield request


def _extract_consent_url(exc: BaseException) -> str | None:
    """Walk the exception chain for a Foundry MCP consent error (code -32006)."""
    if hasattr(exc, "error") and getattr(exc.error, "code", None) == -32006:
        return exc.error.message
    for chained in (exc.__cause__, exc.__context__):
        if chained is not None:
            url = _extract_consent_url(chained)
            if url:
                return url
    return None


@agent_middleware
async def consent_middleware(context, call_next):
    """Catch MCP consent errors and return the consent URL as a message."""
    try:
        await call_next()
    except Exception as e:
        consent_url = _extract_consent_url(e)
        if consent_url:
            text = (
                f"OAuth consent is required. Please open the following URL "
                f"in a browser to authorize access, then try again:\n\n{consent_url}"
            )
            msg = Message("assistant", [text])
            response = AgentResponse(messages=[msg])
            if context.stream:
                async def _updates():
                    yield AgentResponseUpdate(
                        contents=[Content("text", text=text)], role="assistant"
                    )
                context.result = ResponseStream(_updates(), finalizer=lambda _: response)
            else:
                context.result = response
        else:
            raise


def main():
    client = FoundryChatClient(
        project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
        model=os.environ["MODEL_DEPLOYMENT_NAME"],
        credential=DefaultAzureCredential(),
    )

    # Foundry Toolbox as a MCP tool
    toolbox_endpoint = os.environ["TOOLBOX_ENDPOINT"]
    http_client = httpx.AsyncClient(
        auth=ToolboxAuth(),
        headers={"Foundry-Features": "Toolboxes=V1Preview"},
        timeout=120.0,
    )
    foundry_mcp_tool = MCPStreamableHTTPTool(
        name="toolbox",
        url=toolbox_endpoint,
        http_client=http_client,
        load_prompts=False,
    )

    agent = Agent(
        client=client,
        instructions="You are a friendly assistant. Keep your answers brief.",
        tools=[foundry_mcp_tool],
        middleware=[consent_middleware],
        # History will be managed by the hosting infrastructure, thus there
        # is no need to store history by the service. Learn more at:
        # https://developers.openai.com/api/reference/resources/responses/methods/create
        default_options={"store": False},
    )

    server = ResponsesHostServer(agent)
    server.run()


if __name__ == "__main__":
    main()
