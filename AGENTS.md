# Agent Onboarding — Trading Multi-Agent

This file is the shared context entry point for **any** coding agent working in this repo (Claude Code, Codex, generic LLM agents). For human-oriented setup, see the repo `README.md`.

The canonical knowledge base is [CLAUDE.md](CLAUDE.md). Read it first — it is short, kept current, and covers:

- Live Azure URLs
- Deployed image tags
- Repo layout
- Auth model
- The Foundry → FastAPI → Next.js streaming flow
- Known caveats (CopilotKit destructuring bug, AG-UI event invariants, Foundry `resp_` prefix rule)

## What you should do as an agent in this repo

1. **Read [CLAUDE.md](CLAUDE.md) before any non-trivial change.** Don't reconstruct facts that already live there.
2. **Confirm before mutating shared cloud resources.** That includes `az containerapp update`, `az role assignment create`, `git push`, image rollouts. Local dev (`uv run uvicorn`, `npm run dev`) is fine without asking.
3. **Match the existing event invariants** when touching the streaming path. The combo `TEXT_MESSAGE_START` + `TEXT_MESSAGE_CONTENT` (deltas) + `TEXT_MESSAGE_END` is what the frontend parser expects. Don't introduce `TEXT_MESSAGE_CHUNK` into a flow that already emits explicit start/end — see the caveat in CLAUDE.md.
4. **Update CLAUDE.md when reality drifts.** If you bump an image tag, change an env var, add a tool to the MCP server, or change an FQDN, also update CLAUDE.md (or run `/update-claude-md` if you're in Claude Code).
5. **Avoid bringing in new top-level deps.** Both `finbot/` and `finbot/frontend/` have a deliberate dependency set. If you genuinely need something new, ask first.

## Tool / SDK pointers for non-Claude agents

| Concern | Use |
|---|---|
| Azure CLI auth | `DefaultAzureCredential` (Python), `az login` locally |
| Foundry agent invocation | OpenAI Responses API via `AIProjectClient(...).get_openai_client()` |
| MCP tools | `FastMCP` with `stateless_http`, `X-API-Key` header |
| Frontend streaming | Browser fetch → Next.js `/api/chat` route → FastAPI `/agui` (AG-UI SSE) |
| State machine for AG-UI events | See `@ag-ui/client` `verifyEvents` operator — events must be properly nested |

## Where to make different kinds of changes

| Change | File |
|---|---|
| Add a new MCP tool | [mcp-server/server.py](mcp-server/server.py) |
| Change the Foundry call shape | [finbot/app/agent.py](finbot/app/agent.py) |
| Add an HTTP endpoint to FastAPI | [finbot/app/main.py](finbot/app/main.py) |
| Change chat UI behavior | [finbot/frontend/src/components/chat-area.tsx](finbot/frontend/src/components/chat-area.tsx) |
| Change SSE proxy behavior | [finbot/frontend/src/app/api/chat/route.ts](finbot/frontend/src/app/api/chat/route.ts) |
| Bump frontend container | [finbot/frontend/Dockerfile](finbot/frontend/Dockerfile) |
| Bump backend container | [finbot/Dockerfile](finbot/Dockerfile) |
| Add a new inline UI component (e.g. heatmap) | New `kind` in `RenderPayload` union in [finbot/frontend/src/lib/threads.ts](finbot/frontend/src/lib/threads.ts), new case in [finbot/frontend/src/components/render-slot.tsx](finbot/frontend/src/components/render-slot.tsx), and matching MCP tool + extractor in [finbot/app/agent.py](finbot/app/agent.py) |

## Git conventions

- Commit subject: one short line, imperative mood, lowercase ("add foo", not "Added Foo").
- Tag major checkpoints (`v1.0`, `v2.0`, `v8.0`). Push tags with `git push origin <tag>`.
- Never force-push `main`. The Claude Code prod-guard hook blocks this; for other agents, just don't.
