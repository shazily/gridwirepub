# Rate limiting

Gridwire applies rate limits in several layers. All current implementations use **in-memory counters per process**.

## Dataset API (`/api/v1/datasets/...`)

- Per API key (secure datasets) or per client IP (public datasets)
- Configurable via `API_RATE_LIMIT_PER_MIN` and `API_RATE_LIMIT_BURST`
- Per-org overrides: `organizations.api_rate_limit_per_min`, `api_keys.rate_limit_override`
- Monthly org quota: `organizations.api_monthly_quota` on consumption events

## Public endpoints

- `/api/public/inbound/webhook` — 120/min burst 60 per IP (+ webhook auth)
- `/api/public/auth/recover` — 10/min burst 5 per IP
- Other guarded routes via `checkPublicEndpointRateLimit` in `public-endpoint-guard.server.ts`
- `PUBLIC_RATE_LIMIT_PER_MIN` / `PUBLIC_RATE_LIMIT_BURST` env defaults

## Known limitation: single replica

In-memory windows are **not shared** across multiple portal instances. Under horizontal scaling:

- Effective limit ≈ `configured_limit × replica_count`
- Attackers can spread requests across replicas

## Upgrade path (not implemented)

For multi-replica production:

1. **Valkey/Redis** — sliding-window counters keyed by `org_id`, API key id, or client IP
2. Enforce at **Nginx/APISIX** edge for coarse per-IP limits
3. Keep application-layer limits for per-key and per-org quotas

See OpenCivic ADR patterns for Valkey-backed rate limiting as the target architecture when scale requires it.
