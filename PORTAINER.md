# Deploying the dashboards with Portainer

Portainer deploys this repo as a **Git stack**: it clones the repo on the host,
builds the image there, and runs it. Pushing to `main` can then redeploy
automatically. No registry, no CI.

## The layout

The dashboards run on **`i-019d9663e35988b74`**. The MCP connector stack —
including the private backend that holds every downstream API credential — runs
on a **different** instance, `i-0129a9ac033b36673` (`44.230.167.99`).

```
browser ──HTTPS──▶ dashboards host (i-019d9663e35988b74)
                     └─ dashboard:3000
                            │  VPC private network, port 8080,
                            │  security group locked to this host
                            ▼
                   MCP host (i-0129a9ac033b36673)
                     └─ backend  ← holds SAM.gov etc. credentials
```

Because Docker networks are per-host, the two cannot share one. The dashboard
reaches the backend over the **VPC private network** instead. The backend still
never touches the public internet — it becomes reachable from exactly one
instance, enforced by a security group.

> **Prerequisite:** both instances must be in the same VPC, or peered. Confirm
> before starting:
> ```bash
> aws ec2 describe-instances --instance-ids i-019d9663e35988b74 i-0129a9ac033b36673 \
>   --query 'Reservations[].Instances[].{Id:InstanceId,VPC:VpcId,PrivIP:PrivateIpAddress,SG:SecurityGroups[0].GroupId}' \
>   --output table
> ```
> If the `VPC` column differs between the two rows, stop — that needs VPC
> peering first, which is a separate piece of work.

---

## Step 1 — Expose the backend to the dashboards host (MCP host, one-off)

The backend is currently bound to loopback and reachable by nothing outside its
host. Two changes make it reachable by one instance and no others.

**1a. Bind it to the private IP.** In `~/soi-aviation-mcp/.env` on the MCP host:

```
BACKEND_BIND=<the MCP host's PRIVATE IP, e.g. 10.0.1.23>
```

Then:

```bash
cd ~/soi-aviation-mcp
docker compose -f docker-compose.multi.yml up -d backend
```

Never set this to `0.0.0.0` or a public IP. Left unset it stays on `127.0.0.1`,
which is the safe default.

**1b. Add the security-group rule.** On the MCP instance's security group:

| Setting | Value |
|---|---|
| Type | Custom TCP |
| Port | `8080` |
| Source | the **security group of `i-019d9663e35988b74`** — not a CIDR, not `0.0.0.0/0` |

Using the source *security group* rather than an IP means it keeps working if
the dashboards host is ever replaced or its IP changes.

**Confirm it from the dashboards host:**

```bash
curl -s http://<MCP-PRIVATE-IP>:8080/healthz
```

Expect `{"status":"ok",...}`. If it hangs, the security group is wrong; if it
refuses, `BACKEND_BIND` is wrong.

## Step 2 — DNS

`dashboard.soiaviation.com` must point at **this** host's public IP —
`i-019d9663e35988b74`, *not* `44.230.167.99`. Add the A record in GoDaddy before
deploying, or TLS issuance fails.

## Step 3 — Decide how TLS terminates

**If ports 80/443 are free on this host**, this stack can run its own Caddy:
deploy with the `tls` profile and it gets a Let's Encrypt certificate
automatically, using the `Caddyfile` in this repo.

**If a web server already serves 80/443 there**, leave the profile off and
point that server at `127.0.0.1:3000`. For nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Check first:

```bash
sudo ss -lntp | grep -E ':(80|443)\s'
```

## Step 4 — Create the stack in Portainer

**Stacks → Add stack → Repository.**

| Field | Value |
|---|---|
| Name | `dashboards` |
| Repository URL | `https://github.com/adminsoi/dashboards` |
| Reference | `refs/heads/main` |
| Compose path | `docker-compose.yml` |
| Authentication | **On** — the repo is private |

Reuse the saved GitHub credential if Portainer already has one; otherwise a
fine-grained PAT scoped to this repo with **Contents: read-only**.

