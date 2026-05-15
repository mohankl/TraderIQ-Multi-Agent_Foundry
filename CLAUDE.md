# Trading Multi-Agent — Project Context

This file is loaded by Claude Code when working in this repo. It mirrors the deployed-stack snapshot so future sessions don't have to re-derive it.

## Live URLs (Azure, env `trading-env`)

- **Frontend:** https://tradingiq-web.proudisland-e27da000.westus.azurecontainerapps.io
- **API:** https://tradingiq-api.proudisland-e27da000.westus.azurecontainerapps.io
- **MCP server:** https://tradingiq-mcp.proudisland-e27da000.westus.azurecontainerapps.io/mcp (`X-API-Key` required)

## Azure Resources

- **Subscription:** `9b0c035b-cf37-487c-8eab-505bcad22ea8`
- **Resource group:** `rg-dev`
- **Location:** `westus`
- **Container Registry:** `alphastatetradingacr`
- **Container Apps Environment:** `trading-env` (default domain `proudisland-e27da000.westus.azurecontainerapps.io`)

## Foundry (Microsoft AI Foundry)

- **Foundry resource:** `alpha-state-trading-multi-agent`
- **Project:** `alpha-state-trading-MMA`
- **Endpoint:** `https://alpha-state-trading-multi-agent.services.ai.azure.com/api/projects/alpha-state-trading-MMA`
- **Agent name:** `alphastate-trading-mma-agent` (version `18` — pinned via `AZURE_EXISTING_AGENT_VERSION` env on `tradingiq-api`; v18 wires the new tradingiq-mcp URL)
- **Agent type:** New Foundry v2 agent — invoked via OpenAI Responses API, NOT legacy Assistants API
- **Toolbox:** `trading-tools` exists but agent attaches MCP directly (Browse All Tools → MCP)

## Container Apps

| App | Image | Port | Purpose |
|---|---|---|---|
| `tradingiq-mcp` | `alphastatetradingacr.azurecr.io/tradingiq-mcp:v1` | 8080 | MCP server, 5 tools. Each renderable tool returns a `{data, render}` envelope and stamps `data.as_of` for provenance. Docstrings carry a "SINGLE-TOOL RULE" so the agent doesn't over-call. `wikipedia_lookup` sets a descriptive User-Agent and catches all exceptions |
| `tradingiq-api` | `alphastatetradingacr.azurecr.io/tradingiq-api:v1` | 8000 | FastAPI client; exposes `/health` and `/agui` (AG-UI SSE). **Streams** Foundry Responses events: per-tool `STEP_STARTED`/`STEP_FINISHED`, per-token `TEXT_MESSAGE_CONTENT` deltas, and `CUSTOM ui.render` emitted as each tool completes. Tracing **currently no-op** — `azure-monitor-opentelemetry` bootstrap hits `ImportError: cannot import name 'LogData'` and falls back to no-op tracer. See `TODO(v11.2)` |
| `tradingiq-web` | `alphastatetradingacr.azurecr.io/tradingiq-web:v1` | 3000 | Next.js 16 frontend; `/api/chat` proxies SSE; renders interleaved step pills, text deltas, and inline cards progressively. Consecutive same-`kind` render payloads are grouped into a 2-col grid (comparison mode); paired stock cards get a delta strip (ΔP/E, vs-52w-low, tier). Branded as **Trading IQ** with a custom network-with-dollar SVG logo and the tagline "Institutional equity research @ your voice command" |

All three apps use **user-assigned** managed identities for ACR pull. Each MI lives in `rg-dev` and is granted at create time so the first revision can pull immediately.

- `tradingiq-mcp-mi` (`d275c7f2-43f1-4d4b-ab6e-b3932e864e46`) — `AcrPull` on the registry.
- `tradingiq-api-mi` (`a599ddb9-a84e-4085-b70b-596c464b0c3a`) — `AcrPull` on registry, `Azure AI User` on Foundry project, `Monitoring Metrics Publisher` on `tradingiq-ai`.
- `tradingiq-web-mi` (`60c87c41-fec2-465d-8d3b-815b9fbe4665`) — `AcrPull` on the registry.
- `tradingiq-web` env: `TRADINGIQ_API_URL=https://tradingiq-api.proudisland-e27da000.westus.azurecontainerapps.io`
- `tradingiq-api` env: `CORS_ALLOWED_ORIGINS=https://tradingiq-web.proudisland-e27da000.westus.azurecontainerapps.io,http://localhost:3000`

