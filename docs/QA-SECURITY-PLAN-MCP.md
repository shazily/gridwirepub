# QA & defensive security plan — MCP + platform health (2026-11-21)

**Goal:** Prove new MCP / health / download surfaces behave as designed and fail closed.  
**Constraint:** Defensive verification only (expected status codes, auth gates, schema). No exploit payloads or attack scripts.

## Scope

| Area | What “pass” means |
|------|-------------------|
| Marketing layout | Homepage SSR includes Gridwire brand + MCP; desktop uses full-width composition |
| MCP download | `GET /api/public/mcp/download` → 200, `application/zip`, ZIP local file header `PK` |
| Hosted MCP | No Bearer → 401; invalid Bearer → 401; no stack traces in JSON errors |
| Discovery API | `GET /api/v1/datasets` without key → 401 |
| Dataset metadata | Response includes `mcp_enabled` when authenticated path is tested via unit/client mocks |
| Migration | `datasets.mcp_enabled` boolean default true present in DB |
| Unit / MCP package | `bun test` (vitest) + `bun run mcp:test` all green |
| Existing security suite | `tests/security/*` all green |
| Deploy smoke | `scripts/smoke-test.ps1` all green (incl. new MCP checks) |

## Execution order

1. Unit + MCP package tests (offline)
2. Existing security vitest suite
3. Live defensive HTTP checks (portal on `:3020`)
4. Extended smoke script (MCP cases)
5. Fix any failure; re-run until 100% pass
6. Rebuild portal if UI/layout or download route changed; re-verify smoke

## Out of scope

- OAuth device flow for MCP (deferred product stretch)
- Offensive exploitation / CTF-style attacks
- npm publish of `@gridwire/mcp-server`
