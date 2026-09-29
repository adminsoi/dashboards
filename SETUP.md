# Department dashboards — setup and deployment

The app at `dashboard.soiaviation.com` is a browser app, not an MCP connector,
so it needs its **own** Entra app registration. Do not reuse
`SOI Aviation MCP API` or `SOI Aviation MCP - Claude Client`: those are an API
and a public client, and this is a confidential web client with a different
redirect URI and a client secret.

Tenant: `57ded119-c5e8-4224-b902-3d9240e1dfb7` (same directory as M365).

---

## 1. Create the app registration

Entra admin center → **App registrations** → **New registration**.

| Field | Value |
|---|---|
| Name | `SOI Aviation Dashboards` |
| Supported account types | **Accounts in this organizational directory only** (single tenant) |
| Redirect URI | **Web** → `https://dashboard.soiaviation.com/auth/callback` |

The redirect URI must match byte-for-byte, including `https` and no trailing
slash. It is built in code from `PUBLIC_BASE_URL`, so the two must agree or
sign-in fails with `AADSTS50011`.

Record the **Application (client) ID** → `ENTRA_CLIENT_ID`.

### Client secret
**Certificates & secrets** → **New client secret**. Copy the *Value* (shown
once) → `ENTRA_CLIENT_SECRET`. Note the expiry and set a calendar reminder;
sign-in breaks the day it lapses.

### Token configuration — the groups claim
Department access needs group ids in the token. **Token configuration** →
**Add groups claim** → select **Security groups** → under **ID**, tick
**Group ID**.

Without this the app still works, but every user arrives with no groups. That
fails safe, not open: with `DEPT_ACCESS_ENFORCE=true` they see nothing.

> If users belong to many groups, Entra may emit a `_claim_names` overage
> reference instead of the list. If that happens, use app roles instead — the
> code already accepts a `roles` claim — or raise it with whoever owns the
> directory.

### API permissions
Only `openid`, `profile`, `email` (Microsoft Graph delegated, default). The
dashboards read SOI data through SOI's own backend, not Graph, so **no Graph
data permissions and no admin consent are required.**

---

## 2. Create the department groups

Seven security groups, plus optionally one for people who see everything:

| Dashboard | Suggested group name | Env var |
|---|---|---|
| Government | `SOI-Dash-Government` | `DEPT_GROUP_GOVERNMENT` |
| Procurement | `SOI-Dash-Procurement` | `DEPT_GROUP_PROCUREMENT` |
| Purchasing | `SOI-Dash-Purchasing` | `DEPT_GROUP_PURCHASING` |
| Finance | `SOI-Dash-Finance` | `DEPT_GROUP_FINANCE` |
| Human Resources | `SOI-Dash-HR` | `DEPT_GROUP_HR` |
| Information Technology | `SOI-Dash-IT` | `DEPT_GROUP_IT` |
| Operations | `SOI-Dash-Operations` | `DEPT_GROUP_OPERATIONS` |
| (every dashboard) | `SOI-Dash-AllAccess` | `DEPT_GROUP_ALL` |

Use each group's **Object ID**, not its name.

Leave `DEPT_ACCESS_ENFORCE=false` until every id is filled in. While it is
false the app is permissive and says so on its home page, so the state cannot
be mistaken for "locked down". Set it to `true` and redeploy to enforce.

---

## 3. DNS

Add an A record in GoDaddy alongside the existing `mcp-*` records:

```
dashboard.soiaviation.com.  A  44.230.167.99
```

Caddy obtains the certificate automatically on first request, but cannot do so
until DNS resolves — add the record before deploying.

---

## 4. How this fits the existing stack

This repo is standalone, with one deliberate coupling: it joins the MCP
connector stack's Docker network. That is what lets the dashboard reach the
private backend, and lets Caddy reach the dashboard.

```
browser ──HTTPS──▶ Caddy (MCP stack) ──▶ dashboard:3000 (this repo)
                                              │
                                              ▼
                                    backend:8080 (MCP stack, PRIVATE)
                                       holds every API credential
```

Two prerequisites on the host, both one-offs:

1. **The MCP stack is running**, so its network and `backend` container exist.
   Confirm the network name and set `SOI_NETWORK` if it differs from the
   default `soi-aviation-mcp_default`:
   ```bash
   docker network ls | grep soi
   ```
