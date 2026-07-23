# parquetjs / thrift CVE assessment

**Status:** **MITIGATED for audit** (2026-07-23, v1.1.0) — `overrides.thrift` → `0.23.0`. `bun audit` clean. Still prefer replacing `parquetjs` before any Parquet read path.

**Decision:** Keep write-only Parquet export; pin thrift via overrides. Revisit before adding Parquet read/import.

## Dependency chain

`parquetjs` → `thrift` (Apache Thrift Node.js bindings)

## Advisories (npm audit)

| Package | Severity | GHSA | Summary |
|---------|----------|------|---------|
| thrift | high | [GHSA-r67j-r569-jrwp](https://github.com/advisories/GHSA-r67j-r569-jrwp) | Uncontrolled recursion |
| thrift | high | [GHSA-526f-jxpj-jmg2](https://github.com/advisories/GHSA-526f-jxpj-jmg2) | Path traversal, HTTP splitting, resource consumption |

`npm audit` reports **no fix available** without replacing `parquetjs`.

## How Gridwire uses parquetjs

Code path: `src/lib/parquet-export.server.ts` only.

- **Write-only:** `ParquetWriter.openFile` writes Parquet from in-memory rows produced by the portal (published dataset exports and version snapshots).
- **No read path:** There is no `ParquetReader` usage. User-uploaded Parquet files are not parsed.

## Risk assessment

| Scenario | Exposure |
|----------|----------|
| Attacker supplies malicious Parquet upload | **Not in scope** — uploads are Excel/CSV; Parquet is output-only |
| Attacker triggers export API | Receives Parquet **written by us** from trusted DB rows; does not parse attacker-controlled Parquet server-side |
| thrift SSRF/path traversal via Parquet **read** | **Low** — we do not read Parquet with parquetjs |
| thrift issues during **write** of attacker-controlled cell values | **Low** — cell values are serialized as typed fields; no thrift RPC to external hosts |

## Owner options

1. **Accept and document** — current usage is write-only on trusted data; revisit if Parquet import is added.
2. **Replace parquetjs** — e.g. `@dsnp/parquetjs`, `parquet-wasm`, or DuckDB-based export (engineering effort).
3. **Vendor a patched fork** — only if a maintained fork exists for the thrift transitive dep.

**Recommendation:** Accept-and-document for v1 public release given write-only usage; block Parquet **import** until dependency is replaced.
