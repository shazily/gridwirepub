# Gridwire on Windows — Docker Desktop + Cloudflare Tunnel

Touchless deploy target: **portal on `127.0.0.1:3020`** by default (configurable via `GRIDWIRE_HOST_PORT` in `.env`). This avoids stealing `localhost:3000` from other apps on a busy Docker host.

Point your Cloudflare tunnel at `http://127.0.0.1:3020` (or whatever you set in `.env`).

## Prerequisites

1. **Docker Desktop** (WSL2 backend recommended)
   - Settings → Resources: allocate **≥ 4 GB RAM** if self-hosting Supabase (`GRIDWIRE_INCLUDE_BACKEND=1`)
   - Settings → General: enable “Use the WSL 2 based engine”

2. **Git** and **PowerShell 5.1+**

3. **Optional:** `psql` client for migrations (or use hosted Supabase SQL editor once)

4. **Cloudflare tunnel** pointed at `http://127.0.0.1:3020` (or your `GRIDWIRE_HOST_PORT`)

## One-time setup

```powershell
git clone https://github.com/shazily/gridwirepub.git
cd gridwire
.\scripts\bootstrap.ps1 `
  -SupabaseUrl "https://your-project.supabase.co" `
  -AnonKey "your-anon-key" `
  -ServiceRoleKey "your-service-role-key" `
  -PublicAppUrl "https://data.your-company.com"
```

Add `SUPABASE_SERVICE_ROLE_KEY` from Supabase Dashboard → Project Settings → API → **service_role** (secret).

```env
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Without it, authenticated routes and readiness fail with **"This page didn't load"**.

Also confirm your tunnel targets **`http://127.0.0.1:3020`** (not `:3000`).

```powershell
.\scripts\validate-env.ps1   # must pass before deploy
.\scripts\deploy.ps1 up      # rebuilds image with VITE_* baked into browser bundle
```

```env
DATABASE_URL=postgresql://postgres:PASSWORD@db.your-project.supabase.co:5432/postgres
```

## Touchless deploy (every release)

```powershell
git pull
.\scripts\deploy.ps1 up
```

This will:

1. Apply SQL migrations idempotently (`scripts\apply-migrations.ps1`)
2. `docker compose up -d --build --wait`
3. Run smoke tests (`scripts\smoke-test.ps1`)

### Commands

| Command | Purpose |
| --- | --- |
| `.\scripts\deploy.ps1 up` | Full deploy |
| `.\scripts\deploy.ps1 smoke` | Post-deploy checks only |
| `.\scripts\deploy.ps1 status` | Container status + smoke |
| `.\scripts\deploy.ps1 migrate` | Migrations only |
| `.\scripts\deploy.ps1 down` | Stop stack |

### Optional: scheduled backups

```powershell
.\scripts\install-backup-task.ps1
```

Registers a Windows Task Scheduler job that runs `deploy\scripts\backup.sh` daily (requires WSL or Git Bash + `pg_dump`).

### Optional: self-hosted backend on Windows

```powershell
$env:GRIDWIRE_INCLUDE_BACKEND = "1"
.\scripts\deploy.ps1 up
```

Uses `docker-compose.backend.yml` (Postgres + PostgREST + GoTrue + Kong on `127.0.0.1:8000`). Copy keys from `.env.backend.example` into `.env`.

## Smoke test expectations

| Check | Pass |
| --- | --- |
| `GET /api/public/health` | 200 |
| `GET /api/public/ready` | 200 when backend reachable (503 OK if Supabase down) |
| `GET /api/public/metrics` (no token) | **401** |
| `GET /api/public/metrics` + `METRICS_TOKEN` | 200, contains `gridwire_portal_up` |
| Worker `/healthz` | 200 via `docker compose exec worker` |

## GitHub Actions self-hosted runner (optional CD)

Install a [self-hosted Windows runner](https://docs.github.com/en/actions/hosting-your-own-runners) on this machine, then enable `.github/workflows/deploy.yml`. Pushes to `main` run `deploy.ps1 up` after CI passes.

## Troubleshooting

- **Portal not reachable via tunnel:** confirm Docker publishes `127.0.0.1:3000:3000` (default in `docker-compose.yml`).
- **Migrations skipped:** set `DATABASE_URL` or `PGHOST`/`PGUSER`/`PGDATABASE` in `.env`.
- **Ready 503:** `SUPABASE_URL` / keys incorrect or backend down — portal liveness still OK.
- **Metrics 401 in smoke:** expected without token; authenticated check uses `METRICS_TOKEN` from `.env`.