## Repo Structure

```
Trading-Multi-Agent/
  tradingiq/
    Dockerfile              # FastAPI image (python:3.13-slim)
    app/
      agent.py              # AIProjectClient + OpenAI Responses API; AG-UI SSE
      config.py             # AZURE_EXISTING_AIPROJECT_ENDPOINT, AZURE_EXISTING_AGENT_NAME, AZURE_EXISTING_AGENT_VERSION
      main.py               # /health + /agui SSE endpoint; CORS via CORS_ALLOWED_ORIGINS
    frontend/               # Next.js 16 (Turbopack) + Tailwind v4
      Dockerfile            # multi-stage, node:22-alpine, standalone output
      next.config.ts        # output: "standalone"
      src/
        app/
          api/chat/route.ts # SSE proxy: POSTs to ${TRADINGIQ_API_URL}/agui
          api/copilotkit/   # legacy CopilotKit handlers — kept but unused
          layout.tsx
          page.tsx
        components/
          chat-area.tsx     # parses AG-UI events directly; renders streaming reply
        lib/
          threads.ts        # localStorage threads; Thread.foreignId = Foundry response_id
  mcp-server/
    server.py               # FastMCP, stateless_http, X-API-Key auth
    Dockerfile
```

## MCP Tools

- `get_stock_fundamentals(ticker)` — yfinance
- `get_price_history(ticker, period)` — yfinance OHLC time series; result is rendered as an inline chart on the frontend (see "Generative UI / Inline Components" below)
- `get_yahoo_finance_news(ticker)` — yfinance news
- `search_news(query)` — SerpAPI Google News
- `wikipedia_lookup(query)` — Wikipedia

## Auth

- MCP server: `X-API-Key` header (Container Apps secret `mcp-api-key`)
- FastAPI → Foundry: `DefaultAzureCredential` (managed identity in Container Apps, `az login` locally)
- Entra/OBO auth: deferred

## Chat / Streaming Flow

1. Browser → `POST /api/chat` (Next.js route) with `{threadId, messageId, content}`
2. Next.js → `POST ${TRADINGIQ_API_URL}/agui` with full AG-UI input envelope
3. FastAPI calls Foundry via OpenAI Responses API with `stream=True`, sets `previous_response_id` only when `threadId` starts with `resp_`
4. FastAPI maps the Foundry stream onto AG-UI events as they arrive:
   - `response.output_item.added` (mcp_call) → `STEP_STARTED` with `step_name="tool:<name>"`
   - `response.output_item.done` (mcp_call) → `CUSTOM ui.render` (if envelope) + `STEP_FINISHED`
   - `response.output_text.delta` → `TEXT_MESSAGE_START` (once) + `TEXT_MESSAGE_CONTENT` (one delta per token)
   - `response.completed` → `RUN_FINISHED` with `thread_id=response.id`
5. Browser parses events live: step pills appear inline, cards render the moment their tool finishes, text streams token-by-token. The whole bubble is persisted on `RUN_FINISHED`.

## Generative UI / Inline Components

The frontend renders agent-driven UI (today: stock charts, stock cards) using AG-UI `CUSTOM` events. **MCP tools self-describe their UI**; FastAPI is a generic forwarder.

### Self-describing tool envelope

Renderable MCP tools return:

```json
{
  "data": { "...the actual data..." , "as_of": "2026-05-14T20:00:00+00:00" },
  "render": { "kind": "stock_card", "...optional hints..." }
}
```

Tools that don't render UI (`get_yahoo_finance_news`, `search_news`, `wikipedia_lookup`) return plain strings — they're skipped by the extractor.

### Flow

