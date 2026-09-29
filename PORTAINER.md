# Deploying with Portainer

Portainer deploys this repo as a **Git stack**: it clones the repo on the host,
builds the image there, and runs it. No registry, no CI.

The app is standalone — Entra SSO and the dashboard UI. It connects to nothing
else, so there is no network, firewall or backend setup to do.

---

## 1. DNS

`dashboard.soiaviation.com` must resolve to this host for the people using it —
its internal address is fine; the host needs no public IP.

The certificate does **not** depend on that record. Caddy proves ownership over
DNS-01, by writing a temporary TXT record through the GoDaddy API, so issuance
works before the A record exists and on a host the internet cannot reach.

## 2. Decide how HTTPS terminates

Entra will not accept a plain-http redirect URI for a real hostname, so this
needs HTTPS one way or the other. Check what already owns the ports:

```bash
sudo ss -lntp | grep -E ':(80|443)\s'
```

**If 80/443 are free** — use the bundled Caddy. Add `tls` to the stack's
profiles in Portainer and set `GODADDY_API_TOKEN` (step 4); the certificate is
obtained and renewed automatically.

Caddy is **built from this repo**, not pulled: the stock `caddy:2` image has no
DNS provider plugin compiled in and would fail to load this Caddyfile.
`caddy/Dockerfile` builds it with the GoDaddy and Route 53 plugins. The first
deploy is therefore a couple of minutes slower.

**If a web server already serves them** — leave the profile off and point that
server at `127.0.0.1:3000`. `GODADDY_API_TOKEN` is not needed. For nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## 3. Create the stack

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

## 4. Environment variables

Four are required. Add them under **Environment variables** — never commit a
`.env`.

| Variable | Value |
|---|---|
| `ENTRA_TENANT_ID` | `57ded119-c5e8-4224-b902-3d9240e1dfb7` |
| `ENTRA_CLIENT_ID` | from the app registration |
| `ENTRA_CLIENT_SECRET` | the secret **Value**, not the Secret ID |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `PUBLIC_BASE_URL` | `https://dashboard.soiaviation.com` (default, set it anyway to be explicit) |

They use `${VAR:?}`, so a missing **or empty** value fails the deploy
immediately naming the variable, rather than starting a container that quietly
misbehaves.

Two more only if you turned on the `tls` profile in step 2:

| Variable | Value |
|---|---|
| `GODADDY_API_TOKEN` | `key:secret` from a **Production** key at <https://developer.godaddy.com/keys> — an OTE key silently fails to issue |
| `DASHBOARD_HOST` | `dashboard.soiaviation.com` — must match the host in `PUBLIC_BASE_URL` |

These two deliberately use `${VAR:-}` rather than `${VAR:?}`: Compose
interpolates the whole file whichever profile is active, so marking them
required would break every deploy that terminates TLS elsewhere. The cost is
that a missing token surfaces as a Caddy certificate error in the logs instead
of a failed deploy.

If the Entra secret contains a `$`, escape it as `$$` — Compose reads `$` as
the start of a variable.

## 5. Auto-redeploy on push

Enable **GitOps updates**: polling (5 minutes, nothing to configure) or a
webhook added to the repo under **Settings → Webhooks**, content type
`application/json`, push events only. Tick **re-pull image and redeploy** so a
push rebuilds rather than restarting the old image.

## 6. Verify

Portainer should show the container **healthy**. Then:

```bash
curl -s https://dashboard.soiaviation.com/healthz
```

Open the site — you should be redirected to Microsoft, sign in, and land on the
dashboard index.

---

## What you'll see

Sign-in works and all seven dashboards render. Every data tile shows "—" with
"No data source is connected yet", because nothing is wired to this app yet.
That is the intended state, not a fault — the app never shows a number it
cannot source, and a zero would be a claim about the business that nothing
supports.

To connect a data source later, set `BACKEND_BASE_URL` (and
`BACKEND_SERVICE_TOKEN` if it needs one) and redeploy. Nothing else changes.

---

## When it doesn't work

| Symptom | Cause |
|---|---|
| Deploy fails naming a variable | Missing **or empty** in step 4 — `${VAR:?}` treats empty as unset. |
| Restart loop | Check the logs. Usually `SESSION_SECRET` under 32 characters. |
| `AADSTS50011` at sign-in | The Entra redirect URI doesn't exactly match `PUBLIC_BASE_URL` + `/auth/callback`. |
| `invalid_client` at sign-in | Wrong `ENTRA_CLIENT_SECRET` — check you copied the Value, not the Secret ID, and that it hasn't expired. |
| Caddy won't start, "module not found" | The `tls` profile is running a stock `caddy:2` from a stale build. Redeploy with **re-pull image and redeploy** so `caddy/Dockerfile` is rebuilt. |
| TLS never issues | `GODADDY_API_TOKEN` missing, an OTE key rather than Production, or the key has no access to the `soiaviation.com` zone. Caddy logs the DNS API's own error. |
| Caddy 502 | The `tls` profile is on but something else owns 80/443. |
| Signed in, everything locked | `DEPT_ACCESS_ENFORCE=true` with empty group ids, or no groups claim. Fails closed by design — see `SETUP.md`. |
| All tiles show "—" | Expected. No data source is connected. |

## Rollback

Portainer keeps the previous stack definition. To pin a known-good commit,
change **Repository reference** from `refs/heads/main` to a tag or commit SHA.
