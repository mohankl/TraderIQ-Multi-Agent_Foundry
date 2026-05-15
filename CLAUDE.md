# Trading Multi-Agent — Project Context

This file is loaded by Claude Code when working in this repo. It mirrors the deployed-stack snapshot so future sessions don't have to re-derive it.

## Live URLs (Azure, env `trading-env`)

- **Frontend:** https://finbot-web.proudisland-e27da000.westus.azurecontainerapps.io
- **API:** https://finbot-api.proudisland-e27da000.westus.azurecontainerapps.io
- **MCP server:** internal, port 8080

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
- **Agent name:** `alphastate-trading-mma-agent` (version `16` — pinned via `AZURE_EXISTING_AGENT_VERSION` env on `finbot-api`)
- **Agent type:** New Foundry v2 agent — invoked via OpenAI Responses API, NOT legacy Assistants API
- **Toolbox:** `trading-tools` exists but agent attaches MCP directly (Browse All Tools → MCP)

## Container Apps

| App | Image | Port | Purpose |
|---|---|---|---|
| `finbot-mcp` | `alphastatetradingacr.azurecr.io/finbot-mcp:v7` | 8080 | MCP server, 5 tools. Each renderable tool returns a `{data, render}` envelope and stamps `data.as_of` for provenance |
| `finbot-api` | `alphastatetradingacr.azurecr.io/finbot-api:v8` | 8000 | FastAPI client; exposes `/health` and `/agui` (AG-UI SSE). Generic envelope extractor (no per-tool code); attaches `source_tool_call_id` and surfaces Foundry approval-pending state as a clear error |
| `finbot-web` | `alphastatetradingacr.azurecr.io/finbot-web:v6` | 3000 | Next.js 16 frontend; `/api/chat` proxies SSE; renders inline charts + stock cards via a render-slot registry; provenance footer shows `as_of` + tool-call id |

All three apps use system-assigned managed identity for ACR pull.

- `finbot-api` MI (`94355d1c-719e-4466-8137-d2e0e871b182`) has `Azure AI User` on the Foundry project.
- `finbot-web` MI (`e30ba527-e2b9-4531-9179-bde1aa8b9096`) has `AcrPull` on the registry.
- `finbot-web` env: `FINBOT_API_URL=https://finbot-api.proudisland-e27da000.westus.azurecontainerapps.io`
- `finbot-api` env: `CORS_ALLOWED_ORIGINS` includes finbot-web URL + `http://localhost:3000`

## Repo Structure