1. Agent calls an MCP tool that returns the envelope above.
2. FastAPI's [agent.py](tradingiq/app/agent.py) streams Foundry events. On every `response.output_item.done` for an `mcp_call`, it parses the output JSON; if it has both `data` and `render`, it merges them into a flat payload `{kind, ...render-hints, ...data}`, attaches `source_tool_call_id`, and emits one AG-UI `CUSTOM` event with `name="ui.render"` immediately (no waiting for the run to finish).
3. The frontend SSE parser in [chat-area.tsx](tradingiq/frontend/src/components/chat-area.tsx) keeps a *live* segment list for the in-flight assistant bubble: each STEP_STARTED, CUSTOM render, and text delta is appended in arrival order. The bubble updates frame-by-frame. On `RUN_FINISHED` the segments are flattened into a normal persisted `Message` (text + `renderSlots`).
4. [chat-message.tsx](tradingiq/frontend/src/components/chat-message.tsx) renders persisted messages: markdown text then iterates `renderSlots` through [render-slot.tsx](tradingiq/frontend/src/components/render-slot.tsx), which dispatches on the discriminated union `RenderPayload.kind` to a concrete component (e.g. [chart-card.tsx](tradingiq/frontend/src/components/chart-card.tsx), [stock-card.tsx](tradingiq/frontend/src/components/stock-card.tsx)).
5. Step pills come from [step-pill.tsx](tradingiq/frontend/src/components/step-pill.tsx) — they show "Fetching <tool>…" while the tool is running and flip to a checkmark when it completes. The pill is only in the live bubble; it is not persisted.
6. Every card renders a tiny [render-source.tsx](tradingiq/frontend/src/components/render-source.tsx) footer showing `as_of` and the tool-call id, so drift between the narrative and the card is visible.

### Division of labor (the narrative-vs-card contract)

Each renderable tool's docstring carries a "DIVISION OF LABOR" section instructing the agent:
- **Do NOT** restate any number the card already shows (price, P/E, market cap, 52w range, etc.). Restating creates drift between the LLM's prose and the source-of-truth card.
- **Do** write interpretation the card can't express: valuation judgement, news context, risks, outlook, shape of a trend.
- Tools include "GOOD reply" / "BAD reply" examples to anchor the pattern.

### Adding a new inline component

1. Add an MCP tool in [mcp-server/server.py](mcp-server/server.py) that returns the envelope `{data, render: {kind: "your_kind"}}`. Include `data.as_of` if applicable. Write its docstring with a DIVISION OF LABOR section.
2. Add a new variant to the `RenderPayload` union in [threads.ts](tradingiq/frontend/src/lib/threads.ts).
3. Add a case to [render-slot.tsx](tradingiq/frontend/src/components/render-slot.tsx) and ship the component (use `RenderSource` for the provenance footer).
4. **No FastAPI change needed** — the generic envelope detector picks it up automatically.
5. In the Foundry portal: approve the new tool (auto-approve recommended), then save a new agent version. Pin the env var on `tradingiq-api`.

### Why AG-UI `CUSTOM`, not text-embedded JSON or `TOOL_CALL_RESULT`

