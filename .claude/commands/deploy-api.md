---
name: deploy-api
description: Build the FastAPI image with ACR Tasks and roll it out to tradingiq-api. Pass an optional tag argument (e.g. /deploy-api v4); defaults to next available tag.
---

You are deploying the FastAPI backend. Follow these steps and report back at each gate.

## Steps

1. Decide the tag.
   - If `$ARGUMENTS` is set, use it verbatim as `TAG` (e.g. `v4`).
   - Otherwise inspect existing tags with `az acr repository show-tags -n alphastatetradingacr --repository tradingiq-api -o tsv` and propose the next `vN`.
2. Confirm the target tag with the user before building.
3. Run the build:
   ```sh
   cd tradingiq
   az acr build --registry alphastatetradingacr --image tradingiq-api:$TAG --platform linux/amd64 .
   ```
   Run it with `run_in_background: true` — ACR builds take 1-3 minutes.
4. Wait for the build to finish (you'll be notified).
5. Confirm the image appeared in ACR: `az acr repository show-tags -n alphastatetradingacr --repository tradingiq-api -o tsv | grep $TAG`.
6. Ask the user for explicit approval before rolling, since this updates prod.
7. Roll out:
   ```sh
   az containerapp update -n tradingiq-api -g rg-dev --image alphastatetradingacr.azurecr.io/tradingiq-api:$TAG
   ```
8. Smoke test:
   ```sh
   curl -sS -o /dev/null -w "%{http_code}\n" https://tradingiq-api.proudisland-e27da000.westus.azurecontainerapps.io/health
   ```
   Expect `200`.
9. Tail logs briefly: `az containerapp logs show -n tradingiq-api -g rg-dev --tail 30`.
10. Report the new tag, the rollout result, and any log warnings.

## Notes

- Never use `--no-verify` or skip hooks. If the guard blocks something, ask the user.
- The build runs `az acr build`, which classifies as `Bash(az acr build:*)` (allowed). The rollout uses `az containerapp update` which is in the `ask` list — Claude Code will prompt.
- If the rollout fails, do NOT auto-rollback — report and let the user decide.
