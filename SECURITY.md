# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| `main` (latest release tag) | Yes |
| Older tags | Best effort |

## Reporting a vulnerability

**Do not open public GitHub issues for security vulnerabilities.**

Email **security@gridwire.dev** (or open a private [GitHub Security Advisory](https://github.com/shazily/gridwirepub/security/advisories/new) on this repository) with:

- Description and impact
- Steps to reproduce
- Affected version / commit
- Suggested fix (if any)

We aim to acknowledge within **5 business days** and provide a remediation timeline for confirmed issues.

## Secure deployment expectations

Gridwire is designed to **fail closed** in production when required secrets are missing or invalid:

| Variable | Behavior when missing/invalid |
| -------- | ----------------------------- |
| `FIELD_ENCRYPTION_KEY` | Portal refuses to start (`NODE_ENV=production`) |
| `INBOUND_WEBHOOK_SECRET` | Inbound email webhooks return 401; `validate-env.ps1` fails on-prem |
| `WORKER_INGEST_TOKEN` | Worker API returns 401 |
| `METRICS_TOKEN` | `/api/public/metrics` returns 401 |
| `SUPABASE_SERVICE_ROLE_KEY` | Readiness fails; admin surfaces unusable |

Never set `FIELD_ENCRYPTION_ALLOW_INSECURE_DEV=true` in production.

Generate secrets with `openssl rand -hex 32`. Use `.\scripts\bootstrap-onprem.ps1` for a full on-prem `.env` — do not copy a developer machine's `.env` to production.

## Known accepted risks (v1)

Documented tradeoffs shipped intentionally. Revisit before major releases.

### `parquetjs` / `thrift` (transitive; overridden)

- **Usage:** Write-only Parquet export in `src/lib/parquet-export.server.ts`. No Parquet read/import path.
- **v1.1.0:** `package.json` `overrides` pin `thrift@0.23.0` and `brace-expansion>=1.1.13`. `bun audit` reports **no vulnerabilities** after install.
- **Residual:** Prefer replacing `parquetjs` before adding any Parquet **read** path. See [`docs/PENDING-parquetjs-thrift-cve.md`](docs/PENDING-parquetjs-thrift-cve.md).

### In-memory rate limiting (single replica)

- Dataset and public endpoint rate limits use **per-process memory** (`docs/rate-limiting.md`).
- **Limitation:** Limits do not aggregate across multiple portal replicas; effective ceiling scales with replica count.
- **Mitigation:** Terminate at a single portal instance or front with a shared store (Valkey/Redis) — not built into v1.

### Browser session storage (Supabase client)

- Access and refresh tokens persist in **`localStorage`** by default (`docs/security-session-model.md`).
- **Limitation:** XSS in the portal origin can exfiltrate sessions. Not HttpOnly cookie-based SSO.
- **Mitigation:** Strict CSP at the reverse proxy, no third-party scripts on authenticated routes, enable GoTrue MFA for admins.

### Optional dev backend compose defaults

`docker-compose.backend.yml` (Path B dev backend only) includes weak **fallback** values for `POSTGRES_PASSWORD` and `JWT_SECRET` when env vars are unset. **Do not use that file for production.** Use `docker-compose.onprem.yml` + bootstrap, which requires real secrets via `validate-env.ps1`.

## Dependency scanning

- Run `bun run audit:deps` (or `npm audit`) before releases; document unresolved high/critical findings here or in `docs/PENDING-*.md`.
- CI runs **gitleaks** on every push/PR (`.github/workflows/gitleaks.yml`).
- **Checkmarx / enterprise SAST:** not installed in this workspace — run your org Checkmarx project against tag `v1.1.0` (or later) after publish. Local substitutes used for v1.1.0: gitleaks (clean), `bun audit`, Vitest `tests/security/*`, and controlled white-hat probes against the demo hostname (no destructive data access).

## v1.1.0 hardening (2026-07-23)

| Item | Status |
| ---- | ------ |
| Proxied `/auth/v1` + `/rest/v1` rate limits | Added (token/signup/recover stricter) |
| PostgREST OpenAPI at `/rest/v1/` | Blocked (404) |
| Client `X-Forwarded-*` into Kong | Stripped |
| Recovery OTP | 5 minutes (`GOTRUE_MAILER_OTP_EXP=300`) |
| gitleaks full tree | No leaks |
| `parquetjs`/`thrift` | `overrides` → thrift 0.23.0; `bun audit` clean |

## Public release checklist

Operators making the repository public should follow the full checklist in [`deploy/on-prem/README.md`](deploy/on-prem/README.md) (Production ship checklist) plus secret rotation for any credentials ever used in development.
