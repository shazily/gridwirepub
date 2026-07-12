/**
 * Client-safe ingest file helpers (no server / LLM imports).
 */

export type IngestFileFormat = "spreadsheet" | "pdf";

export type PdfSheetConfidence = {
  sheetName: string;
  confidence: number;
  needsReview: boolean;
  flags: string[];
};

export type PdfParseConfidence = {
  overall: number;
  sheets: PdfSheetConfidence[];
  pageCount: number;
  model?: string;
};

export type IngestParseMeta = {
  format: IngestFileFormat;
  confidence?: PdfParseConfidence;
  aiModel?: string;
  pageCount?: number;
  parser?: "sheetjs" | "ai";
};

const SPREADSHEET_EXT = new Set([".xlsx", ".xls", ".xlsm", ".xlsb", ".csv"]);

export function ingestFileExtension(fileName: string): string {
  const m = /\.[^.]+$/.exec(fileName.trim().toLowerCase());
  return m?.[0] ?? "";
}

export function detectIngestFormat(fileName: string): IngestFileFormat | null {
  const ext = ingestFileExtension(fileName);
  if (ext === ".pdf") return "pdf";
  if (SPREADSHEET_EXT.has(ext)) return "spreadsheet";
  return null;
}

export function isPdfFileName(fileName: string): boolean {
  return detectIngestFormat(fileName) === "pdf";
}

export function isSpreadsheetFileName(fileName: string): boolean {
  return detectIngestFormat(fileName) === "spreadsheet";
}
