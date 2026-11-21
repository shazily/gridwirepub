# Feature backlog — Gridwire MCP connector

**Status:** Phases 1–4 complete (2026-11-21) — stdio package, download zip, marketing, resources/prompts, hosted `/api/mcp`, citation + AI-access flag + evals  
**Created:** 2026-11-21  
**Goal:** Let end users add Gridwire as an MCP server / “skill” in AI chat clients (Cursor, Claude Desktop, ChatGPT custom connectors, etc.) so agents can discover datasets, read schemas, and query published data with the same auth and governance as the REST API.

---

## Why this exists

Operators already expose versioned REST + OpenAPI per dataset. AI clients increasingly expect **MCP** (Model Context Protocol) tools instead of ad-hoc cURL. An official Gridwire MCP connector:

1. Turns “paste this OpenAPI URL” into **installable tools** (`list_datasets`, `get_schema`, `query_rows`, …).
2. Reuses existing API keys, rate limits, field protection, and publish state — no parallel auth model.
3. Complements (does not replace) Swagger / REST; MCP is a **client adapter**, not a new data plane.

---

## Product principles

| Principle | Decision |
|-----------|----------|
| One auth story | MCP authenticates with existing workspace **API keys** (Bearer). No separate MCP secrets store in v1. |
| Same data plane | Tools call the same `/api/v1/datasets/...` handlers (or shared server modules). No second query engine. |
| Least privilege | Tools are read-oriented by default. Writes (publish, rotate keys) are out of scope for v1. |
| Fail closed | Unpublished / archived datasets do not appear as queryable. Secure datasets require a key. |
| Skill-friendly | Ship a short install snippet (Cursor `mcp.json`, Claude Desktop config, generic SSE/stdio). |
| Air-gapped capable | Support stdio local process and optional HTTP/SSE remote endpoint for self-host. |

---

## Personas & jobs-to-be-done

1. **Analyst in Cursor / Claude** — “What columns does the FX rates dataset expose?” → `get_schema` → cited answer.
2. **Developer integrating an agent** — Add Gridwire MCP once; reuse across chats without regenerating OpenAPI clients.
3. **Org admin** — Issue a scoped API key, point staff at the MCP install doc; revoke key to cut off agents.

---

## Delivery phases

### Phase 0 — Foundations (prerequisite, mostly done)

- [x] Versioned REST API per dataset  
- [x] OpenAPI JSON per dataset  
- [x] API keys + public/secure access  
- [x] Platform health + per-endpoint probes (operator confidence before MCP traffic)  
- [x] Document `PUBLIC_APP_URL` requirements for remote MCP clients (`mcp/README.md`, Admin → API docs)  
- [x] `GET /api/v1/datasets` discovery for API-key holders  

### Phase 1 — MCP server MVP (stdio) — **done**

**Package:** `mcp/` → `@gridwire/mcp-server` (MIT).

| ID | Item | Notes |
|----|------|-------|
| MCP-1.1 | Scaffold MCP server with `@modelcontextprotocol/sdk` | stdio transport — `mcp/src/index.ts` |
| MCP-1.2 | Config via env: `GRIDWIRE_BASE_URL`, `GRIDWIRE_API_KEY` | + `GRIDWIRE_DATASET_IDS` allowlist |
| MCP-1.3 | Tool `list_datasets` | Uses `GET /api/v1/datasets` |
| MCP-1.4 | Tool `get_dataset` | Metadata: name, sheets, access, version, OpenAPI URL |
| MCP-1.5 | Tool `get_schema` | Field names / types / protection flags |
| MCP-1.6 | Tool `query_rows` | Hard cap limit ≤ 100 |
| MCP-1.7 | Tool `get_openapi_url` | Absolute OpenAPI JSON URL |
| MCP-1.8 | Error mapping | 401/404/429 → clear MCP tool errors |
| MCP-1.9 | Install docs | `mcp/README.md` + in-app copy panels |
| MCP-1.10 | Smoke tests | `mcp/tests/*` (mocked HTTP) |

**Exit criteria:** User can add Gridwire MCP in Cursor with base URL + API key and successfully `query_rows` on a public or secure published dataset.

### Phase 2 — Skill packaging & discovery — **done**

| ID | Item | Notes |
|----|------|-------|
| MCP-2.1 | “Add to AI” panel on dataset API tab | Cursor + remote snippets, download, MCP toggle |
| MCP-2.2 | Admin → API docs: MCP install card | Download + stdio + remote snippets |
| MCP-2.3 | Optional dataset allowlist in MCP config | `GRIDWIRE_DATASET_IDS` |
| MCP-2.4 | Resources (MCP resources) | `gridwire://datasets`, OpenAPI, contract |
| MCP-2.5 | Prompts | `explain_dataset`, `draft_filter_query` |
| MCP-2.6 | End-user download | `GET /api/public/mcp/download` + `bun run mcp:pack` → zip |