```
Trading-Multi-Agent/
  finbot/
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
          api/chat/route.ts # SSE proxy: POSTs to ${FINBOT_API_URL}/agui
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
2. Next.js → `POST ${FINBOT_API_URL}/agui` with full AG-UI input envelope
3. FastAPI calls Foundry via OpenAI Responses API, sets `previous_response_id` only when `threadId` starts with `resp_`
4. FastAPI streams AG-UI events: `RUN_STARTED` → `TEXT_MESSAGE_START` → `TEXT_MESSAGE_CONTENT` → `TEXT_MESSAGE_END` → `RUN_FINISHED`
5. Browser parses events, accumulates `delta`, persists assistant message and `RUN_FINISHED.threadId` as `Thread.foreignId` for the next turn

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
2. FastAPI's [agent.py](finbot/app/agent.py) iterates `response.output`. For every tool-call item whose parsed JSON has both `data` and `render`, it merges them into a flat payload `{kind, ...render-hints, ...data}`, attaches `source_tool_call_id` (the Foundry `mcp_*` id), and emits one AG-UI `CUSTOM` event per envelope with `name="ui.render"`, between `TEXT_MESSAGE_END` and `RUN_FINISHED`.
3. The frontend SSE parser in [chat-area.tsx](finbot/frontend/src/components/chat-area.tsx) collects these CUSTOM events into a `renderSlots` array on the persisted assistant message.
4. [chat-message.tsx](finbot/frontend/src/components/chat-message.tsx) renders the markdown text then iterates `renderSlots` through [render-slot.tsx](finbot/frontend/src/components/render-slot.tsx), which dispatches on the discriminated union `RenderPayload.kind` to a concrete component (e.g. [chart-card.tsx](finbot/frontend/src/components/chart-card.tsx), [stock-card.tsx](finbot/frontend/src/components/stock-card.tsx)).
5. Every card renders a tiny [render-source.tsx](finbot/frontend/src/components/render-source.tsx) footer showing `as_of` and the tool-call id, so drift between the narrative and the card is visible.

### Division of labor (the narrative-vs-card contract)

Each renderable tool's docstring carries a "DIVISION OF LABOR" section instructing the agent:
- **Do NOT** restate any number the card already shows (price, P/E, market cap, 52w range, etc.). Restating creates drift between the LLM's prose and the source-of-truth card.
- **Do** write interpretation the card can't express: valuation judgement, news context, risks, outlook, shape of a trend.
- Tools include "GOOD reply" / "BAD reply" examples to anchor the pattern.

### Adding a new inline component

1. Add an MCP tool in [mcp-server/server.py](mcp-server/server.py) that returns the envelope `{data, render: {kind: "your_kind"}}`. Include `data.as_of` if applicable. Write its docstring with a DIVISION OF LABOR section.
2. Add a new variant to the `RenderPayload` union in [threads.ts](finbot/frontend/src/lib/threads.ts).
3. Add a case to [render-slot.tsx](finbot/frontend/src/components/render-slot.tsx) and ship the component (use `RenderSource` for the provenance footer).
4. **No FastAPI change needed** — the generic envelope detector picks it up automatically.
5. In the Foundry portal: approve the new tool (auto-approve recommended), then save a new agent version. Pin the env var on `finbot-api`.

### Why AG-UI `CUSTOM`, not text-embedded JSON or `TOOL_CALL_RESULT`

- `CUSTOM` is the AG-UI-blessed channel for arbitrary typed payloads ([docs](https://docs.ag-ui.com/concepts/events)).
- Markdown-fenced sentinels are fragile against LLM hallucination.
- `TOOL_CALL_RESULT` events are meant to flow into the next agent thought, not the UI.

## Known Caveats

- **`useCopilotChat` is abandoned.** The free hook has a destructuring bug — it returns `visibleMessages` but the internal hook only populates `messages`. We bypass CopilotKit entirely; the `/api/copilotkit/*` routes and `proxy.ts` are dead code kept for reference.
- **Use `TEXT_MESSAGE_CONTENT`, never `TEXT_MESSAGE_CHUNK`, when also sending explicit `TEXT_MESSAGE_START`/`END`.** The AG-UI chunk transformer synthesizes a second `TEXT_MESSAGE_START` for the same message ID, which the event validator rejects as "already in progress".
- **CopilotKit thread IDs are plain UUIDs.** Don't pass them to Foundry as `previous_response_id` — Foundry rejects anything that doesn't start with `resp_`.
- **New MCP tools require explicit Foundry approval AND a new agent version.** Adding a tool to `mcp-server/server.py` and rolling `finbot-mcp` is not enough. In the Foundry portal you must (1) approve the new tool (or set it to "auto-approve"), and (2) **save as a new agent version**. Then update `AZURE_EXISTING_AGENT_VERSION` on `finbot-api` to point at the new version. Without the new version, the agent emits `mcp_approval_request` items instead of calling the tool, and `response.output_text` is empty.

## Common Commands

Local dev:
```sh
# API
cd finbot && uv run uvicorn app.main:app --reload --port 8000
# Frontend
cd finbot/frontend && npm run dev
```

Rebuild + redeploy frontend:
```sh
cd finbot/frontend
az acr build --registry alphastatetradingacr --image finbot-web:vN --platform linux/amd64 .
az containerapp update -n finbot-web -g rg-dev --image alphastatetradingacr.azurecr.io/finbot-web:vN
```

Rebuild + redeploy API:
```sh
cd finbot
az acr build --registry alphastatetradingacr --image finbot-api:vN --platform linux/amd64 .
az containerapp update -n finbot-api -g rg-dev --image alphastatetradingacr.azurecr.io/finbot-api:vN
```

Tail logs:
```sh
az containerapp logs show -n finbot-api -g rg-dev --tail 60
az containerapp logs show -n finbot-web -g rg-dev --tail 60
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
