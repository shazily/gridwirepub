# Gridwire — full on-premise deployment

Run the **entire platform** on your own hardware: portal, worker, Postgres, auth, and API gateway. No external SaaS dependency.

## Requirements

- **Docker Desktop** (Windows or macOS) or Docker Engine (Linux)
- **4 GB+ RAM** allocated to Docker
- **PowerShell** (Windows) or **bash** (Linux/macOS)
- **Node.js** (for one-time JWT key generation during bootstrap)

## One-command deploy (Windows)

```powershell
git clone https://github.com/shazily/gridwirepub.git
cd gridwire
.\scripts\deploy.ps1 up
```

If `.env` does not exist, deploy automatically runs **bootstrap** and generates all secrets locally.

### What starts

| Service | URL | Purpose |
|---------|-----|---------|
| Portal | http://127.0.0.1:3020 | UI, upload wizard, generated APIs |
| API gateway (Kong) | http://127.0.0.1:3040 | Auth + PostgREST (browser Supabase client) |
| Postgres | 127.0.0.1:54332 | All data |
| Worker | internal | SFTP / folder connector polling |

### Manual bootstrap (optional)

```powershell
.\scripts\bootstrap-onprem.ps1        # create .env
.\scripts\bootstrap-onprem.ps1 -Force # regenerate secrets (destroys DB password match if volume exists)
.\scripts\deploy.ps1 up
```

Linux/macOS:

```bash
chmod +x scripts/bootstrap-onprem.sh scripts/deploy.sh
./scripts/bootstrap-onprem.sh
./scripts/deploy.sh up
```

## First use

1. Open http://127.0.0.1:3020
2. **Create account** (email + password) — accounts are auto-confirmed on-prem (`GOTRUE_MAILER_AUTOCONFIRM=true`)
3. Create an organization, upload a spreadsheet, publish
4. Call your API at `/api/v1/datasets/...`

Google sign-in is **hidden** in on-prem mode (no cloud OAuth).

## Connectors (SFTP / folders)

1. Configure a connector in the UI (host, path, username)
2. Add SFTP password to worker env in `.env`:

```env
SFTP_SECRETS={"<connector-uuid>":{"password":"your-sftp-password"}}
```

3. Restart worker: `docker compose -f docker-compose.onprem.yml restart worker`

Mount network shares into the worker container for NFS/folder connectors (see root `docker-compose.onprem.yml`).

## Architecture notes

- **Database**: `supabase/postgres:15.8.1.060` — same Postgres extensions and auth schema Supabase Cloud uses
- **Bootstrap hooks** (first boot only):
  - `deploy/supabase/00-create-supabase-admin.sh` — creates `supabase_admin` before image migrations run
  - `deploy/supabase/zzz-set-role-passwords.sh` — sets passwords for `supabase_auth_admin`, `authenticator`, etc.
- **Auth**: GoTrue (`supabase/gotrue`) behind Kong at `/auth/v1/`
- **API**: PostgREST behind Kong at `/rest/v1/`

If you change `POSTGRES_PASSWORD` after the DB volume exists, run `.\scripts\bootstrap-onprem.ps1 -Force` **and** `docker compose -f docker-compose.onprem.yml down -v` to recreate the database.


Point your tunnel at `http://127.0.0.1:3020` only. Data stays on your machine.

**External login (critical):** Browsers must not use `VITE_SUPABASE_URL=http://127.0.0.1:3040`
(that only works on the Docker host). Set:

```env
VITE_SUPABASE_URL=https://your.public.hostname
API_EXTERNAL_URL=https://your.public.hostname
SUPABASE_URL=http://kong:8000
SITE_URL=https://your.public.hostname
PUBLIC_APP_URL=https://your.public.hostname
```

The portal proxies `/auth/v1` and `/rest/v1` to Kong so a single tunnel hostname is enough.
Then rebuild: `.\scripts\deploy.ps1 up`.

```
Portal :3020  (tunnel)
         │
         ├─ /           UI
         ├─ /auth/v1/*  → Kong → GoTrue   (proxied)
         └─ /rest/v1/*  → Kong → PostgREST (proxied)
Kong :3040  (loopback only — not required on the tunnel)
```

Update `.env` if your public URL changes:

```env
PUBLIC_APP_URL=https://data.your-company.com
SITE_URL=https://data.your-company.com
```

Then redeploy: `.\scripts\deploy.ps1 up`

## Optional: alert emails

Set SMTP in `.env` (internal mail server — no external SaaS required):

```env
SMTP_HOST=mail.your-company.local
SMTP_PORT=587
SMTP_USER=gridwire
SMTP_PASS=...
SMTP_FROM=alerts@your-company.local
```

## Email ingest webhook (mandatory when exposed to the internet)

On-prem bootstrap generates `INBOUND_WEBHOOK_SECRET`. Every inbound gateway POST must include:

- Header `X-Gridwire-Webhook-Secret: <secret>` (or `Authorization: Bearer <secret>`)

