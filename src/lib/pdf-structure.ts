/**
 * Client-safe PDF structure types (layout only — not full table data).
 */

import { dedupeApiNames, snakeCase, type ParsedColumn, type ParsedSheet, type ParsedWorkbook } from "@/lib/spreadsheet";

export const PDF_STRUCTURE_SAMPLE_ROWS = 3;

export type PdfStructureColumn = {
  original_name: string;
  api_name: string;
  data_type?: string;
  included: boolean;
};

export type PdfStructureTable = {
  id: string;
  name: string;
  included: boolean;
  page_hint?: number | null;
  headers: PdfStructureColumn[];
  sample_rows: unknown[][];
  confidence?: number;
  flags?: string[];
  notes?: string;
};

export type PdfStructureSnapshot = {
  page_count: number;
  tables: PdfStructureTable[];
  notes?: string;
  model?: string;
};

export function structureTableId(index: number, name: string): string {
  const slug = snakeCase(name || `table_${index + 1}`).slice(0, 40) || `table_${index + 1}`;
  return `${slug}_${index + 1}`;
}

/** Build a preview workbook from structure (sample rows only). */
export function workbookFromStructure(
  structure: PdfStructureSnapshot,
  fileName: string,
): ParsedWorkbook {
  const sheets: ParsedSheet[] = [];
  for (const table of structure.tables) {
    if (!table.included) continue;
    const cols = table.headers.filter((h) => h.included && h.api_name.trim());
    if (cols.length === 0) continue;
    const headers: ParsedColumn[] = cols.map((h) => ({
      original_name: h.original_name || h.api_name,
      api_name: h.api_name,
      data_type: (h.data_type as ParsedColumn["data_type"]) || "string",
    }));
    const rows = (table.sample_rows ?? []).slice(0, PDF_STRUCTURE_SAMPLE_ROWS).map((r) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        let val: unknown = Array.isArray(r) ? (r[i] ?? null) : null;
        if (val instanceof Date) val = val.toISOString();
        obj[h.api_name] = val;
      });
      return obj;
    });
    sheets.push({
      name: table.name.slice(0, 120) || "table",
      headers,
      rows,
      rowCount: rows.length,
      truncated: false,
    });
  }
  return { sheets, hasMacros: false, fileName };
}

/** Normalize AI/user structure into a stable snapshot. */
export function normalizeStructureSnapshot(
  input: Partial<PdfStructureSnapshot> & { tables?: Partial<PdfStructureTable>[] },
  fallbackPageCount = 0,
): PdfStructureSnapshot {
  const tables: PdfStructureTable[] = (input.tables ?? []).map((t, index) => {
    const name = (t.name?.trim() || `Table ${index + 1}`).slice(0, 120);
    const rawHeaders = (t.headers ?? []).map((h, i) => {
      if (typeof h === "string") {
        const original = h.trim() || `column_${i + 1}`;
        return {
          original_name: original,
          api_name: snakeCase(original) || `column_${i + 1}`,
          data_type: "string",
          included: true,
        } satisfies PdfStructureColumn;
      }
      const original = (h.original_name?.trim() || h.api_name?.trim() || `column_${i + 1}`).slice(0, 200);
      return {
        original_name: original,
        api_name: (h.api_name?.trim() || snakeCase(original) || `column_${i + 1}`).slice(0, 120),
        data_type: h.data_type || "string",
        included: h.included !== false,
      } satisfies PdfStructureColumn;
    });
    const apiNames = dedupeApiNames(rawHeaders.map((h) => h.api_name));
    const headers = rawHeaders.map((h, i) => ({ ...h, api_name: apiNames[i]! }));
    const sample_rows = (t.sample_rows ?? [])
      .slice(0, PDF_STRUCTURE_SAMPLE_ROWS)
      .map((row) => (Array.isArray(row) ? row.slice(0, headers.length) : []));

    return {
      id: t.id?.trim() || structureTableId(index, name),
      name,
      included: t.included !== false,
      page_hint: typeof t.page_hint === "number" ? t.page_hint : null,
      headers,
      sample_rows,
      confidence: typeof t.confidence === "number" ? Math.min(1, Math.max(0, t.confidence)) : undefined,
      flags: t.flags ?? [],
      notes: t.notes,
    };
  });

  return {
    page_count: input.page_count ?? fallbackPageCount,
    tables,
    notes: input.notes,
    model: input.model,
  };
}

export function includedStructureTables(structure: PdfStructureSnapshot): PdfStructureTable[] {
  return structure.tables.filter(
    (t) => t.included && t.headers.some((h) => h.included && h.api_name.trim()),
  );
}

export function fileNameMatchesPdfPattern(fileName: string, pattern: string | null | undefined): boolean {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".pdf")) return false;
  const p = pattern?.trim().toLowerCase();
  if (!p || p === "*" || p === "*.*" || p === "*.pdf") return true;
  if (p.startsWith("*.") && !p.slice(2).includes("*")) {
    return lower.endsWith(p.slice(1));
  }
  // Glob-ish: *kpi*.pdf → contains "kpi" and ends with .pdf
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  try {
    return new RegExp(`^${escaped}$`, "i").test(lower);
  } catch {
    return lower.includes(p.replace(/\*/g, ""));
  }
}
