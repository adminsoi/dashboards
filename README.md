# SOI Aviation — department dashboards

A minimal web app with one dashboard per department (Government,
Procurement, Purchasing, Accounting & Finance, Administrative, HR, IT,
Operations), behind Microsoft Entra SSO.

Entra setup and deployment: [`SETUP.md`](SETUP.md).
Deploying through Portainer: [`PORTAINER.md`](PORTAINER.md).

Standalone: SSO and the dashboard UI, connected to nothing else. A data source
is optional and off by default — until one is configured, every data tile
honestly reports that nothing is connected.

## Design rules

1. **Never show a number we can't source.** A tile is either live or it shows
   an em dash plus the reason. Unwired integrations never render as `0`, and any
   page containing one carries a placeholder banner.
2. **Minimal secrets.** The app holds its own Entra secret and a session key.
   A data source, if one is ever configured, is reached read-only.
3. **Read-only toward systems of record.** Only GETs to the backend. The one
   thing the app writes is its own RFQ task store (below).
4. **No client-side JavaScript**, so the CSP can deny scripts outright. Task
   edits are plain HTML form posts carrying a CSRF token.
5. **Two accent colours** — SOI red and SOI blue — and nothing else.

## Layout

```
src/
  server.ts            routes, security headers, auth gate
  config.ts            env parsing; refuses unsafe combinations at startup
  auth.ts              Entra OIDC authorization-code + PKCE
  session.ts           HMAC-signed cookie sessions (no server store)
  access.ts            department access from Entra group claims
  departments.ts       THE REGISTRY — departments, tiles, and each tile's source
  tasks.ts             RFQ task store and who-may-do-what rules
  sources/
    backend.ts         client for the optional data source
    metrics.ts         per-department loaders
    pentagon.ts        ERP adapter — the one file to edit when wired
    services.ts        health probes powering the IT dashboard
  views/
    html.ts            escaping + page shell
    pages.ts           page renderers
    styles.ts          the whole stylesheet
```

To add a tile, add it to `departments.ts` with its `source`, then return a
`Metric` for it from the matching loader in `sources/metrics.ts`.

## RFQ task tracker

Procurement and Purchasing carry an RFQ list with the columns **Part number,
Customer, Assigned to, Due date, Status (✓ / ✗), Notes**. It is the
dashboard's own data (`tasks.json` on the `dashboard-data` volume), not
Pentagon 2000.

| | Manager (`DEPT_GROUP_MANAGERS`) | Everyone else |
|---|---|---|
| Sees | every task in the department | only tasks assigned to them |
| Creates | for anyone | for themselves only |
| Edits / deletes | any task | only tasks they created |
| Tasks a manager assigned them | — | read-only |

Rules live in `src/tasks.ts` and are enforced server-side. Back up the
`dashboard-data` volume; it is the only state the app keeps.

## Claude

Every department page has a Claude panel linking to that department's Claude
project (`CLAUDE_PROJECT_<SLUG>`), plus a "New chat" link and a Claude link in
the top bar. claude.ai refuses to be framed inside another site, so these open
in a new tab rather than embedding — no API key is involved.

## Local development

```bash
npm install
cp .env.example .env     # AUTH_MODE=none skips SSO for UI work
npm run dev
```

`AUTH_MODE=none` signs you in as a local dev user and is refused when
`NODE_ENV=production`. Set `DEV_ROLE=user` to see the tracker as a non-manager.

```bash
npm run build && npm start   # production build
```

## Deploy

```bash
docker compose up --build -d
```

Add `--profile tls` to run the bundled Caddy for HTTPS, if ports 80/443 are
free on the host.

On EC2 this is deployed as a Portainer Git stack — see
[`PORTAINER.md`](PORTAINER.md).

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `/` | required | department index |
| `/d/:slug` | required + group check | one department dashboard |
| `POST /d/:slug/tasks[/:id/status\|notes\|delete]` | required + group check + CSRF | RFQ task writes |
| `/auth/start`, `/auth/callback` | — | Entra sign-in |
| `/signout`, `/signed-out` | — | ends the app *and* Entra session |
| `/healthz` | none | status, auth mode, access posture |
| `/assets/app.css` | none | the stylesheet |