For **Postmark**, use webhook URL `/api/public/inbound/postmark` and configure Postmark to send `X-Postmark-Signature` (HMAC-SHA256 of the raw JSON body). Set `POSTMARK_WEBHOOK_SECRET` if it differs from `INBOUND_WEBHOOK_SECRET`.

`validate-env.ps1` fails deploy when `INBOUND_WEBHOOK_SECRET` is missing on on-prem stacks. In production (`NODE_ENV=production`), the portal refuses unauthenticated inbound payloads.

## Production ship checklist

Run these steps on the **real production host** before exposing the stack to the internet. Do not copy a developer `.env` — generate fresh secrets via bootstrap.

### 1. Secrets and env

```powershell
.\scripts\bootstrap-onprem.ps1   # or merge vars from bootstrap output into existing .env
.\scripts\validate-env.ps1
```

| Variable | Notes |
|----------|--------|
| `INBOUND_WEBHOOK_SECRET` | Required on-prem. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `POSTMARK_WEBHOOK_SECRET` | Set only if Postmark signs with a different value than `INBOUND_WEBHOOK_SECRET` |
| `FIELD_ENCRYPTION_KEY` | 64 hex chars. **Never** set `FIELD_ENCRYPTION_ALLOW_INSECURE_DEV=true` in production |
| `SFTP_SECRETS` | JSON map of connector UUID → `{password}` — not stored in Postgres (see [`docs/connector-credentials-migration.md`](../../docs/connector-credentials-migration.md)) |
| `CLAMAV_REQUIRED` | Set `true` when email ingest is internet-facing |

### 2. Migrations and connector credentials

```powershell
.\scripts\deploy.ps1 migrate
```

Applies credential stripping from `connectors.config`. If you have legacy SFTP passwords in the database, migrate them to `SFTP_SECRETS` per [`docs/connector-credentials-migration.md`](../../docs/connector-credentials-migration.md).

### 3. Rebuild and deploy images

Shipped images must include **non-root** (`gridwire` uid 1001) and **nodemailer 9.x**:

```powershell
docker compose -f docker-compose.onprem.yml build portal worker
.\scripts\deploy.ps1 up
.\scripts\deploy.ps1 smoke
```

### 4. Worker volume permissions (first non-root deploy)

If the worker cannot write `/data` after upgrade:

```powershell
docker exec -u root <worker-container-name> chown -R gridwire:gridwire /data
```

Example container name: `excel2apihub-worker-1` (verify with `docker compose -f docker-compose.onprem.yml ps`).

### 5. Dependency decisions

| Package | Decision (v1) | Doc |
|---------|---------------|-----|
| `parquetjs` / `thrift` | **Accept** — write-only Parquet export, no read path | [`docs/PENDING-parquetjs-thrift-cve.md`](../../docs/PENDING-parquetjs-thrift-cve.md) |

Revisit before adding Parquet import or if your security policy requires zero high-severity npm audit findings.

## Commands

| Command | Action |
|---------|--------|
| `.\scripts\deploy.ps1 up` | Full deploy (backend → migrations → portal + worker) |
| `.\scripts\deploy.ps1 down` | Stop all containers |
| `.\scripts\deploy.ps1 smoke` | Post-deploy health checks |
| `.\scripts\deploy.ps1 migrate` | Apply SQL migrations only |
| `.\scripts\deploy.ps1 bootstrap` | Regenerate `.env` |

## Air-gap notes

- Pull Docker images once on a connected machine, then transfer to air-gapped host, or use a private registry.
- No outbound calls at runtime when SMTP is local or unset.
- Secrets live only in `.env` on your host (never commit).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `ENV VALIDATION FAILED` | Run `.\scripts\bootstrap-onprem.ps1 -Force` |
| Portal shows error boundary | Check `docker compose -f docker-compose.onprem.yml logs portal` |
| Ready 503 | Backend not healthy — `docker compose -f docker-compose.onprem.yml ps` |
| Auth fails | Ensure `SITE_URL` matches the URL in your browser |
| Port conflict | Change `GRIDWIRE_HOST_PORT`, `GRIDWIRE_API_PORT`, `GRIDWIRE_DB_PORT` in `.env` |
| Worker SFTP / ingest errors after upgrade | `chown -R gridwire:gridwire /data` inside worker container (see Production ship checklist) |
| Inbound email 401/403 | Set `INBOUND_WEBHOOK_SECRET`; Postmark needs matching `X-Postmark-Signature` |

## Architecture

```
Browser → Portal :3020 (UI + /api/v1/*)
              ↓
         Kong :3040 (/auth/v1, /rest/v1)
              ↓
    GoTrue + PostgREST + Postgres
              ↑
Worker → portal /api/public/worker/* (SFTP ingest)
```

See also [`DEPLOYMENT.md`](../../DEPLOYMENT.md) for Kubernetes, Helm, backups, and TLS.
