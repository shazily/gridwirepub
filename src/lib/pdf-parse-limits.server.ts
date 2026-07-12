/**
 * Limits and helpers so large PDF AI jobs cannot overwhelm the portal process.
 */

export function pdfParseMaxBytes(): number {
  const raw = Number(process.env.PDF_PARSE_MAX_BYTES ?? 25 * 1024 * 1024);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 25 * 1024 * 1024;
}

export function pdfParseMaxConcurrentPerOrg(): number {
  const raw = Number(process.env.PDF_PARSE_MAX_CONCURRENT_PER_ORG ?? 2);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 2;
}

export function pdfParseLlmTimeoutMs(): number {
  const raw = Number(process.env.PDF_PARSE_LLM_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(raw) && raw >= 10_000 ? Math.floor(raw) : 120_000;
}

/** Full data extract may scan more pages; structure discovery must stay tiny. */
export function pdfParseMaxPages(): number {
  const raw = Number(process.env.PDF_PARSE_MAX_PAGES ?? 30);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 30;
}

/**
 * Structure mapping only looks at the start of the PDF (headers live here).
 * Default 2 pages — never the whole statement.
 */
export function pdfParseStructureMaxPages(): number {
  const raw = Number(process.env.PDF_PARSE_STRUCTURE_MAX_PAGES ?? 2);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 2;
}

/** Hard cap on text sent to the LLM during structure discovery (chars). */
export function pdfParseStructureMaxChars(): number {
  const raw = Number(process.env.PDF_PARSE_STRUCTURE_MAX_CHARS ?? 8_000);
  return Number.isFinite(raw) && raw >= 1_500 ? Math.floor(raw) : 8_000;
}

/** Shorter timeout for structure-only LLM calls. */
export function pdfParseStructureLlmTimeoutMs(): number {
  const raw = Number(process.env.PDF_PARSE_STRUCTURE_LLM_TIMEOUT_MS ?? 45_000);
  return Number.isFinite(raw) && raw >= 8_000 ? Math.floor(raw) : 45_000;
}

/** Mark processing drafts older than this as failed. */
export function pdfParseStaleMs(): number {
  const raw = Number(process.env.PDF_PARSE_STALE_MS ?? 15 * 60 * 1000);
  return Number.isFinite(raw) && raw >= 60_000 ? Math.floor(raw) : 15 * 60 * 1000;
}

export function formatBytesShort(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
