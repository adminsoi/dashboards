# Department dashboards — setup and deployment

The app at `dashboard.soiaviation.com` needs its **own** Entra app
registration.

> If the tenant already has `SOI Aviation MCP API` or
> `SOI Aviation MCP - Claude Client` registrations, do not reuse them. Those are
> an API and a public client; this is a confidential web client with a different
> redirect URI and a client secret. Reusing one will not work.

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

Eight security groups, plus optionally one for people who see everything
and one for managers:

| Dashboard | Suggested group name | Env var |
|---|---|---|
| Government | `SOI-Dash-Government` | `DEPT_GROUP_GOVERNMENT` |
| Procurement | `SOI-Dash-Procurement` | `DEPT_GROUP_PROCUREMENT` |
| Purchasing | `SOI-Dash-Purchasing` | `DEPT_GROUP_PURCHASING` |
| Accounting & Finance | `SOI-Dash-Finance` | `DEPT_GROUP_FINANCE` |
| Administrative | `SOI-Dash-Administrative` | `DEPT_GROUP_ADMINISTRATION` |
| Human Resources | `SOI-Dash-HR` | `DEPT_GROUP_HR` |
| Information Technology | `SOI-Dash-IT` | `DEPT_GROUP_IT` |
| Operations | `SOI-Dash-Operations` | `DEPT_GROUP_OPERATIONS` |
| (every dashboard) | `SOI-Dash-AllAccess` | `DEPT_GROUP_ALL` |
| (RFQ task managers) | `SOI-Dash-Managers` | `DEPT_GROUP_MANAGERS` |

The managers group grants no dashboard access by itself — a manager still
needs the department group. It lets them see every RFQ task in departments
they can open and assign tasks to others.

Use each group's **Object ID**, not its name.

Leave `DEPT_ACCESS_ENFORCE=false` until every id is filled in. While it is
false the app is permissive and says so on its home page, so the state cannot
be mistaken for "locked down". Set it to `true` and redeploy to enforce.

---

## 3. DNS

Add an A record in GoDaddy pointing at this host's public IP:

```
dashboard.soiaviation.com.  A  <this host's public IP>
```

Caddy obtains the certificate automatically on first request, but cannot do so
until DNS resolves — add the record before deploying.

---

## 4. Deploy

The app is standalone: Entra SSO and the dashboard UI, connected to nothing
else.

On the host, by hand:

```bash
git clone https://github.com/adminsoi/dashboards.git
cd dashboards
cp .env.example .env     # fill in the four Entra values
openssl rand -base64 48  # value for SESSION_SECRET
docker compose up --build -d                  # app only
docker compose --profile tls up --build -d    # app + its own HTTPS
```

Use the `tls` profile only if ports 80/443 are free here; otherwise point the
existing web server at `127.0.0.1:3000`.

Through Portainer, which is how this is deployed on EC2, see
[`PORTAINER.md`](PORTAINER.md).

### Verify

```bash
curl -s https://dashboard.soiaviation.com/healthz
```

It reports the auth mode, whether department access is enforced, and which
dashboards have no Entra group configured. No authentication needed, no
secrets returned.

## 5. What the dashboards show today

All seven dashboards render, behind SSO. Every data tile shows "—" with "No
data source is connected yet", because no data source is wired to this app.

That is deliberate, not a gap: the app never displays a figure it cannot
source, and a `0` would be a claim about SOI's business that nothing supports.
Each tile states its own provenance, so what is real and what is pending is
visible at a glance.

To connect a data source later, set `BACKEND_BASE_URL` — and
`BACKEND_SERVICE_TOKEN` if it requires one — and redeploy. The app expects a
small read-only HTTP API; `src/sources/` holds the client and the per-dashboard
loaders, and `src/departments.ts` maps every tile to its source. Nothing else
needs to change.

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
  filesystem (except the `dashboard-data` task-store volume), all
  capabilities dropped, `no-new-privileges`, no published port.
- Read-only toward systems of record: only GETs to the backend. The RFQ task
  tracker writes only to the app's own `tasks.json`, via form posts that carry
  a per-user CSRF token; who may change what is enforced server-side.
- Backend reads carry the signed-in user in `x-soi-user`, so backend logs stay
  attributable to a person.
- Rotating `SESSION_SECRET` immediately invalidates every session.
