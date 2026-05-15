# Entra ID Rollout — Phase 0 Spike + Phase 1 App-Registration Spec

**Status:** planning. No code shipped. **Owner:** mohan@alphastate.ai. **Target tag:** v12.0.

This document covers the first two phases of the Entra ID rollout described in [README.md](README.md#roadmap):

- **Phase 0** — Verification spike. Two unknowns must clear before we commit engineering time to Phases 2–4.
- **Phase 1** — Entra app registrations + tenant configuration. Portal-click work, no code, produces the IDs/scopes the later phases consume.

Once both phases are signed off, Phase 2 (frontend sign-in) starts. Phases 3 and 4 follow on the API and MCP servers. The C# MCP server lands **after** Phase 4 — born Entra-protected from day one.

---

## Why this doc exists

Entra OBO into a Foundry **v2** agent (Responses API) is the most uncertain piece of the design. The Foundry v2 agent path is new enough that docs lag behind the SDK, and we don't want to discover mid-Phase-3 that OBO isn't supported and we need to fall back to MI + per-user thread IDs in app state.

Phase 0 spends ~½ day proving the two load-bearing assumptions. Phase 1 is portal work that's tedious to redo, so we want it specified once and executed cleanly.

---

## Phase 0 — Verification Spike

**Goal:** prove that the two non-obvious capabilities exist before we build on them.

**Cost:** ~4 hours. One throwaway script (`scripts/entra-spike.py`, deleted after) and one Foundry portal poke.

**Output:** a one-paragraph go/no-go memo appended to this file under [§ Phase 0 Results](#phase-0-results).

### Assumption 1 — Foundry v2 agent accepts a delegated user token

`AIProjectClient` today is constructed with `DefaultAzureCredential()` (a managed identity / service principal credential). For per-user threads, we need it to accept a token acquired **on behalf of** the user via OBO.

**Test plan:**

1. Acquire a user access token interactively (one-off, using `az account get-access-token --resource https://ai.azure.com`):

   ```sh
   az login   # interactive, as yourself
   az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv
   ```

2. Wrap it in a `TokenCredential` shim:

   ```python
   from azure.core.credentials import AccessToken, TokenCredential
   import time

   class StaticTokenCredential(TokenCredential):
       def __init__(self, token: str, expires_on: int):
           self._token = token
           self._expires_on = expires_on
       def get_token(self, *scopes, **kwargs) -> AccessToken:
           return AccessToken(self._token, self._expires_on)
   ```

3. Instantiate the project client with it and run one Responses-API call:

   ```python
   from azure.ai.projects import AIProjectClient
   project = AIProjectClient(
       endpoint="https://alpha-state-trading-multi-agent.services.ai.azure.com/api/projects/alpha-state-trading-MMA",
       credential=StaticTokenCredential(token, expires_on=int(time.time()) + 3600),
   )
   openai = project.get_openai_client()
   resp = openai.responses.create(
       model="alphastate-trading-mma-agent",
       agent_reference={"name": "alphastate-trading-mma-agent", "version": "19"},
       input=[{"role": "user", "content": "hello"}],
   )
   print(resp.id, resp.output_text[:100])
   ```

**Pass criteria:** the call returns a response_id and output text without `AuthenticationError`. The Foundry **Tracing** tab shows the span attributed to the user (look for `enduser.id` or `gen_ai.user.id` in span attributes).

**Fail mode:** if Foundry rejects the token with `audience mismatch` or `caller is not authorized`, we fall back to **Plan B**:

> API uses MI as today, but stamps every Foundry call with a synthetic `user_id` and we manage per-user thread isolation in app state. We lose Foundry-native RBAC per user but keep everything else.

This is a fine fallback — it just means the [README roadmap entry](README.md#roadmap) for "per-user threads" gets implemented in our DB, not in Foundry.

### Assumption 2 — Foundry MCP attachment supports OAuth

Today the agent's MCP attachment uses **"Custom header"** mode and sends `X-API-Key: <value>`. For Entra-protected MCP, Foundry needs to fetch an access token (client-credentials or OBO) and send `Authorization: Bearer <token>`.

**Test plan:**

1. Open the agent in the Foundry portal → **Tools** tab → click the existing `tradingiq-mcp` attachment.
2. Look for an **authentication mode** dropdown. Options we need to see:
   - "Custom header" (current)
   - "OAuth 2.0 client credentials" — Foundry holds a client ID/secret for an app registration, fetches token, sends to MCP. **This is the one we want.**
   - Possibly "Managed identity" or "OBO" — would be even better but unlikely.

**Pass criteria:** OAuth mode is present and configurable with `resource` / `scope` fields.

**Fail mode:** if Foundry only supports custom header today, we have two workarounds:

- **Workaround A:** keep header auth but rotate to a long random secret in Key Vault, referenced via Container Apps secret. We already do this for `mcp-api-key`; it's the status quo.
- **Workaround B:** put an Entra-protected reverse proxy in front of the MCP server. Foundry calls the proxy with the header; the proxy validates against Entra and forwards. Extra hop, extra cost, extra complexity. Not recommended unless we have a hard compliance requirement.

If we hit Fail Mode B, the C# MCP server still benefits from Entra (clients other than Foundry can call it with bearer tokens), so the work isn't wasted — but the **Foundry → MCP** boundary stays on a shared secret.

### Phase 0 Results

_Fill this in after running the spike. Format:_

```
Date:
Assumption 1 (Foundry accepts delegated user token): PASS | FAIL — notes
Assumption 2 (Foundry MCP OAuth mode):               PASS | FAIL — notes
Decision: PROCEED to Phase 1 | PROCEED with fallback X | HALT and rescope
```

---

## Phase 1 — Entra App Registrations

**Goal:** stand up four app registrations in the Entra tenant, expose the right scopes, grant the right delegated permissions, and produce a config artifact the later phases consume.

**Cost:** ~1–2 hours of portal clicking, assuming admin rights in the tenant.

**Output:** [`.entra-config.json`](#config-artifact) (gitignored) and the [§ Phase 1 Checklist](#phase-1-checklist) below all ticked.

### Tenant prerequisites

- **Tenant ID:** confirm with `az account show --query tenantId -o tsv`. Should match the tenant that owns the Foundry project `alpha-state-trading-MMA`.
- **Admin rights:** you need **Application Administrator** or **Cloud Application Administrator** at minimum to create app registrations and grant admin consent. If you don't have these, identify who does and pair on the portal steps.
- **Foundry agent in the same tenant:** verify via `az ai-projects show ...` — if Foundry is in a different tenant, OBO becomes cross-tenant and the design changes materially.

### The four app registrations

| App registration | Type | Purpose |
|---|---|---|
| `tradingiq-web` | SPA (Single-page application) | Public client. Acquires user tokens via auth-code + PKCE. Holds no secret. |
| `tradingiq-api` | Web API | Validates incoming user tokens. Exchanges them for Foundry-scoped tokens via OBO. Holds a client secret. |
| `tradingiq-mcp` | Web API | Validates Foundry's bearer token on `/mcp`. Does not hold a secret unless Foundry uses client-credentials. |
| `tradingiq-csharp-mcp` | Web API | Same as `tradingiq-mcp` but for the C# server we'll build later. Spec'd here so the IDs exist when we get there. |

### Scopes exposed

Each Web API registration exposes one scope. The frontend / Foundry agent request these scopes on behalf of users.

| Registration | Scope value | Admin consent? | Description |
|---|---|---|---|
| `tradingiq-api` | `access_as_user` | Yes | Lets the frontend call `/agui` on behalf of the signed-in user. |
| `tradingiq-mcp` | `invoke` | Yes | Lets Foundry call MCP tools on this server. |
| `tradingiq-csharp-mcp` | `invoke` | Yes | Same, for the C# server. |

Full scope URIs (used in code):

- `api://tradingiq-api/access_as_user`
- `api://tradingiq-mcp/invoke`
- `api://tradingiq-csharp-mcp/invoke`

**Note on the `api://` URIs:** these are the **Application ID URIs**, set on each Web API registration's *Expose an API* page. They default to `api://<client-id>` — override to `api://tradingiq-api` etc. so the scope strings are human-readable.

### API permissions matrix

| Caller | Resource | Permission | Type |
|---|---|---|---|
| `tradingiq-web` | `tradingiq-api` | `access_as_user` | Delegated |
| `tradingiq-web` | Microsoft Graph | `User.Read` | Delegated (default) |
| `tradingiq-api` | Azure AI (resource `https://ai.azure.com`) | `user_impersonation` | Delegated (for OBO) |
| Foundry agent | `tradingiq-mcp` | `invoke` | Delegated (if OBO) or App (if client-credentials) — **depends on Phase 0 Assumption 2 outcome** |
| Foundry agent | `tradingiq-csharp-mcp` | `invoke` | Same |

**Admin consent** is required for all of these. Click **"Grant admin consent for &lt;tenant&gt;"** at the top of each *API permissions* page after adding them.

### Redirect URIs

- `tradingiq-web`:
  - `https://tradingiq-web.proudisland-e27da000.westus.azurecontainerapps.io/auth/callback` (prod)
  - `http://localhost:3000/auth/callback` (local dev)
  - Type: **SPA** (not Web — SPA gives you implicit + auth-code + PKCE, which MSAL.js expects).

- `tradingiq-api`, `tradingiq-mcp`, `tradingiq-csharp-mcp`: **no redirect URIs** — these are confidential APIs, not interactive clients.

### Client secrets

- `tradingiq-api`: **one client secret** (24-month expiry). Store in Container App secret `entra-api-client-secret`. Used by the OBO call.
- `tradingiq-mcp`, `tradingiq-csharp-mcp`: no secret needed if Foundry uses OBO. If Foundry uses client-credentials, the credentials live on **Foundry's** app registration (configured in the Foundry portal's MCP attachment), not on the MCP server's registration.
- `tradingiq-web`: **no secret** — it's a public client (SPA).

### Token configuration

On `tradingiq-api`:
- **Access tokens — version 2** (set in *Manifest* if not default).
- **Token lifetime:** default (1 hour) is fine.

On `tradingiq-mcp` and `tradingiq-csharp-mcp`:
- Same. Version 2 tokens are mandatory for JWT validation with the libraries we're using (PyJWT, Microsoft.Identity.Web).

### Optional groups / roles

For per-user RBAC inside Foundry (e.g. "only the equity-research team can use this agent"), we'd later add an **app role** like `EquityResearch.User` on `tradingiq-api` and assign users/groups to it. Out of scope for Phase 1 — list here so we don't forget it.

### Config artifact

After Phase 1 is done, write `.entra-config.json` at the repo root **(gitignored — contains client IDs which are not secret but are tenant-specific)**:

```json
{
  "tenantId": "TODO",
  "registrations": {
    "tradingiqWeb":       { "clientId": "TODO", "scopes": ["api://tradingiq-api/access_as_user"] },
    "tradingiqApi":       { "clientId": "TODO", "audience": "api://tradingiq-api" },
    "tradingiqMcp":       { "clientId": "TODO", "audience": "api://tradingiq-mcp" },
    "tradingiqCsharpMcp": { "clientId": "TODO", "audience": "api://tradingiq-csharp-mcp" }
  }
}
```

Phase 2/3/4 code reads these IDs at deploy time (Container App env vars). The client **secret** for `tradingiq-api` does NOT go in this file — it goes directly into Azure Container Apps Secrets via `az containerapp secret set`.

Add `.entra-config.json` to `.gitignore` even though it isn't strictly secret — it's tenant-specific and would noise up the repo if accidentally committed.

### Phase 1 Checklist

Work top-to-bottom in the Entra portal. Each line should be checkable before moving on.

#### `tradingiq-web`
- [ ] Created. Account type: **single tenant** (unless multi-tenant is required).
- [ ] Platform: **SPA**. Redirect URIs: prod FQDN `/auth/callback` + `http://localhost:3000/auth/callback`.
- [ ] *API permissions* → add `tradingiq-api/access_as_user` (delegated). Add Microsoft Graph `User.Read` (delegated).
- [ ] **Grant admin consent** for the tenant.
- [ ] Copy client ID → `.entra-config.json:registrations.tradingiqWeb.clientId`.

#### `tradingiq-api`
- [ ] Created. Single tenant.
- [ ] *Expose an API* → set Application ID URI to `api://tradingiq-api`.
- [ ] Add scope `access_as_user`. Display name: "Access Trading IQ API as user". Description: "Calls the Trading IQ chat API on behalf of the signed-in user." Consent: **Admins and users**.
- [ ] *Manifest* → confirm `accessTokenAcceptedVersion: 2`. (Set explicitly if it shows `null`.)
- [ ] *API permissions* → add Azure AI (`https://ai.azure.com/.default`) delegated. **Grant admin consent.**
- [ ] *Certificates & secrets* → new client secret, 24-month expiry, description "OBO to Foundry". Copy the **value** (only shown once) into Container Apps secret `entra-api-client-secret` via `az containerapp secret set` (later, during Phase 3).
- [ ] Copy client ID → `.entra-config.json:registrations.tradingiqApi.clientId`.

#### `tradingiq-mcp`
- [ ] Created. Single tenant.
- [ ] *Expose an API* → set Application ID URI to `api://tradingiq-mcp`.
- [ ] Add scope `invoke`. Display name: "Invoke Trading IQ MCP tools". Description: "Calls MCP tools on the Trading IQ MCP server." Consent: **Admins only**.
- [ ] *Manifest* → confirm `accessTokenAcceptedVersion: 2`.
- [ ] Copy client ID → `.entra-config.json:registrations.tradingiqMcp.clientId`.

#### `tradingiq-csharp-mcp`
- [ ] Created. Single tenant.
- [ ] *Expose an API* → set Application ID URI to `api://tradingiq-csharp-mcp`.
- [ ] Add scope `invoke`. Display name: "Invoke Trading IQ C# MCP tools". Description: "Calls MCP tools on the Trading IQ C# MCP server." Consent: **Admins only**.
- [ ] *Manifest* → confirm `accessTokenAcceptedVersion: 2`.
- [ ] Copy client ID → `.entra-config.json:registrations.tradingiqCsharpMcp.clientId`.

#### Foundry portal — MCP attachment auth
*(Skip until Phase 0 Assumption 2 is confirmed PASS.)*
- [ ] On agent `alphastate-trading-mma-agent`, edit MCP attachment for `tradingiq-mcp`.
- [ ] Switch auth mode from "Custom header" to OAuth.
- [ ] Set resource = `api://tradingiq-mcp`, scope = `invoke`.
- [ ] **Save as new agent version (v20).**

#### Wrap-up
- [ ] `.entra-config.json` filled in and saved locally.
- [ ] `.gitignore` updated to exclude `.entra-config.json`.
- [ ] Phase 0 results section updated.
- [ ] [README.md](README.md) Roadmap entry for "Entra ID + per-user threads" updated with the Phase 1 completion date.
- [ ] Ready for Phase 2.

---

## Out of scope (deferred to later phases)

- **Code changes** in `tradingiq-web`, `tradingiq-api`, `tradingiq-mcp` — that's Phases 2–4.
- **OBO implementation details** — Phase 3 will spec the exact MSAL Python call and `TokenCredential` shim.
- **Per-user thread storage** — depends on Phase 0 Assumption 1 outcome. Either Foundry-native (PASS) or app-state DB (FAIL).
- **C# MCP server** — born Entra-protected after Phase 4 closes. Spec in a separate doc when we get there.
- **App roles for RBAC** — listed above as future work.
- **M365 / Teams publishing** — depends on Entra rollout completing. Separate workstream.

---

## Open questions

1. **Single tenant vs multi-tenant?** Single-tenant is the default and is what this doc assumes. Multi-tenant is needed if Trading IQ is ever published as a Teams app for external orgs — out of scope today.
2. **Local dev auth bypass.** Phase 2 will introduce `AUTH_DEV_BYPASS=true` env that injects a fixture user. We need to decide if this also applies to API + MCP (yes, for parity) and how to make sure it can never be enabled in prod (Container Apps env var allowlist on a CI gate).
3. **Group-based access.** Do we want only `@alphastate.ai` users, or any tenant member? Decided at Phase 2 sign-in config time.
