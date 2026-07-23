# Deploying Gridwire on-premise

This guide covers deploying Gridwire on infrastructure **you** own and control —
your data centre, a private VPC, or an air-gapped network — with **no dependency
on any external SaaS**. Everything below is standard, vendor-neutral tooling.

Gridwire has two runtime tiers:

1. **Portal** — the web app + generated REST API (this repo's `Dockerfile`).
2. **Backend** — Postgres + an authentication service + an auto-generated REST
   layer (PostgREST) + object storage. The portal talks to this over HTTPS.
3. *(optional)* **Worker** — the companion ingestion service (`./worker`) that
   polls SFTP/NFS/folders.

The portal is stateless; **all state lives in the backend**. Back up the
backend and you have backed up everything.

---

## 1. What are the industry-standard ways to deploy?

| Approach | Best for | Effort | Notes |
| --- | --- | --- | --- |
| **Docker Compose** | Single VM, pilots, small teams | Low | One host, one file. Covered in §3. |
| **Kubernetes** (manifests or Helm) | HA, multiple nodes, existing k8s | Medium | Horizontal scaling, rolling upgrades. Covered in §6. |
| **Nomad / ECS / Swarm** | Teams already on those orchestrators | Medium | Same image, same env vars. |
| **Bare VM + systemd** | No container runtime allowed | Medium | Run `node .output/server/index.mjs` as a service. |

In every case the pattern is identical: **build one container image, inject
configuration through environment variables, put a TLS-terminating reverse proxy
in front, and point the portal at a Postgres-based backend.** The 12-factor
principles (config in the environment, stateless processes, disposable
containers) are the guiding standard.

**Recommended baseline for most companies:** Docker Compose on a hardened VM
behind Nginx/Traefik with automatic TLS, plus nightly Postgres backups. Move to
Kubernetes only when you need multi-node high availability.

---

## 2. Prerequisites

- A Linux host (or cluster) with Docker 24+ and the Compose plugin, **or** a
  Kubernetes 1.27+ cluster.
- A DNS name you control for the portal (e.g. `data.your-company.com`) and one
  for the backend API (e.g. `api.your-company.com`).
- TLS certificates (Let's Encrypt, an internal CA, or your corporate PKI).
- Outbound network access **only** if you use the SFTP/NFS connectors; the core
  portal runs fully offline once images are pulled.

---

## 3. Deploy with Docker Compose (recommended baseline)

### 3.1 Configure

```bash
git clone https://github.com/YOUR_ORG/gridwire.git
cd gridwire
cp .env.example .env
```

Edit `.env` and set every value. Generate secrets with `openssl rand -hex 32`.
See [`.env.example`](./.env.example) for the full annotated list; the critical
ones are:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | Backend API base URL |
| `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Public (anon) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side privileged key (secret) |
| `FIELD_ENCRYPTION_KEY` | 64 hex chars, AES-256-GCM field encryption (keep stable) |
| `WORKER_INGEST_TOKEN` | Shared portal↔worker token |

### 3.2 Run

```bash
docker compose up -d --build
```

This starts the **portal** (`:3000`) and the **worker**. Point your reverse
proxy at the portal (§5). Verify:

```bash
curl -fsS http://localhost:3000/ >/dev/null && echo "portal up"
```

### 3.3 Build just the portal image

```bash
docker build -t gridwire-portal .
docker run -p 3000:3000 --env-file .env gridwire-portal
```

The image builds with `NITRO_PRESET=node-server` and serves
`.output/server/index.mjs` on port **3000**.

---

## 4. Self-host the backend (fully on-premise)

Gridwire needs Postgres, an auth service, and an auto-generated REST layer
(PostgREST) — the standard open-source Postgres API stack. To run it entirely on
your own hardware:

1. **Provision the stack.** The reference open-source stack (Postgres + GoTrue
   auth + PostgREST + Storage + a Kong API gateway) ships as its own Docker
   Compose project. Clone it, set its `.env` (database password, JWT secret,
   `ANON_KEY`, `SERVICE_ROLE_KEY`, SMTP for auth emails), and bring it up on the
   same host or network as the portal:

   ```bash
   # in a sibling directory
   git clone --depth 1 https://github.com/supabase/supabase
   cd supabase/docker
   cp .env.example .env
   # edit .env: POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, SMTP_*
   docker compose up -d
   ```

   The API gateway is exposed on `:8000` (HTTP). Put it behind TLS as
   `api.your-company.com` (§5).

2. **Apply Gridwire's schema.** All tables, row-level-security policies,
   functions, and grants live in [`supabase/migrations/`](./supabase/migrations).
   Apply them in filename order against the backend database:

   ```bash
   for f in supabase/migrations/*.sql; do
     psql "postgresql://postgres:$POSTGRES_PASSWORD@localhost:5432/postgres" -f "$f"
   done
   ```

   (Or use any migration runner your team standardises on.)

3. **Wire the portal to it.** In the portal's `.env` set:
   - `SUPABASE_URL` / `VITE_SUPABASE_URL` → `https://api.your-company.com`
   - `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` → the backend's `ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` → the backend's `SERVICE_ROLE_KEY`

4. **Configure auth.** Enable email/password sign-in in the auth service and set
   the site URL to your portal domain. Configure SMTP so invite and confirmation
   emails are sent from your own mail server. Add OAuth providers (Google, etc.)
   only if your organisation wants them — none are required.

Once the schema is applied and the keys match, the portal is fully operational
on your infrastructure with no outbound SaaS calls.

---

## 5. Reverse proxy + TLS (required)

Always terminate TLS at a reverse proxy in front of the portal — never expose
port 3000 directly. A ready-to-use Nginx config is in
[`deploy/nginx/gridwire.conf`](./deploy/nginx/gridwire.conf).

Minimal Nginx server block:

```nginx
server {
  listen 443 ssl http2;
  server_name data.your-company.com;

  ssl_certificate     /etc/ssl/certs/gridwire.crt;
  ssl_certificate_key /etc/ssl/private/gridwire.key;

  # Large spreadsheet uploads
  client_max_body_size 100m;

  location / {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
  }
}
```

For automatic certificates, **Traefik** or **Caddy** with Let's Encrypt (or your
internal ACME CA) are the common zero-touch choices. In air-gapped networks, use
certificates from your corporate PKI.

---

## 6. Deploy on Kubernetes

Reference manifests are in [`deploy/kubernetes/`](./deploy/kubernetes):

```bash
kubectl create namespace gridwire

# Create secrets from your .env (never commit real secrets)
kubectl -n gridwire create secret generic gridwire-env --from-env-file=.env

kubectl -n gridwire apply -f deploy/kubernetes/
```

The manifests define a portal `Deployment` (scale `replicas` for HA), a
`Service`, an `Ingress` (edit the host + TLS secret), and a worker `Deployment`.
Because the portal is stateless you can run many replicas behind the Service;
only the backend needs persistent storage.

### Helm (recommended for k8s)

A packaged chart lives in [`deploy/helm/gridwire`](./deploy/helm/gridwire) with
configurable values and clean upgrades:

```bash
kubectl create namespace gridwire
kubectl -n gridwire create secret generic gridwire-env --from-env-file=.env

helm install gridwire ./deploy/helm/gridwire -n gridwire \
  --set config.existingSecret=gridwire-env \
  --set image.registry=YOUR_REGISTRY/ \
  --set ingress.host=data.your-company.com \
  --set ingress.tlsSecretName=gridwire-portal-tls

# later, to upgrade:
helm upgrade gridwire ./deploy/helm/gridwire -n gridwire -f my-values.yaml
```

See [`deploy/helm/gridwire/README.md`](./deploy/helm/gridwire/README.md) for the
full values reference (replica count, autoscaling, worker persistence, etc.).

---

## 7. Secrets management

- **Never** bake secrets into the image or commit `.env`.
- Compose: keep `.env` on the host with `chmod 600`, or use `docker secret` on Swarm.
- Kubernetes: use `Secret` objects (shown above), or an external manager
  (HashiCorp Vault, AWS/GCP/Azure secret stores, Sealed Secrets).
- Rotate `WORKER_INGEST_TOKEN` and the backend service-role key periodically.
- **Do not** rotate `FIELD_ENCRYPTION_KEY` unless you re-encrypt existing data —
  rotating it makes previously-encrypted field values unreadable.

---

## 8. Backups & disaster recovery

All durable state is in Postgres. The **full runbook** — scheduled snapshots
(cron / systemd / k8s CronJob), a tested quarterly recovery drill, and RPO/RTO
guidance — is in [`BACKUP_RESTORE.md`](./BACKUP_RESTORE.md). The essentials:

```bash
# Nightly logical backup (helper: deploy/scripts/backup.sh handles retention + verify)
pg_dump "postgresql://postgres:$POSTGRES_PASSWORD@BACKEND_HOST:5432/postgres" \
  --format=custom --no-owner --no-privileges --file="gridwire-$(date +%F).dump"

# Restore (helper: deploy/scripts/restore.sh)
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="postgresql://postgres:$POSTGRES_PASSWORD@BACKEND_HOST:5432/postgres" \
  gridwire-2026-01-01.dump
```

- Automate with cron, a systemd timer, or the Kubernetes CronJob
  ([`deploy/kubernetes/backup-cronjob.yaml`](./deploy/kubernetes/backup-cronjob.yaml));
  store copies off-host.
- For point-in-time recovery, enable WAL archiving on Postgres.
- **Also back up `FIELD_ENCRYPTION_KEY`** (in your secrets manager) — encrypted
  fields are unrecoverable without it.
- **Test restores quarterly** using the drill in the runbook — an untested
  backup is not a backup.

---

## 9. Upgrades

```bash
git pull
docker compose up -d --build          # rebuilds portal + worker
# apply any new migrations against the backend:
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

On Kubernetes, push a new image tag and `kubectl rollout restart deployment/gridwire-portal`
for a zero-downtime rolling update. Always take a backup before upgrading and
apply new migrations before (or as part of) the rollout.

---

## 10. Health, readiness & monitoring

Every service exposes standard **liveness** and **readiness** endpoints so
orchestrators restart what is broken and route traffic only to what is ready.

### 10.1 Endpoints

| Service | Kind | Endpoint | Returns | Meaning |
| --- | --- | --- | --- | --- |
| Portal | Liveness | `GET /api/public/health` | `200` | Process is up and serving. Does **not** touch the backend — a slow DB never restarts the pod. |
| Portal | Readiness | `GET /api/public/ready` | `200` ready / `503` not-ready | Verifies the portal can reach its backend (REST). Pod leaves the load balancer when the DB is unreachable. |
| Worker | Liveness | `GET :8080/healthz` | `200` | Worker process is running. |
| Worker | Readiness | `GET :8080/readyz` | `200` ready / `503` not-ready | The portal was reachable within the last two poll intervals. |

The old bare `GET /` still returns the app, but use the dedicated endpoints for
probes — they are purpose-built and JSON, e.g.:

```bash
curl -fsS https://data.your-company.com/api/public/health   # {"status":"ok",...}
curl -fsS https://data.your-company.com/api/public/ready     # {"status":"ready","checks":{"backend":"ok"},...}
```

### 10.2 Required environment variables

| Variable | Service | Why the probe needs it |
| --- | --- | --- |
| `SUPABASE_URL` (or `VITE_SUPABASE_URL`) | Portal | Readiness pings `${SUPABASE_URL}/rest/v1/` to confirm backend reachability. |
| `SUPABASE_PUBLISHABLE_KEY` | Portal | Sent as `apikey` on the readiness check (optional but recommended). |
| `PORTAL_URL` | Worker | Readiness is "ready" only when this URL responds. |
| `HEALTH_PORT` | Worker | Port the worker's health server listens on (default `8080`). |

### 10.3 Nginx (upstream health / status endpoint)

Expose a lightweight, internal-only health path through the proxy and keep it
out of your access-log noise:

```nginx
# inside the portal server { } block (see deploy/nginx/gridwire.conf)
location = /api/public/health {
    access_log off;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}
location = /api/public/ready {
    access_log off;
    # Restrict readiness to internal monitors if you like:
    # allow 10.0.0.0/8; deny all;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}
```

For Nginx's own upstream health checks (open-source), passive checks work out of
the box:

```nginx
upstream gridwire_portal {
    server 127.0.0.1:3000 max_fails=3 fail_timeout=30s;
}
```

### 10.4 Kubernetes probes

The shipped manifests and Helm chart already wire these up. The pattern:

```yaml
# portal container
readinessProbe:
  httpGet: { path: /api/public/ready, port: 3000 }
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3
livenessProbe:
  httpGet: { path: /api/public/health, port: 3000 }
  initialDelaySeconds: 20
  periodSeconds: 20
---
# worker container (health server on :8080)
readinessProbe:
  httpGet: { path: /readyz, port: 8080 }
livenessProbe:
  httpGet: { path: /healthz, port: 8080 }
```

See [`deploy/kubernetes/portal.yaml`](./deploy/kubernetes/portal.yaml) and
[`deploy/kubernetes/worker.yaml`](./deploy/kubernetes/worker.yaml) for the full,
tuned probe definitions. Docker Compose and the Dockerfiles use the same
endpoints as container `HEALTHCHECK`s.

### 10.5 Metrics & logs

- **API consumption** is logged per organisation and viewable in-app under
  **Audit Log**; export to CSV or forward your reverse-proxy access logs to your
  SIEM.
- Scrape container metrics with your existing stack (Prometheus/Grafana,
  Datadog, etc.); both services emit standard stdout logs for log aggregation.

---

## 10a. CI/CD & supply-chain security

The repo ships GitHub Actions so the on-premise package stays secure and
buildable — no external services required beyond GitHub:

- [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) — TypeScript
  typecheck, ESLint, and a worker syntax/install check on every push and PR.
- [`.github/workflows/security.yml`](./.github/workflows/security.yml) —
  Trivy dependency + config scan and container-image scanning for both the
  portal and worker images; results upload to the repo's **Security → Code
  scanning** tab and re-run weekly.
- [`.github/dependabot.yml`](./.github/dependabot.yml) — weekly dependency and
  base-image update PRs, validated by the workflows above.

Self-hosting on a different platform (GitLab CI, Jenkins, etc.)? The same steps
map directly: `bun install` → `bunx tsc --noEmit` → `bun run lint` → build image
→ `trivy image`.

---

## 11. Security checklist

- [ ] TLS terminated at the proxy; port 3000 not publicly exposed.
- [ ] All secrets in a secrets manager, not in source or the image.
- [ ] `FIELD_ENCRYPTION_KEY` is 64 hex chars, backed up, and never rotated in place.
- [ ] Backend Row-Level Security enabled (applied automatically by the migrations).
- [ ] Postgres reachable only from the portal/worker network, not the public internet.
- [ ] Nightly backups running and periodically test-restored.
- [ ] Auth emails sent through your own SMTP server.
- [ ] Worker credentials (`SFTP_SECRETS`) live only on the worker host.

---

Questions or an environment not covered here? Open an issue on the repository.
