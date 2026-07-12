# Gridwire

**Turn spreadsheets and PDFs into secure, documented REST APIs — on your own infrastructure.**

Gridwire is an MIT-licensed, self-hostable portal: upload Excel/CSV/PDF, map fields, publish versioned APIs with API keys, masking, connectors, email ingest, and multi-tenant workspaces. This repository is the **public distribution** for operators who deploy Gridwire for their organization.

## Quickstart (recommended)

**Requirements:** Docker (4 GB+ RAM), PowerShell (Windows) or bash (Linux/macOS), Node.js (for bootstrap JWT generation).

```powershell
git clone https://github.com/shazily/gridwirepub.git
cd gridwirepub
.\scripts\deploy.ps1 up
```

Linux/macOS:

```bash
git clone https://github.com/shazily/gridwirepub.git
cd gridwirepub
chmod +x scripts/bootstrap-onprem.sh scripts/deploy.sh
./scripts/deploy.sh up
```

- If `.env` is missing, deploy runs **`bootstrap-onprem`** and generates secrets locally.
- Portal (default): **http://127.0.0.1:3020**
- **No default admin password** — open the portal, sign up, create your organization.

Verify: `.\scripts\deploy.ps1 smoke`

## Manual setup

```bash
cp .env.example .env
# Option A — generate a full on-prem .env:
./scripts/bootstrap-onprem.ps1    # Windows: .\scripts\bootstrap-onprem.ps1
./scripts/validate-env.ps1
docker compose -f docker-compose.onprem.yml up -d --build
./scripts/deploy.ps1 migrate
```

Generate individual secrets:

```bash
openssl rand -hex 32   # FIELD_ENCRYPTION_KEY, WORKER_INGEST_TOKEN, METRICS_TOKEN, INBOUND_WEBHOOK_SECRET
```

**Never commit `.env`.** Never copy another machine's `.env` to production.

## Configure for your organization

| Step | What to do |
|------|------------|
| **Public URL** | Set `PUBLIC_APP_URL`, `SITE_URL`, `VITE_SUPABASE_URL` to your domain; terminate TLS at Nginx/Traefik ([`deploy/nginx/gridwire.conf`](./deploy/nginx/gridwire.conf)) |
| **Outbound email** | Configure `SMTP_*` or Postmark in `.env` for alerts and password reset (`SKIP_EMAIL=true` to disable) |
| **Inbound email ingest** | Set `INGEST_EMAIL_DOMAIN`, `INBOUND_WEBHOOK_SECRET`, `CLAMAV_REQUIRED=true`; route MX/webhook to `/api/public/inbound/webhook` — see [on-prem guide](./deploy/on-prem/README.md) |
| **Storage** | MinIO is included on-prem; set `STORAGE_SECRET_KEY` / `MINIO_ROOT_PASSWORD` |
| **SFTP connectors** | Passwords in worker `SFTP_SECRETS` JSON only — [migration guide](./docs/connector-credentials-migration.md) |
| **IP allowlisting** | **Admin → Security** in the portal |

Full operator checklist: **[`deploy/on-prem/README.md`](./deploy/on-prem/README.md)**

## Environment variables

See **[`.env.example`](./.env.example)** — every required and optional variable with comments.

| Variable | Required | Purpose |
|----------|----------|---------|
| `FIELD_ENCRYPTION_KEY` | yes | 64 hex chars; production fails without it |
| `WORKER_INGEST_TOKEN` | yes | Worker ↔ portal auth |
| `METRICS_TOKEN` | yes | Protects `/api/public/metrics` |
| `INBOUND_WEBHOOK_SECRET` | on-prem / internet | Inbound email webhooks |
| `SUPABASE_*` / `DATABASE_URL` | yes | Backend connection (auto-set by bootstrap on-prem) |

## Architecture

```
Portal (UI + /api/v1) → Kong → GoTrue + PostgREST + Postgres + MinIO
                              ↑
Worker (SFTP/folder ingest) ──┘
```

Companion worker: [`worker/README.md`](./worker/README.md)

## Documentation

| Doc | Contents |
|-----|----------|
| [`deploy/on-prem/README.md`](./deploy/on-prem/README.md) | Production deploy, connectors, email ingest, air-gap |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Kubernetes/Helm, TLS, backups |
| [`SECURITY.md`](./SECURITY.md) | Vulnerability reporting, known risks |
| [`docs/connector-credentials-migration.md`](./docs/connector-credentials-migration.md) | SFTP secrets hygiene |

## Security

- API keys stored hashed; connector passwords not in Postgres
- Secure dataset metadata requires API keys
- Inbound webhooks fail closed without `INBOUND_WEBHOOK_SECRET` in production
- Containers run as non-root user `gridwire`

Report issues via [GitHub Security Advisories](https://github.com/shazily/gridwirepub/security/advisories/new).

## License

[MIT](./LICENSE)
