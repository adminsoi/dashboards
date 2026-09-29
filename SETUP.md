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

The dashboards run on `i-019d9663e35988b74`. The MCP connector stack — and the
private backend holding every downstream API credential — runs on a different
instance, `i-0129a9ac033b36673` (`44.230.167.99`).

```
browser ──HTTPS──▶ dashboards host        MCP host
                     dashboard:3000  ───▶  backend:8080  (PRIVATE)
                                    VPC      holds every API credential
                              security-group locked to one instance
```

Docker networks are per-host, so the two cannot share one. The dashboard
reaches the backend across the **VPC private network**. The backend still never
touches the public internet: it is bound to the MCP host's private IP and its
security group admits exactly one source — the dashboards host's security
group.

This app never receives a downstream API credential. It holds only
`BACKEND_SERVICE_TOKEN` and its own Entra secret.

One consequence worth knowing: traffic on that VPC hop is plain HTTP, protected
by the security group and the service token rather than TLS. That is acceptable
inside a single VPC, but it is a real difference from the fully-isolated
original and worth revisiting if the two hosts ever stop being neighbours.

[`PORTAINER.md`](PORTAINER.md) has the exact steps: the `BACKEND_BIND` change
and the security-group rule on the MCP host, DNS, and how TLS terminates.

## 5. Deploy

### Option A — docker compose on the host

```bash
git clone git@github.com:adminsoi/dashboards.git
cd dashboards
cp .env.example .env     # then fill it in
openssl rand -base64 48  # value for SESSION_SECRET
docker compose up --build -d
```

### Option B — Portainer, Git-backed stack  ← how this is deployed on EC2

Full steps, environment variables and troubleshooting are in
[`PORTAINER.md`](PORTAINER.md). In short: Portainer clones this repo on the
host, builds the image, and joins the MCP stack's network. Two prerequisites in
section 4 above (the shared network and the Caddy route) are one-offs over SSH
that Portainer cannot do for you.

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
