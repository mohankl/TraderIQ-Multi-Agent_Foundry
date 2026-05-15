---
name: update-claude-md
description: Reconcile CLAUDE.md and AGENTS.md against current deployed state. Proposes a diff and asks for approval before writing.
---

You are reconciling `CLAUDE.md` (and its mirror `AGENTS.md`) with the real deployed state. Goal: keep the file truthful without bloat.

## Steps

1. Read the current `CLAUDE.md`.
2. Cross-check the **live facts** that go stale fastest:
   - Container app image tags
     ```sh
     az containerapp show -n finbot-api -g rg-dev --query "properties.template.containers[0].image" -o tsv
     az containerapp show -n finbot-web -g rg-dev --query "properties.template.containers[0].image" -o tsv
     az containerapp show -n finbot-mcp -g rg-dev --query "properties.template.containers[0].image" -o tsv
     ```
   - Public FQDNs
     ```sh
     az containerapp list -g rg-dev --query "[].{name:name, fqdn:properties.configuration.ingress.fqdn}" -o tsv
     ```
   - Foundry agent version
     ```sh
     az containerapp show -n finbot-api -g rg-dev --query "properties.template.containers[0].env[?name=='AZURE_EXISTING_AGENT_VERSION'].value" -o tsv
     ```
   - CORS allowed origins
     ```sh
     az containerapp show -n finbot-api -g rg-dev --query "properties.template.containers[0].env[?name=='CORS_ALLOWED_ORIGINS'].value" -o tsv
     ```
   - Repo structure (compare to actual): `find finbot -maxdepth 3 -type d`
3. List the deltas you found vs `CLAUDE.md`. Be specific (line numbers, before/after).
4. Propose Edit tool calls for `CLAUDE.md` and the mirrored sections of `AGENTS.md`.
5. Ask the user to approve the edits.
6. After applying, suggest a commit message like `docs(claude): sync CLAUDE.md with deployed state` (do not commit without explicit user approval).

## Style guardrails

- Keep `CLAUDE.md` under ~400 lines. If you'd add a long block, condense or move detail to a referenced file.
- Use markdown link syntax for file references: `[name](relative/path)`.
- Never invent facts. If you can't verify a value, mark it `TODO(verify): ...` instead.
- Don't paste full commands that are already in the "Common Commands" section — link/reference them.
