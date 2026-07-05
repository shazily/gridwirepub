# Self-hosted Supabase backend for Gridwire

Gridwire's portal needs Postgres, authentication (GoTrue), and a REST layer (PostgREST). This guide runs the standard open-source Supabase Docker stack alongside Gridwire on your own hardware.

## 1. Clone the Supabase Docker stack (sibling directory)

```bash
cd ..
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
```

Edit `supabase/docker/.env`:

| Variable | Purpose |
| --- | --- |
| `POSTGRES_PASSWORD` | Database password |
| `JWT_SECRET` | Signs auth tokens — keep secret |
| `ANON_KEY` | Public API key (maps to `SUPABASE_PUBLISHABLE_KEY`) |
| `SERVICE_ROLE_KEY` | Privileged key (maps to `SUPABASE_SERVICE_ROLE_KEY`) |
| `SITE_URL` | Your portal URL (e.g. `https://data.your-company.com`) |
| `SMTP_*` | Email for auth invites / confirmations |

Start the stack:

```bash
docker compose up -d
```

The API gateway listens on **port 8000** by default (`http://localhost:8000`).

## 2. Apply Gridwire migrations

From the Gridwire repo root:

```bash
export DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres"
chmod +x scripts/apply-migrations.sh
./scripts/apply-migrations.sh
```

Migrations live in [`supabase/migrations`](../../supabase/migrations) and are applied in filename order.

## 3. Wire the portal

Copy Gridwire's `.env.example` to `.env` and set:

```env
SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_URL=http://localhost:8000
SUPABASE_PUBLISHABLE_KEY=<ANON_KEY from supabase/docker/.env>
VITE_SUPABASE_PUBLISHABLE_KEY=<same>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
FIELD_ENCRYPTION_KEY=<openssl rand -hex 32>
WORKER_INGEST_TOKEN=<openssl rand -hex 32>
METRICS_TOKEN=<openssl rand -hex 32>
```

Start Gridwire:

```bash
docker compose up -d --build
```

The portal binds to `127.0.0.1:3000` — do not expose it directly.

## 4. Cloudflare Tunnel

Expose the portal through Cloudflare Tunnel without opening inbound ports:

1. Install `cloudflared` on the host running Docker.
2. Authenticate: `cloudflared tunnel login`
3. Create a tunnel: `cloudflared tunnel create gridwire`
4. Configure `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /path/to/<TUNNEL_UUID>.json

ingress:
  - hostname: data.your-company.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

5. Route DNS: `cloudflared tunnel route dns gridwire data.your-company.com`
6. Run: `cloudflared tunnel run gridwire`

**Metrics:** `/api/public/metrics` requires `METRICS_TOKEN`. Do not publish this path on a public hostname — use a separate internal tunnel or scrape from the Docker host loopback only.

**Supabase API:** Put `api.your-company.com` behind TLS (reverse proxy or a second tunnel) pointing at `localhost:8000`. Set `SUPABASE_URL` / `VITE_SUPABASE_URL` to that HTTPS URL.

## 5. Optional full-stack compose

Keep Supabase and Gridwire as separate compose projects (recommended for upgrades). Join them on a shared Docker network if the portal must reach `kong:8000` by service name instead of `host.docker.internal`.

## 6. Verify

```bash
curl -fsS http://127.0.0.1:3000/api/public/health
curl -fsS -H "Authorization: Bearer $METRICS_TOKEN" http://127.0.0.1:3000/api/public/metrics
```

Sign in at `https://data.your-company.com`, create an org, upload a dataset, and confirm the generated API responds.
