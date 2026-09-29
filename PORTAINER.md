# Deploying the dashboards with Portainer

Portainer deploys this repo as a **Git stack**: it clones the repo on the EC2
host, builds the image there, and runs it. Pushing to `main` can then redeploy
automatically.

## Read this first — what Portainer cannot do here

Portainer manages *this* stack. It does not manage the MCP connector stack,
which is deployed on the host with plain `docker compose`. Two things live in
that stack, so two steps happen over SSH, not in Portainer:

1. **The Docker network.** This stack has no network of its own — it joins the
   MCP stack's network so it can reach the private backend.
2. **The Caddy route.** Caddy is the only thing bound to ports 80/443 and it
   lives in the MCP stack, so it has to own `dashboard.soiaviation.com`.

Both are one-offs. Once done, Portainer handles every subsequent deploy.

---

## Step 1 — Confirm the network name (SSH)

```bash
docker network ls | grep soi
```

Compose names a stack's default network `<project>_default`, so this is almost
certainly `soi-aviation-mcp_default`. Note whatever it actually says — you need
it for `SOI_NETWORK` in step 4. If it differs, set that variable rather than
editing the compose file.

## Step 2 — Add the Caddy route (SSH, one-off)

In `~/soi-aviation-mcp/Caddyfile`, this block should already be present:

```
dashboard.soiaviation.com {
	reverse_proxy dashboard:3000
}
```

Then reload Caddy:

```bash
cd ~/soi-aviation-mcp
docker compose -f docker-compose.multi.yml restart caddy
```

Caddy requests the TLS certificate on first hit, so `dashboard.soiaviation.com`
must already resolve to `44.230.167.99` in GoDaddy. Add that A record first.

Caddy resolves the name `dashboard` because this stack pins that network alias
explicitly — so the Portainer stack can be called anything.

## Step 3 — Create the stack in Portainer

**Stacks → Add stack → Repository.**

| Field | Value |
|---|---|
| Name | `dashboards` |
| Build method | **Repository** |
| Repository URL | `https://github.com/adminsoi/dashboards` |
| Repository reference | `refs/heads/main` |
| Compose path | `docker-compose.yml` |
| Authentication | **On** — the repo is private |

For authentication, reuse the saved GitHub credential if Portainer already has
one from the AOGBrain stack. Otherwise create a GitHub **fine-grained personal
access token** scoped to just this repo with **Contents: read-only**, and save
it in Portainer as a reusable credential.

Portainer builds the image from the repo's `Dockerfile` on the host — no
registry, no CI, nothing to publish.

## Step 4 — Environment variables

Add these under **Environment variables** in the stack editor. Do **not**
commit a `.env`; Portainer stores these itself.

| Variable | Value |
|---|---|
| `BACKEND_SERVICE_TOKEN` | same value the MCP stack's `.env` uses |
| `ENTRA_TENANT_ID` | `57ded119-c5e8-4224-b902-3d9240e1dfb7` |
| `ENTRA_CLIENT_ID` | from the new app registration (see `SETUP.md`) |
| `ENTRA_CLIENT_SECRET` | from the new app registration |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `PUBLIC_BASE_URL` | `https://dashboard.soiaviation.com` |
| `SOI_NETWORK` | whatever step 1 reported |
| `DEPT_ACCESS_ENFORCE` | `false` until the Entra groups exist |

`.env.example` lists the optional ones (department group ids, `GOVERNMENT_NAICS`,
`SESSION_TTL_SECONDS`).

The five required variables use `${VAR:?}` in the compose file, so a missing
one fails the deploy immediately with a message naming it, rather than starting
a container that silently misbehaves.

## Step 5 — Auto-redeploy on push

In the stack's settings, enable **GitOps updates**. Two choices:

- **Polling** — simplest. Portainer checks the repo on an interval (5 minutes
  is typical) and redeploys when the commit hash changes. Nothing to configure
  on GitHub.
- **Webhook** — instant. Portainer shows a webhook URL; add it in GitHub under
  **Settings → Webhooks** on the `dashboards` repo, content type
  `application/json`, "Just the push event".

Tick **Re-pull image and redeploy** so a push actually rebuilds rather than
restarting the old image.

## Step 6 — Verify

Portainer should show the container **healthy** (the compose file defines a
healthcheck against `/healthz`). Then:

```bash
curl -s https://dashboard.soiaviation.com/healthz
```

That returns the auth mode, whether department access is being enforced, and
which dashboards have no Entra group configured yet. It needs no auth and
returns no secrets.

Open `https://dashboard.soiaviation.com` in a browser — you should be sent to
Microsoft to sign in, and land back on the dashboard index.

---

## When it doesn't work

| Symptom | Cause |
|---|---|
| Deploy fails: `network soi-aviation-mcp_default not found` | The MCP stack isn't running, or the network is named differently. Re-check step 1 and set `SOI_NETWORK`. |
| Deploy fails naming a variable | A required environment variable is missing from step 4. |
| Caddy returns 502 | Caddy hasn't been reloaded since the Caddyfile changed, or this stack isn't on the shared network. |
| Container restarts in a loop | Check the container logs in Portainer. Most likely `SESSION_SECRET` is under 32 characters, or the backend is unreachable. |
| Sign-in fails with `AADSTS50011` | The Entra redirect URI doesn't exactly match `PUBLIC_BASE_URL` + `/auth/callback`. |
| Sign-in works, every dashboard is locked | `DEPT_ACCESS_ENFORCE=true` but the group ids are empty or the groups claim isn't configured. It fails closed by design — see `SETUP.md` step 1. |
| Tiles show "—" instead of numbers | Expected for Pentagon 2000 and HR: those integrations don't exist yet. Government and IT should show real values. |

## Rollback

Portainer keeps the previous stack definition. To pin a known-good commit,
change the stack's **Repository reference** from `refs/heads/main` to a tag or
commit SHA and redeploy.