2. **Caddy routes the hostname.** The MCP repo's `Caddyfile` already contains:
   ```
   dashboard.soiaviation.com {
       reverse_proxy dashboard:3000
   }
   ```
   Reload Caddy after adding it:
   ```bash
   docker compose -f docker-compose.multi.yml restart caddy
   ```

This app never receives a downstream API credential. It holds only
`BACKEND_SERVICE_TOKEN` and its own Entra secret.

---

## 5. Deploy

### Option A — docker compose on the host

```bash
git clone git@github.com:adminsoi/dashboards.git
cd dashboards
cp .env.example .env     # then fill it in
openssl rand -base64 48  # value for SESSION_SECRET
docker compose up --build -d
```

### Option B — Portainer, Git-backed stack

Portainer → **Stacks** → **Add stack** → **Repository**.

| Field | Value |
|---|---|
| Repository URL | `https://github.com/adminsoi/dashboards` |
| Reference | `refs/heads/main` |
| Compose path | `docker-compose.yml` |
| Authentication | on — the repo is private, so use a PAT or deploy key |

Add the variables from `.env.example` under **Environment variables** rather
than committing a `.env`. Enable **GitOps updates** (poll or webhook) if you
want pushes to `main` to redeploy.

Portainer names the network `<stack-name>_default`, but this stack uses an
**external** network, so that does not apply — just make sure `SOI_NETWORK`
matches the MCP stack's actual network name.

### Verify

```bash
curl -s https://dashboard.soiaviation.com/healthz
```

It reports `authMode`, whether department access is enforced, and which
dashboards still have no group configured. It needs no authentication and
returns no secrets, so it is safe for an uptime check.

---

## 6. What the dashboards show today

The app never displays a figure it cannot source. Tiles whose integration is
not wired render an em dash and the reason, under a visible placeholder banner.
They are never rendered as `0`.

| Dashboard | Source | Status |
|---|---|---|
| Government | SAM.gov, via the private backend | **Live** — open solicitations, closing within 7 days, posted this week, set-aside count, latest notices |
| Information Technology | Health probes of the container fleet | **Live** — per-service up/down, pending integrations, SSO tenant |
| Procurement | Pentagon 2000 | Placeholder — backend returns 501 |
| Purchasing | Pentagon 2000 | Placeholder — backend returns 501 |
| Finance | Pentagon 2000 | Placeholder — backend returns 501 |
| Operations | Pentagon 2000 | Placeholder — backend returns 501 |
| Human Resources | HR system | Placeholder — no integration exists |

SAM.gov is public data and sits on the Government dashboard only. Every other
dashboard is marked internal-only in the UI.

### Wiring Pentagon 2000
In the **MCP repo**, `backend/server.mjs` currently answers
`notIntegrated("Pentagon 2000")` for `/v1/inventory` and `/v1/rfqs/*`. To go
live:

1. Replace those handlers with real Pentagon 2000 calls, reading the base URL
   and credentials from env, and add those vars to the **`backend`** service in
   `docker-compose.multi.yml`. Credentials belong in the private backend only,
   never in this container.
2. Prefer adding small summary endpoints (e.g. `/v1/summary/purchasing`) that
   return counts, so the dashboards don't pull whole record sets just to
   length them.
3. Point `metricFrom` in `src/sources/pentagon.ts` at those fields.

Nothing else in this repo needs to change.

---

## Security notes

- Confidential client: the code-for-token exchange is server-side and no token
  ever reaches the browser. The session is an HMAC-signed, `httpOnly` cookie
  holding only identity and group ids.
- CSRF and replay are covered by `state` and a nonce bound into the id_token;
  PKCE (S256) is used even though this is a confidential client.
- The app ships **no client-side JavaScript**, so its CSP denies scripts
  outright (`default-src 'none'`).
- Third-party text (SAM.gov titles, agency names) is HTML-escaped, and links
  are rejected unless they are plain `http(s)`.
- Same container hardening as the connectors: non-root, read-only root
  filesystem, all capabilities dropped, `no-new-privileges`, no published port.
- Read-only: only GETs to the backend, and no write path to any system of
  record.
- Backend reads carry the signed-in user in `x-soi-user`, so backend logs stay
  attributable to a person.
- Rotating `SESSION_SECRET` immediately invalidates every session.
