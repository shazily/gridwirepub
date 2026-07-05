import type { ServeField } from "@/lib/api-serve.server";

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Builds a UTF-8 CSV string from shaped API rows (post-masking).
 */
export function rowsToCsv(rows: Record<string, unknown>[], fields: ServeField[]): string {
  const headers = fields.map((f) => f.api_name);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}
