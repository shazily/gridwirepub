import * as XLSX from "xlsx";

export type ParsedColumn = {
  original_name: string;
  api_name: string;
  data_type: "string" | "number" | "boolean" | "date";
};

export type ParsedSheet = {
  name: string;
  headers: ParsedColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
};

export type ParsedWorkbook = {
  sheets: ParsedSheet[];
  hasMacros: boolean;
  fileName: string;
};

export const MAX_ROWS_PER_SHEET = 5000;

export function snakeCase(input: string): string {
  const base = (input ?? "")
    .toString()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
  if (!base) return "column";
  return /^[0-9]/.test(base) ? `col_${base}` : base;
}

export function slugify(input: string): string {
  return (
    (input ?? "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

function dedupe(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = seen.get(n) ?? 0;
    seen.set(n, count + 1);
    return count === 0 ? n : `${n}_${count + 1}`;
  });
}

function inferType(values: unknown[]): ParsedColumn["data_type"] {
  let num = 0;
  let bool = 0;
  let date = 0;
  let seen = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    seen++;
    if (typeof v === "number") num++;
    else if (typeof v === "boolean") bool++;
    else if (v instanceof Date) date++;
    else {
      const s = String(v).trim();
      if (/^-?\d+(\.\d+)?$/.test(s)) num++;
      else if (/^(true|false|yes|no)$/i.test(s)) bool++;
    }
  }
  if (seen === 0) return "string";
  if (date / seen > 0.6) return "date";
  if (num / seen > 0.8) return "number";
  if (bool / seen > 0.8) return "boolean";
  return "string";
}

export async function parseWorkbook(file: File, opts?: { maxRowsPerSheet?: number }): Promise<ParsedWorkbook> {
  const buf = await file.arrayBuffer();
  return parseWorkbookFromBuffer(buf, file.name, opts);
}

export function parseWorkbookFromBuffer(
  buf: ArrayBuffer,
  fileName: string,
  opts?: { maxRowsPerSheet?: number },
): ParsedWorkbook {
  const rowCap = opts?.maxRowsPerSheet ?? MAX_ROWS_PER_SHEET;
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const hasMacros =
    Boolean((wb as unknown as { vbaraw?: unknown }).vbaraw) ||
    /\.xls[mb]$/i.test(fileName);

  const sheets: ParsedSheet[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: false,
    });
    if (matrix.length === 0) {
      sheets.push({ name, headers: [], rows: [], rowCount: 0, truncated: false });
      continue;
    }
    const headerRow = matrix[0].map((h, i) =>
      h === null || h === undefined || String(h).trim() === "" ? `column_${i + 1}` : String(h),
    );
    const apiNames = dedupe(headerRow.map(snakeCase));
    const bodyRows = matrix.slice(1);
    const truncated = bodyRows.length > rowCap;
    const limited = bodyRows.slice(0, rowCap);

    const headers: ParsedColumn[] = headerRow.map((original, i) => ({
      original_name: original,
      api_name: apiNames[i],
      data_type: inferType(limited.map((r) => r?.[i])),
    }));

    const rows = limited.map((r) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        let val = r?.[i] ?? null;
        if (val instanceof Date) val = val.toISOString();
        obj[h.api_name] = val;
      });
      return obj;
    });

    sheets.push({ name, headers, rows, rowCount: limited.length, truncated });
  }

  return { sheets, hasMacros, fileName };
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "")
    .replace(/\//g, "")
    .replace(/=/g, "");
  return `gw_${b64}`;
}

export type FieldMasking = "none" | "mask" | "hash" | "encrypt";

// Heuristic PII detection. Returns a suggested masking strategy for a column
// based on its name (and a small value sample). Used to auto-flag sensitive
// fields so contributors ship secure APIs by default.
type PiiRule = { test: RegExp; masking: FieldMasking };
const PII_RULES: PiiRule[] = [
  // Strong identifiers → encrypt (reversible, protected at rest)
  { test: /\b(ssn|social_security|passport|national_id|tax_id|iban|account_number|routing|card_number|credit_card|cc_num|cvv)\b/, masking: "encrypt" },
  // Direct contact / identity → hash by default (irreversible, still joinable)
  { test: /(^|_)(email|e_mail)($|_)/, masking: "hash" },
  { test: /(phone|mobile|msisdn|contact_number)/, masking: "hash" },
  // Names & addresses → mask (partially visible)
  { test: /(first_name|last_name|full_name|surname|given_name|middle_name)/, masking: "mask" },
  { test: /(address|street|postcode|zip_code|zipcode|city|dob|date_of_birth|birth_date|gender)/, masking: "mask" },
  { test: /(^name$|_name$)/, masking: "mask" },
];

const EMAIL_VALUE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function detectPii(
  apiName: string,
  originalName: string,
  sampleValues: unknown[] = [],
): { isPii: boolean; masking: FieldMasking } {
  const haystack = `${apiName} ${originalName}`.toLowerCase();
  for (const rule of PII_RULES) {
    if (rule.test.test(haystack)) return { isPii: true, masking: rule.masking };
  }
  // Value-based fallback: looks like emails.
  const nonEmpty = sampleValues.filter((v) => v !== null && v !== undefined && v !== "").slice(0, 20);
  if (nonEmpty.length >= 3 && nonEmpty.every((v) => EMAIL_VALUE.test(String(v)))) {
    return { isPii: true, masking: "hash" };
  }
  return { isPii: false, masking: "none" };
}
