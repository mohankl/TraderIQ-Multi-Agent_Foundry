# Agent Framework Toolbox Agent

A Microsoft Agent Framework (MAF) agent that connects to a **Microsoft Foundry Toolbox** via MCP and serves responses over the Foundry Responses Protocol.

## Prerequisites

- **Python 3.12+**
- **Azure CLI** logged in (`az login`) — used by `DefaultAzureCredential`
- A **Microsoft Foundry project** with:
  - An Azure OpenAI model deployment (e.g. `gpt-4.1-mini`)
  - A Microsoft Foundry project with a toolbox already created — click [here](vscode://ms-windows-ai-studio.windows-ai-studio/open_tools) to create one in VSCode

## Quick Start (Local)

**Linux/macOS:**
```bash
# 1. Fill in the environment file
# Edit .env — set FOUNDRY_PROJECT_ENDPOINT, MODEL_DEPLOYMENT_NAME,
#              and TOOLBOX_ENDPOINT at minimum

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the agent
python main.py

# 4. Invoke

# Option A — Agent Inspector in VS Code (recommended):
# Press F5 and select "Debug Local Agent HTTP Server".
# This starts the agent with debugging and opens the Agent Inspector —
# an interactive UI for sending messages, viewing tool calls, and debugging.

# Option B — curl:
curl -X POST http://localhost:8088/responses \
  -H "Content-Type: application/json" \
  -d '{"input": "What tools do you have?"}'
```

**Windows (PowerShell):**
```powershell
# 1. Fill in the environment file
# Edit .env — set FOUNDRY_PROJECT_ENDPOINT, MODEL_DEPLOYMENT_NAME,
#              and TOOLBOX_ENDPOINT at minimum

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the agent
python main.py

# 4. Invoke

# Option A — Agent Inspector in VS Code (recommended):
# Press F5 and select "Debug Local Agent HTTP Server".
# This starts the agent with debugging and opens the Agent Inspector.

# Option B — Invoke-RestMethod:
Invoke-RestMethod -Method POST http://localhost:8088/responses `
  -ContentType "application/json" `
  -Body '{"input": "What tools do you have?"}'
```

## Deploy as a Hosted Agent

### Option A: Deploy via Microsoft Foundry VS Code Extension

1. Install the **Microsoft Foundry** extension in VS Code.
2. Open the **Command Palette** (`Ctrl+Shift+P`).
3. Run **Microsoft Foundry: Deploy Hosted Agent**.
4. Follow the prompts to select your Foundry project and confirm the deployment.

### Option B: Deploy via GitHub Copilot

With the **Foundry Toolkit** extension installed, open GitHub Copilot Chat in VS Code and ask:

> Deploy this hosted agent to Microsoft Foundry

Copilot will use the **microsoft-foundry** skill (installed by AI Toolkit) to build the Docker image, push it, and deploy the agent to your Foundry project.

Both options will build the Docker image, push it, and register the hosted agent in your Foundry project using the settings from `agent.yaml`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FOUNDRY_PROJECT_ENDPOINT` | **Yes** | Project endpoint URL — platform-injected at runtime |
| `MODEL_DEPLOYMENT_NAME` | **Yes** | Model deployment name (e.g. `gpt-4.1`) |
| `TOOLBOX_ENDPOINT` | **Yes** | Full toolbox MCP endpoint URL including toolbox name and api-version |
| `FOUNDRY_AGENT_TOOLBOX_FEATURES` | No | Feature-flag header value — platform-injected (default: `Toolboxes=V1Preview`) |

`TOOLBOX_ENDPOINT` is the full pre-constructed MCP URL. Two forms are supported:
```
# Latest version:
https://<account>.services.ai.azure.com/api/projects/<project>/toolboxes/<name>/mcp?api-version=v1

# Pinned to a specific version:
https://<account>.services.ai.azure.com/api/projects/<project>/toolboxes/<name>/versions/<version>/mcp?api-version=v1
```
The version number is the integer toolbox version (e.g. `1`). Use the versioned form to pin to a known-good version.

## Troubleshooting

### Tool endpoint returns HTTP 400

The `?api-version=v1` query parameter is required. Verify your `TOOLBOX_ENDPOINT`
includes it (e.g. `.../<name>/mcp?api-version=v1`).

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.

## Disclaimer
<!-- Begin standard disclaimer — do not modify -->
**IMPORTANT!** All samples and other resources made available in this GitHub repository ("samples") are designed to assist in accelerating development of agents, solutions, and agent workflows for various scenarios. Review all provided resources and carefully test output behavior in the context of your use case. AI responses may be inaccurate and AI actions should be monitored with human oversight. Learn more in the transparency documents for [Agent Service](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/agents/transparency-note) and [Agent Framework](https://github.com/microsoft/agent-framework/blob/main/TRANSPARENCY_FAQ.md).

Agents, solutions, or other output you create may be subject to legal and regulatory requirements, may require licenses, or may not be suitable for all industries, scenarios, or use cases. By using any sample, you are acknowledging that any output created using those samples are solely your responsibility, and that you will comply with all applicable laws, regulations, and relevant safety standards, terms of service, and codes of conduct.

Third-party samples contained in this folder are subject to their own designated terms, and they have not been tested or verified by Microsoft or its affiliates.

Microsoft has no responsibility to you or others with respect to any of these samples or any resulting output.
<!-- End standard disclaimer -->