### Phase 3 — Remote / hosted MCP — **done** (OAuth stretch deferred)

| ID | Item | Notes |
|----|------|-------|
| MCP-3.1 | HTTP+SSE (or streamable HTTP) MCP endpoint on portal | `/api/mcp` Streamable HTTP |
| MCP-3.2 | Per-org enable flag | `ai_config.mcp_remote_enabled` (Admin → AI) |
| MCP-3.3 | Audit events | `mcp.tool_call` latency + key id (no row payloads) |
| MCP-3.4 | Rate limit alignment | `checkRateLimit` on hosted path |
| MCP-3.5 | OAuth2 / device flow (stretch) | Deferred — API key remains supported |

### Phase 4 — Agent quality & governance — **done**

| ID | Item | Notes |
|----|------|-------|
| MCP-4.1 | Citation helper tool | `cite_source` + citation block on `query_rows` |
| MCP-4.2 | Row budget / field projection | limit ≤ 100; optional `fields[]` |
| MCP-4.3 | Blocked tools for masked/encrypted fields | Documented — same protection as REST |
| MCP-4.4 | Steward policy | `datasets.mcp_enabled` + UI switch |
| MCP-4.5 | Eval suite | `mcp/tests/eval-smoke.test.ts` |

---

## Proposed tool surface (v1)

```text
list_datasets() -> [{ id, name, sheets[], api_access, version }]
get_dataset(dataset_id)
get_schema(dataset_id, sheet?)
query_rows(dataset_id, sheet, limit?=50, offset?=0, filters?={}, fields?=[])
cite_source(dataset_id, sheet, ...)
get_openapi_url(dataset_id)
```

Non-goals for v1: publish, upload, rotate keys, mutate field protection, connector runs.

---

## Example Cursor skill install (target UX)

```json
{
  "mcpServers": {
    "gridwire": {
      "command": "npx",
      "args": ["-y", "@gridwire/mcp-server"],
      "env": {
        "GRIDWIRE_BASE_URL": "https://your-portal.example",
        "GRIDWIRE_API_KEY": "gw_..."
      }
    }
  }
}
```

Remote (Phase 3):

```json
{
  "mcpServers": {
    "gridwire": {
      "url": "https://your-portal.example/api/mcp",
      "headers": { "Authorization": "Bearer gw_..." }
    }
  }
}
```

---

## API gaps to close before / during MCP-1

| Gap | Why | Status |
|-----|-----|--------|
| Stable “list published datasets for this API key” endpoint | Agents need discovery without portal UI session | **Done** — `GET /api/v1/datasets` |
| Absolute OpenAPI `servers[0].url` always = `PUBLIC_APP_URL` | Remote MCP clients break on wrong origin | **Done** — `resolvePublicOrigin` + docs |
| Optional HEAD/health on dataset base path | Cheap preflight from MCP server startup | **Done** — existing HEAD + `/api/public/health` |

---

## Security checklist

- [x] Never log API keys or row payloads in MCP server logs  
- [x] Default max `limit` 100; reject larger  
- [x] Respect dataset `archived` / unpublished  
- [x] Same field masking/encryption as REST  
- [x] Document that MCP inherits key blast radius — prefer read-only keys when key scopes land  
- [x] Threat model note: prompt injection via cell text → treat cell values as untrusted in agent instructions  

---

## Success metrics

| Metric | Target (90 days after MVP) |
|--------|----------------------------|
| Time for a new user to first successful `query_rows` via MCP | &lt; 15 minutes with docs |
| MCP tool error rate (5xx / unexpected) | &lt; 1% of calls |
| Support tickets “Swagger down / can’t try API” diverted to MCP or in-app probes | Measurable drop |

---

## Suggested build order (engineering)

1. Close discovery API gap + confirm OpenAPI origin — **done**  
2. Phase 1 stdio MCP package + docs — **done**  
3. Dataset / Admin “Add to AI” + download + marketing — **done**  
4. Phase 3 remote endpoint — **done**  
5. Phase 4 governance + evals — **done**  

---

## Out of scope (explicit)

- Training or fine-tuning models on tenant data  
- Replacing REST/OData clients  
- Granting MCP access without an API key  
- Executing arbitrary SQL against portal Postgres  
- OAuth2 / device flow for MCP (stretch; revisit if clients require it)

---

*Related: Admin → Platform health; dataset API tab → Test endpoints; `/docs/{datasetId}` Swagger; marketing Download MCP CTA.*