- `CUSTOM` is the AG-UI-blessed channel for arbitrary typed payloads ([docs](https://docs.ag-ui.com/concepts/events)).
- Markdown-fenced sentinels are fragile against LLM hallucination.
- `TOOL_CALL_RESULT` events are meant to flow into the next agent thought, not the UI.

## Observability

Tracing is wired to **Azure AI Foundry's** built-in observability stack. The Foundry project `alpha-state-trading-MMA` has the App Insights resource `tradingiq-ai` (in `rg-dev`) attached via the portal's *Connected resources*. The Foundry "Tracing" tab reads spans out of that App Insights workspace; there's no separate Foundry-native OTLP endpoint.

[app/tracing.py](tradingiq/app/tracing.py) calls `AIProjectClient.telemetry.get_application_insights_connection_string()` at startup (auth via `DefaultAzureCredential`, no env-var needed), hands the string to `azure.monitor.opentelemetry.configure_azure_monitor()`, then runs `AIProjectInstrumentor().instrument()`. That single bootstrap installs the tracer provider, the App Insights exporter, FastAPI/httpx auto-instrumentation, and a GenAI auto-instrumentor that emits `gen_ai.*` spans for every `responses.create()` call made through the project's OpenAI client. Custom `agent.run` and `agent.tool` spans nest inside.

Required env vars on `tradingiq-api`:
```sh
AZURE_EXPERIMENTAL_ENABLE_GENAI_TRACING=true
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true  # captures prompts + outputs
```

Required RBAC (already granted): the `tradingiq-api-mi` managed identity has `Monitoring Metrics Publisher` on `tradingiq-ai`. Without it, `configure_azure_monitor` can't push spans.

**TODO(v11.2)**: bootstrap currently fails with `ImportError: cannot import name 'LogData' from 'opentelemetry.sdk._logs'`. The exception handler keeps the app running with a no-op tracer, but no spans land in App Insights. Likely a version-skew issue between `azure-monitor-opentelemetry==1.8.2` and `opentelemetry-sdk==1.41.1` in the rebuilt `tradingiq-api:v1` image — needs investigation before tracing resumes.

Viewing traces: **Azure AI Foundry portal → project → Tracing**. ~3–5 minute App Insights ingestion lag. If the project loses its App Insights connection, the bootstrap logs a warning and falls back to a no-op tracer — the app still boots.

## Known Caveats

- **`useCopilotChat` is abandoned.** The free hook has a destructuring bug — it returns `visibleMessages` but the internal hook only populates `messages`. We bypass CopilotKit entirely; the `/api/copilotkit/*` routes and `proxy.ts` are dead code kept for reference.
- **Use `TEXT_MESSAGE_CONTENT`, never `TEXT_MESSAGE_CHUNK`, when also sending explicit `TEXT_MESSAGE_START`/`END`.** The AG-UI chunk transformer synthesizes a second `TEXT_MESSAGE_START` for the same message ID, which the event validator rejects as "already in progress".
- **CopilotKit thread IDs are plain UUIDs.** Don't pass them to Foundry as `previous_response_id` — Foundry rejects anything that doesn't start with `resp_`.
- **New MCP tools require explicit Foundry approval AND a new agent version.** Adding a tool to `mcp-server/server.py` and rolling `tradingiq-mcp` is not enough. In the Foundry portal you must (1) approve the new tool (or set it to "auto-approve"), and (2) **save as a new agent version**. Then update `AZURE_EXISTING_AGENT_VERSION` on `tradingiq-api` to point at the new version. Without the new version, the agent emits `mcp_approval_request` items instead of calling the tool, and `response.output_text` is empty.

## Common Commands

Local dev:
```sh
# API
cd tradingiq && uv run uvicorn app.main:app --reload --port 8000
# Frontend
cd tradingiq/frontend && npm run dev
```

Rebuild + redeploy frontend:
```sh
cd tradingiq/frontend
az acr build --registry alphastatetradingacr --image tradingiq-web:vN --platform linux/amd64 .
az containerapp update -n tradingiq-web -g rg-dev --image alphastatetradingacr.azurecr.io/tradingiq-web:vN
```

Rebuild + redeploy API:
```sh
cd tradingiq
az acr build --registry alphastatetradingacr --image tradingiq-api:vN --platform linux/amd64 .
az containerapp update -n tradingiq-api -g rg-dev --image alphastatetradingacr.azurecr.io/tradingiq-api:vN
```

Tail logs:
```sh
az containerapp logs show -n tradingiq-api -g rg-dev --tail 60
az containerapp logs show -n tradingiq-web -g rg-dev --tail 60
```

## Git Tags

- `v1.0` — Foundry agent + FastAPI thin client + MCP server deployed
- `v2.0` — Streaming chat UI with Foundry continuity (local)
- `v8.0` — Azure deployment of the Next.js frontend
- `v8.1` — Project Claude Code settings, slash commands, agents, prod-guard hook
- `v9.0` — Inline charts (generative UI): `get_price_history` MCP tool, AG-UI `CUSTOM` events, Recharts ChartCard, render-slot registry
- `v9.1` — Sharpened MCP tool docstrings so the agent reliably picks `get_price_history` for chart queries instead of substituting `get_stock_fundamentals` (mcp:v4, agent v11)
- `v9.2` — Stock card (boarding-pass style) for fundamentals queries; richer get_stock_fundamentals output (exchange, sector, market-cap tier, dividend yield, ROE, volume); 52-week range visual bar (mcp:v5, api:v5, web:v4, agent v12)
- `v10.0` — Self-describing tool envelope `{data, render}`. FastAPI extractor is now generic — no per-tool code. Adding a new inline UI component no longer requires a backend change (mcp:v6, api:v6, agent v14)
- `v10.1` — Lossy-round-trip fix. Tool docstrings codify division of labor (card owns numbers, narrative owns interpretation). Tool data carries `as_of`; render payloads carry `source_tool_call_id`. Cards show a tiny provenance footer. Approval-pending state now surfaces as a clear error and doesn't poison the conversation (mcp:v7, api:v8, web:v6, agent v16)
- `v10.2` — Streaming + progressive disclosure. FastAPI now consumes Foundry's streaming Responses events and maps them onto AG-UI `STEP_STARTED`/`STEP_FINISHED`, per-token `TEXT_MESSAGE_CONTENT` deltas, and a `CUSTOM ui.render` event the moment each tool finishes. Frontend renders a live segmented bubble (step pills inline, cards appearing as tools complete, text streaming token-by-token). OpenTelemetry traces on `agent.run` with FastAPI + httpx auto-instrumentation. Also hardens `wikipedia_lookup` (proper User-Agent + broad exception handling so MediaWiki rate-limits no longer abort the run) (mcp:v8, api:v9, web:v7, agent v16)
- `v10.3` — Live-bubble visibility fix. The in-flight assistant bubble used to render an empty dark pill next to the avatar while waiting for the first STEP_STARTED to arrive; now it returns null until it has at least one segment, and when the only segments are step pills it drops the `bg-card` chrome so the spinner has real contrast (web:v8)
- `v10.4` — E2E-driven polish. Fixes three regressions found via Playwright: (1) the "Agent produced no text response." fallback was being concatenated to real text because the post-loop check used `text_started` (which resets per message-end) instead of "did we ever emit text at all"; (2) when the agent emitted two message items in one run (mid-thought tool call), the deltas were merged into a single text segment producing visibly duplicated headings/bullets — fix is to open a new text segment on every `TEXT_MESSAGE_START` and join with `\n\n` on flatten; (3) no progress affordance between "all tools done" and "first text token" — new "Writing analysis" pill bridges that gap. Also tightens `get_price_history` and `get_stock_fundamentals` docstrings with a "SINGLE-TOOL RULE" so the agent stops over-calling tools the user didn't ask for (mcp:v9, api:v10, web:v10, agent v17)
- `v10.5` — Trading IQ rebrand + visible "Thinking…" indicator. (1) Renames the app from "FinBot" to "Trading IQ" across the sidebar, landing screen, page title, and favicon, with a custom SVG logo (six outer nodes + spokes + central agent disc with "$"). (2) Adds a "Thinking…" label next to the bouncing dots in the pre-first-event window so the user has continuous textual feedback from the moment they hit send (web:v12)
- `v10.6` — Comparison cards + UI polish. (1) `groupRenderSlots()` walks the render payloads on a persisted message (and the in-flight bubble's segments) and merges consecutive same-`kind` payloads into a `RenderGroup`; pairs render in a 2-col grid. (2) Stock-card pairs get a `StockCardDeltaRow` underneath: ΔP/E with a "X richer" hint, vs-52-week-low % for each ticker, and a market-cap tier compare. Chart pairs use the same grid without a delta row. Auto-detection means no MCP or agent change needed. (3) `RenderSource` footer no longer shows the `mcp_…` tool-call id and the `as_of` line is now date-only (no time/timezone clutter). (4) Sidebar/title tagline switched to "Institutional equity research @ your voice command". (5) Typing-indicator label switched to "Data analysis & Intelligence at work" while the LLM is processing (web:v17)
- `v10.7` — Foundry-native observability. Drops the unused OTLP-HTTP exporter and wires tracing into Azure AI Foundry's built-in observability path. `tracing.py` now asks the project SDK for the attached App Insights connection string at runtime (`AIProjectClient.telemetry.get_application_insights_connection_string()`), hands it to `configure_azure_monitor`, and runs `AIProjectInstrumentor().instrument()` so every Foundry Responses-API call emits `gen_ai.*` spans visible in the Foundry portal's Tracing tab. New App Insights resource `tradingiq-ai` + Log Analytics workspace `tradingiq-logs` in `rg-dev`. `finbot-api` MI granted `Monitoring Metrics Publisher` on the AI resource. Two new env vars on the Container App: `AZURE_EXPERIMENTAL_ENABLE_GENAI_TRACING=true` and `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` (api:v11)
- `v11.0` — Source rename `finbot/` → `tradingiq/`. Frontend env `FINBOT_API_URL` → `TRADINGIQ_API_URL`, localStorage keys renamed, CopilotKit slug `finbotAgent` → `tradingIqAgent`, FastAPI title "FinBot API" → "Trading IQ API", MCP server `finbot-tools` → `tradingiq-tools`. Azure resources still on `finbot-*` names at this point. Source-only PR; no infra impact.
- `v11.1` — Azure resource cutover. New Container Apps `tradingiq-{mcp,api,web}` on user-assigned MIs (`tradingiq-{mcp,api,web}-mi`); new ACR repos `tradingiq-{mcp,api,web}:v1`; Foundry agent **v18** points at `tradingiq-mcp`; `finbot-{mcp,api,web}` deleted. Frontend env var migrated to `TRADINGIQ_API_URL`. CORS updated. **Tracing currently no-op** on tradingiq-api due to `ImportError: cannot import name 'LogData' from 'opentelemetry.sdk._logs'` — exception-handled, app still serves. See `TODO(v11.2)` (mcp:v1, api:v1, web:v1, agent v18)

## Keeping This File Current

CLAUDE.md exists to save the next agent (or human) from re-deriving facts that are tedious to look up. It should stay short and truthful. Rules of thumb:

1. **Run `/update-claude-md`** whenever you make a change the file would care about: image tag bump, env var change, new FQDN, new MCP tool, new Container App, agent version bump, auth scope change. The slash command lives at [.claude/commands/update-claude-md.md](.claude/commands/update-claude-md.md) and walks through what to verify against live Azure state.
2. **Cap it at ~400 lines.** If a section grows large, link to the source file instead of inlining its contents.
3. **Use file links**: `[name](path)` rather than bare paths, since most editors and IDE integrations make them clickable.
4. **Never invent facts.** If you cannot verify a value, mark it `TODO(verify): ...` and move on.
5. **Don't duplicate code.** Reference where the real implementation lives.
6. **Update the "Git Tags" list** whenever you cut a new tag. One bullet per tag, one sentence each.

For non-Claude agents, the same context is mirrored in [AGENTS.md](AGENTS.md). Keep both in sync when you change shared facts.

## Collaboration Setup

This repo ships its own Claude Code configuration:

- [.claude/settings.json](.claude/settings.json) — shared permissions, `ask`/`deny` lists for risky Azure ops, env vars for the deployed FQDNs, PreToolUse safety hook
- [.claude/settings.local.json.example](.claude/settings.local.json.example) — copy to `.claude/settings.local.json` for personal tweaks (gitignored)
- [.claude/hooks/azure-prod-guard.sh](.claude/hooks/azure-prod-guard.sh) — hard-blocks destructive Azure operations regardless of permission state
- [.claude/agents/](.claude/agents/) — specialized agents: `deployer`, `security-reviewer`, `foundry-agent-engineer`
- [.claude/commands/](.claude/commands/) — slash commands: `/deploy-api`, `/deploy-web`, `/tail-logs`, `/update-claude-md`

When you join the project, your first invocation of Claude Code in this directory will pick up the settings automatically. If you want personal overrides, copy `.claude/settings.local.json.example` to `.claude/settings.local.json` and edit.
