# Deploying with Portainer

Portainer deploys this repo as a **Git stack**: it clones the repo on the host,
builds the image there, and runs it. No registry, no CI.

This stack does **not** run its own web server or get its own certificate. It
joins the MCP stack's Docker network, and the Caddy already running there
serves it at `dashboard.soiaviation.com` — the same front door as the six
connectors. One set of certificates, one place to look when something breaks.

Once the stack exists, deploying a change is just pushing to `main`.

---

## Prerequisites

Two one-offs on the host. Portainer cannot do either for you, and the stack
will not come up without them.

### 1. The MCP stack is running

Its network is what this joins. Find the network's exact name — Portainer's
**Networks** page lists it, or on the host:

```bash
docker network ls | grep soi
```

It is usually `soi-aviation-mcp_default`, which is the default. If yours is
named differently, set `SOI_NETWORK` in step 3.

### 2. Caddy routes the hostname

The MCP stack's `Caddyfile` needs this block:

```
dashboard.soiaviation.com {
	reverse_proxy dashboard:3000
}
```

Then reload Caddy:

```bash
docker exec -w /etc/caddy $(docker ps -qf name=caddy) caddy reload
```

`dashboard.soiaviation.com` also needs a DNS A record pointing at this host,
same as the connector subdomains — Caddy gets the certificate over HTTP-01 and
cannot issue one without it.

## Create the stack

**Stacks → Add stack → Repository.**

| Field | Value |
|---|---|
| Name | `dashboards` |
| Repository URL | `https://github.com/adminsoi/dashboards` |
| Reference | `refs/heads/main` |
| Compose path | `docker-compose.yml` |
| Authentication | **On** — the repo is private |

Reuse Portainer's saved GitHub credential if it has one; otherwise a
fine-grained PAT scoped to this repo with **Contents: read-only**.

## Environment variables

Four are required. Add them under **Environment variables** — never commit a
`.env`.

| Variable | Value |
|---|---|
| `ENTRA_TENANT_ID` | `57ded119-c5e8-4224-b902-3d9240e1dfb7` |
| `ENTRA_CLIENT_ID` | from the app registration |
| `ENTRA_CLIENT_SECRET` | the secret **Value**, not the Secret ID |
| `SESSION_SECRET` | output of `openssl rand -base64 48` — paste the result, not the command |

They use `${VAR:?}`, so a missing **or empty** value fails the deploy
immediately naming the variable, rather than starting a container that quietly
misbehaves.

If the Entra secret contains a `$`, escape it as `$$` — Compose reads `$` as
the start of a variable.

Optional:

| Variable | When |
|---|---|
| `SOI_NETWORK` | The MCP stack's network is not named `soi-aviation-mcp_default` |
| `PUBLIC_BASE_URL` | Anything other than `https://dashboard.soiaviation.com` |
| `BACKEND_BASE_URL` | To light up the data tiles — `http://backend:8080`, reachable because this shares the MCP network |
| `BACKEND_SERVICE_TOKEN` | If the backend requires one |

## Auto-redeploy on push

Enable **GitOps updates**: polling (5 minutes, nothing to configure) or a
webhook added to the repo under **Settings → Webhooks**, content type
`application/json`, push events only. Tick **re-pull image and redeploy** so a
push rebuilds rather than restarting the old image.

This is what makes "update the repo and it deploys" true.

## Verify

Portainer should show the container **healthy**. Then open
<https://dashboard.soiaviation.com> — you should be redirected to Microsoft,
sign in, and land on the dashboard index.

---

## What you'll see

Sign-in works and all seven dashboards render. Every data tile shows "—" with
"No data source is connected yet", unless you set `BACKEND_BASE_URL`. That is
the intended state, not a fault — the app never shows a number it cannot
source, and a zero would be a claim about the business that nothing supports.

The home page also carries a banner saying department access is not enforced:
any signed-in SOI user can open any dashboard, including Finance and HR. Turn
that off by setting `DEPT_ACCESS_ENFORCE=true` once the Entra group ids are
filled in — it fails closed, so do the groups first. See `SETUP.md`.

---

## When it doesn't work

| Symptom | Cause |
|---|---|
| Deploy fails naming a variable | Missing **or empty** — `${VAR:?}` treats empty as unset. |
| `network soi-aviation-mcp_default not found` | The MCP stack isn't up, or its network has a different name. Set `SOI_NETWORK`. |
| Caddy 502 on the hostname | The dashboard container isn't on the network, or isn't up yet. Check it resolves: `docker exec <caddy> ping -c1 dashboard`. |
| 404 from Caddy | The `dashboard.soiaviation.com` block is missing from the MCP Caddyfile, or Caddy wasn't reloaded. |
| Restart loop | Check the logs. Usually `SESSION_SECRET` under 32 characters. |
| `AADSTS50011` at sign-in | The Entra redirect URI doesn't exactly match `PUBLIC_BASE_URL` + `/auth/callback`. |
| `invalid_client` at sign-in | Wrong `ENTRA_CLIENT_SECRET` — check you copied the Value, not the Secret ID, and that it hasn't expired. |
| TLS never issues | No DNS A record for `dashboard.soiaviation.com` yet. |
| Signed in, everything locked | `DEPT_ACCESS_ENFORCE=true` with empty group ids. Fails closed by design — see `SETUP.md`. |
| All tiles show "—" | Expected unless `BACKEND_BASE_URL` is set. |

## Rollback

Portainer keeps the previous stack definition. To pin a known-good commit,
change **Repository reference** from `refs/heads/main` to a tag or commit SHA.
