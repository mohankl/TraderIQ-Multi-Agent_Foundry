---
name: tail-logs
description: Tail recent logs for one of the deployed Container Apps. Pass `api`, `web`, or `mcp` as argument; defaults to `api`.
---

Tail recent logs for the Container App identified by `$ARGUMENTS`.

Resolve the app name:

| Argument | App |
|---|---|
| `api` or empty | `finbot-api` |
| `web` | `finbot-web` |
| `mcp` | `finbot-mcp` |

Run:

```sh
az containerapp logs show -n <app> -g rg-dev --tail 80
```

Summarize: surface any lines that look like errors, stack traces, or warnings. Quote a few representative lines, don't dump the whole log. If everything looks healthy, say so in one sentence.
