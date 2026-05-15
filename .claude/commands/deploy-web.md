---
name: deploy-web
description: Build the Next.js frontend image via ACR Tasks and roll it out to finbot-web. Pass an optional tag argument (e.g. /deploy-web v3); defaults to next available tag.
---

You are deploying the Next.js frontend. Follow these steps and report back at each gate.

## Steps

1. Decide the tag.
   - If `$ARGUMENTS` is set, use it verbatim as `TAG`.
   - Otherwise inspect existing tags with `az acr repository show-tags -n alphastatetradingacr --repository finbot-web -o tsv` and propose the next `vN`.
2. Confirm the target tag with the user before building.
3. Run the build:
   ```sh
   cd tradingiq/frontend
   az acr build --registry alphastatetradingacr --image finbot-web:$TAG --platform linux/amd64 .
   ```
   Use `run_in_background: true`.
4. Wait for the build to finish (notification arrives).
5. Confirm the image is in ACR: `az acr repository show-tags -n alphastatetradingacr --repository finbot-web -o tsv | grep $TAG`.
6. Ask the user for explicit approval before rolling.
7. Roll out:
   ```sh
   az containerapp update -n finbot-web -g rg-dev --image alphastatetradingacr.azurecr.io/finbot-web:$TAG
   ```
8. Smoke test from the deployed UI:
   ```sh
   curl -sS -o /dev/null -w "%{http_code}\n" https://finbot-web.proudisland-e27da000.westus.azurecontainerapps.io/
   ```
   Expect `200`.
9. Optionally run an end-to-end test with Playwright MCP: navigate, start a chat, send "AAPL fundamentals", and confirm a streamed reply renders.
10. Tail logs briefly: `az containerapp logs show -n finbot-web -g rg-dev --tail 30`.
11. Report the new tag, rollout result, and any warnings.

## Notes

- The `next.config.ts` must have `output: "standalone"` for the Dockerfile to work — verify before building.
- If the frontend reports 404 from `/api/chat`, check that `finbot-api` is on an image that exposes `/agui` (v3 or later).
