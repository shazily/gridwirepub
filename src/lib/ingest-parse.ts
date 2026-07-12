/**
 * Shared ingest parse facade — routes spreadsheet vs PDF into ParsedWorkbook.
 * Spreadsheet parsing is sync/local; PDF parsing is AI-first and async (server-only).
 */

import {
  parseWorkbookFromBuffer,
  type ParsedWorkbook,
} from "@/lib/spreadsheet";
import {
  detectIngestFormat,
  type IngestParseMeta,
  type PdfParseConfidence,
} from "@/lib/ingest-file-types";

export type { IngestFileFormat, IngestParseMeta, PdfParseConfidence, PdfSheetConfidence } from "@/lib/ingest-file-types";
export {
  detectIngestFormat,
  ingestFileExtension,
  isPdfFileName,
  isSpreadsheetFileName,
} from "@/lib/ingest-file-types";

export type IngestParseResult = {
  workbook: ParsedWorkbook;
  meta: IngestParseMeta;
};

/** Sync path for Excel/CSV — used by UI and workers that already hold a buffer. */
export function parseSpreadsheetIngest(
  buf: ArrayBuffer,
  fileName: string,
  opts?: { maxRowsPerSheet?: number },
): IngestParseResult {
  const workbook = parseWorkbookFromBuffer(buf, fileName, opts);
  return {
    workbook,
    meta: { format: "spreadsheet", parser: "sheetjs" },
  };
}

/**
 * Async facade: spreadsheets parse locally; PDFs require the AI server module.
 * Call only from server handlers / workers — not from client components.
 */
export async function parseIngestFile(
  buf: ArrayBuffer,
  fileName: string,
  opts?: { maxRowsPerSheet?: number; maxPages?: number; orgId?: string | null },
): Promise<IngestParseResult> {
  const format = detectIngestFormat(fileName);
  if (!format) {
    throw new Error(`Unsupported file type for ingest: ${fileName || "(no name)"}`);
  }
  if (format === "spreadsheet") {
    return parseSpreadsheetIngest(buf, fileName, opts);
  }
  const { parsePdfTablesWithAi } = await import("@/lib/pdf-parse.ai.server");
  return parsePdfTablesWithAi(buf, fileName, opts);
}

// Re-export PdfParseConfidence for server modules that import from here
export type { PdfParseConfidence as _PdfParseConfidence };
