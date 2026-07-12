/**
 * Deterministic full-row extract from PDF text once headers are known.
 * Prefer this over LLM for bank statements / simple grids — samples stay in structure phase only.
 */

import { PDF_STRUCTURE_SAMPLE_ROWS } from "@/lib/pdf-structure";

const DATE_LINE_RE =
  /^(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})/;

const MONEY_RE =
  /-?\$?\(?\d{1,3}(?:,\d{3})+(?:\.\d{2})?\)?|-?\$?\(?\d+(?:\.\d{2})?\)?/g;

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
export function splitPdfTextIntoLines(pages: string[]): string[] {
  const lines: string[] = [];
  for (const page of pages) {
    const raw = page
      .split(/\n+/)
      .map((l) => normalizeSpaces(l))
      .filter((l) => l.length > 0);
    if (raw.length > 1) {
      lines.push(...raw);
      continue;
    }
    // pdf.js often returns one long string — split on dates / double spaces.
    const blob = normalizeSpaces(page);
    if (!blob) continue;
    const byDate = blob.split(
      /(?=(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\b)/,
    );
    if (byDate.length > 1) {
      for (const part of byDate) {
        const t = normalizeSpaces(part);
        if (t.length > 3) lines.push(t);
      }
      continue;
    }
    for (const part of blob.split(/\s{2,}|\t+/)) {
      const t = normalizeSpaces(part);
      if (t.length > 3) lines.push(t);
    }
  }
  return lines;
}

function looksLikeHeaderLine(line: string, headers: string[]): boolean {
  const lower = line.toLowerCase();
  let hits = 0;
  for (const h of headers) {
    const token = h.toLowerCase().trim();
    if (token.length >= 2 && lower.includes(token)) hits++;
  }
  return hits >= Math.min(2, headers.length);
}

/**
 * Parse a bank-statement-ish line into cells matching headerCount
 * (typically date, description, amount[, balance]).
 */
function parseBankStyleRow(line: string, headerCount: number): unknown[] | null {
  if (!DATE_LINE_RE.test(line)) return null;
  const dateMatch = DATE_LINE_RE.exec(line);
  if (!dateMatch) return null;
  const date = dateMatch[1]!;
  const rest = normalizeSpaces(line.slice(dateMatch[0].length));
  const moneyMatches = [...rest.matchAll(MONEY_RE)];
  if (moneyMatches.length === 0) return null;

  const moneyCount = headerCount >= 4 ? 2 : 1;
  const used = moneyMatches.slice(-moneyCount);
  const firstMoney = used[0];
  if (!firstMoney || firstMoney.index == null) return null;
  const desc = normalizeSpaces(rest.slice(0, firstMoney.index));
  if (!desc) return null;

  const values = used.map((m) => m[0]!.replace(/[,$()\s]/g, "").replace(/^\((.+)\)$/, "-$1"));
  if (headerCount === 4) {
    return [date, desc, values[0] ?? null, values[1] ?? null];
  }
  if (headerCount === 3) {
    return [date, desc, values[values.length - 1] ?? null];
  }
  if (headerCount === 2) {
    return [date, values[values.length - 1] ?? desc];
  }
  return null;
}

function parseDelimitedRow(line: string, headerCount: number): unknown[] | null {
  let cells = line.split(/\t|\s{2,}|\|/).map((c) => c.trim()).filter(Boolean);
  if (cells.length === 1 && line.includes(",")) {
    cells = line.split(",").map((c) => c.trim()).filter(Boolean);
  }
  if (cells.length < headerCount) return null;
  if (cells.length > headerCount) {
    // Merge middle cells into description-like column.
    const head = cells[0]!;
    const tail = cells.slice(-(headerCount - 2));
    const mid = cells.slice(1, cells.length - (headerCount - 2)).join(" ");
    cells = [head, mid, ...tail].slice(0, headerCount);
  }
  return cells.slice(0, headerCount);
}

function headerLooksBankStyle(headers: string[]): boolean {
  const joined = headers.map((h) => h.toLowerCase()).join(" ");
  const hasDate = /date|posted|trans/.test(joined);
  const hasAmt = /amount|debit|credit|withdrawal|deposit/.test(joined);
  return hasDate && hasAmt;
}

/**
 * Extract all data rows for known headers from PDF page text.
 * Returns [] when nothing usable is found (caller may fall back to LLM).
 */
export function extractRowsFromTextWithHeaders(
  pages: string[],
  headers: string[],
  rowCap: number,
): unknown[][] {
  if (headers.length === 0) return [];
  const lines = splitPdfTextIntoLines(pages);
  const rows: unknown[][] = [];
  const bankStyle = headerLooksBankStyle(headers);

  for (const line of lines) {
    if (looksLikeHeaderLine(line, headers)) continue;
    if (line.length < 4) continue;

    let row: unknown[] | null = null;
    if (bankStyle) {
      row = parseBankStyleRow(line, headers.length);
    }
    if (!row) {
      row = parseDelimitedRow(line, headers.length);
    }
    if (!row) continue;

    // Skip if first cell looks like a header label
    if (String(row[0] ?? "").toLowerCase() === headers[0]!.toLowerCase()) continue;

    rows.push(row.map((c) => (c === "" ? null : c)));
    if (rows.length >= rowCap) break;
  }

  return rows;
}

export function isSampleOnlyRowCount(rowCount: number): boolean {
  return rowCount > 0 && rowCount <= PDF_STRUCTURE_SAMPLE_ROWS;
}
