# SOI Aviation — department dashboards

A minimal, read-only web app with one dashboard per department (Government,
Procurement, Purchasing, Finance, HR, IT, Operations), behind Microsoft Entra
SSO.

Deployment and Entra setup: [`SETUP.md`](SETUP.md).

This repo is deliberately standalone. It shares only a Docker network with the
MCP connector stack, so it can reach that stack's private backend — which is
where every downstream API credential lives.

## Design rules

1. **Never show a number we can't source.** A tile is either live or it shows
   an em dash plus the reason. Unwired integrations never render as `0`, and any
   page containing one carries a placeholder banner. This mirrors the MCP
   server's existing "honest 501" posture.
2. **Credentials stay in the private backend.** This app holds only
   `BACKEND_SERVICE_TOKEN` and its own Entra secret — no downstream API keys.
3. **Read-only.** Only GETs to the backend. No write path to a system of record.
4. **No client-side JavaScript**, so the CSP can deny scripts outright.
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
  sources/
    backend.ts         client for the private backend
    metrics.ts         per-department loaders
    pentagon.ts        Pentagon 2000 adapter — the one file to edit when wired
    services.ts        health probes powering the IT dashboard
  views/
    html.ts            escaping + page shell
    pages.ts           page renderers
    styles.ts          the whole stylesheet
```

To add a tile, add it to `departments.ts` with its `source`, then return a
`Metric` for it from the matching loader in `sources/metrics.ts`.

## Local development

```bash
npm install
cp .env.example .env     # AUTH_MODE=none skips SSO for UI work
npm run dev
```

`AUTH_MODE=none` signs you in as a local dev user and is refused when
`NODE_ENV=production`. To exercise the live Government tiles, point
`BACKEND_BASE_URL` at a running instance of the MCP stack's backend.

```bash
npm run build && npm start   # production build
```

## Deploy

```bash
docker compose up --build -d
```

Requires the MCP stack to be running (for its network and `backend`
container) and its Caddyfile to route `dashboard.soiaviation.com` to
`dashboard:3000`. See [`SETUP.md`](SETUP.md), including the Portainer route.

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `/` | required | department index |
| `/d/:slug` | required + group check | one department dashboard |
| `/auth/start`, `/auth/callback` | — | Entra sign-in |
| `/signout`, `/signed-out` | — | ends the app *and* Entra session |
| `/healthz` | none | status, auth mode, access posture |
| `/assets/app.css` | none | the stylesheet |