To run the bundled Caddy, add `tls` under the stack's **profiles** (or deploy
by hand with `docker compose --profile tls up -d`).

Make sure Portainer is pointed at the environment/agent for
`i-019d9663e35988b74`, not the MCP host.

## Step 5 — Environment variables

Add these under **Environment variables**. Do not commit a `.env`.

| Variable | Value |
|---|---|
| `BACKEND_BASE_URL` | `http://<MCP-PRIVATE-IP>:8080` |
| `BACKEND_SERVICE_TOKEN` | from the **MCP host's** `.env` — your local copy is an unfilled template |
| `ENTRA_TENANT_ID` | `57ded119-c5e8-4224-b902-3d9240e1dfb7` |
| `ENTRA_CLIENT_ID` | from the app registration |
| `ENTRA_CLIENT_SECRET` | the secret **Value**, not the Secret ID |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `PUBLIC_BASE_URL` | `https://dashboard.soiaviation.com` |
| `DEPT_ACCESS_ENFORCE` | `false` until the Entra groups exist |

The required ones use `${VAR:?}`, so a missing **or empty** value fails the
deploy immediately naming the variable, rather than starting a container that
quietly misbehaves.

If the Entra secret contains a `$`, escape it as `$$` — Compose reads `$` as
the start of a variable.

## Step 6 — Auto-redeploy on push

Enable **GitOps updates** on the stack: polling (5 minutes, nothing to
configure) or a webhook added to the repo under **Settings → Webhooks**,
content type `application/json`, push events only. Tick **re-pull image and
redeploy** so a push rebuilds rather than restarting the old image.

## Step 7 — Verify

Portainer should show the container **healthy**. Then:

```bash
curl -s https://dashboard.soiaviation.com/healthz
```

Open the site — you should be redirected to Microsoft, then land on the
dashboard index. Check the **Government** dashboard: live numbers there prove
the VPC path to the backend works end to end.

---

## The IT dashboard, on this layout

It always probes the private backend. It does **not** probe the six connector
containers, because they live on the other host and this one cannot see them —
reporting them "down" would be a false alarm.

To include them, publish their health ports on the MCP host, open them to this
host's security group, and set:

```
SERVICE_PROBES=SAM.gov connector=<MCP-PRIVATE-IP>:3001,PartsBase connector=<MCP-PRIVATE-IP>:3002,...
```

Until then the IT dashboard reports on the backend alone, which is honest about
what it can actually see.

---

## When it doesn't work

| Symptom | Cause |
|---|---|
| Deploy fails naming a variable | Missing **or empty** in step 5 — `${VAR:?}` treats empty as unset. |
| Container healthy, Government tiles say "unavailable" | The VPC path is broken. Re-run the `curl` in step 1 from this host. |
| Government tiles say the backend returned HTTP 403 | `BACKEND_SERVICE_TOKEN` doesn't match the MCP host's value. |
| `curl` to the backend hangs | Security-group rule missing or wrong source. |
| `curl` to the backend refused | `BACKEND_BIND` unset or wrong; backend still on loopback. |
| TLS never issues | DNS still points at `44.230.167.99`, or 80/443 aren't free/open here. |
| Caddy 502 | The `tls` profile is on but something else owns 80/443. |
| Restart loop | Check logs. Usually `SESSION_SECRET` under 32 characters. |
| `AADSTS50011` at sign-in | Redirect URI ≠ `PUBLIC_BASE_URL` + `/auth/callback`. |
| Signed in, everything locked | `DEPT_ACCESS_ENFORCE=true` with empty group ids, or no groups claim. Fails closed by design — see `SETUP.md`. |
| Tiles show "—" | Expected for Pentagon 2000 and HR: not integrated. Government and IT should show real values. |

## Rollback

Portainer keeps the previous stack definition. To pin a known-good commit,
change **Repository reference** from `refs/heads/main` to a tag or commit SHA
and redeploy.
