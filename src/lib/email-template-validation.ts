import type { ParsedWorkbook } from "@/lib/spreadsheet";

export type TemplateColumn = {
  api_name: string;
  original_name?: string;
  data_type?: string;
};

export type TemplateSchema = {
  sheet_name?: string | null;
  columns: TemplateColumn[];
  template_file_name?: string | null;
};

export type TemplateValidationResult =
  | { ok: true; sheetName: string }
  | { ok: false; reason: string; missing?: string[]; extra?: string[] };

/** Strict column-set match: attachment must have exactly the template api_name columns. */
export function validateAttachmentAgainstTemplate(
  parsed: ParsedWorkbook,
  schema: TemplateSchema,
): TemplateValidationResult {
  if (!schema.columns?.length) {
    return { ok: false, reason: "Template has no column schema — upload an Excel or CSV template first." };
  }

  const expectedNames = schema.columns.map((c) => c.api_name);
  const expectedSet = new Set(expectedNames);

  let sheet = parsed.sheets[0];
  if (schema.sheet_name) {
    const named = parsed.sheets.find(
      (s) => s.name.toLowerCase() === schema.sheet_name!.toLowerCase(),
    );
    if (!named) {
      return {
        ok: false,
        reason: `Expected sheet "${schema.sheet_name}" not found in attachment`,
      };
    }
    sheet = named;
  }

  if (!sheet || sheet.headers.length === 0) {
    return { ok: false, reason: "Attachment has no readable header row" };
  }

  const actualNames = sheet.headers.map((h) => h.api_name);
  const actualSet = new Set(actualNames);

  const missing = expectedNames.filter((n) => !actualSet.has(n));
  const extra = actualNames.filter((n) => !expectedSet.has(n));

  if (missing.length > 0 || extra.length > 0) {
    return {
      ok: false,
      reason: "Attachment columns do not match the uploaded template",
      missing: missing.length ? missing : undefined,
      extra: extra.length ? extra : undefined,
    };
  }

  return { ok: true, sheetName: sheet.name };
}

const SPREADSHEET_EXT = [".xlsx", ".xls", ".csv"];

export function attachmentPatternForFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "*.csv";
  if (lower.endsWith(".xls")) return "*.xls";
  if (lower.endsWith(".xlsx")) return "*.xlsx";
  return "*";
}

export function attachmentMatchesPattern(fileName: string, pattern: string | null | undefined): boolean {
  const lower = fileName.toLowerCase();
  if (!SPREADSHEET_EXT.some((ext) => lower.endsWith(ext))) return false;
  const p = pattern?.trim();
  if (!p || p === "*" || p === "*.*") return true;
  if (p.startsWith("*.")) return lower.endsWith(p.slice(1).toLowerCase());
  return lower.includes(p.toLowerCase());
}

export function subjectMatchesPattern(subject: string, pattern: string | null | undefined): boolean {
  const p = pattern?.trim();
  if (!p) return true;
  return subject.toLowerCase().includes(p.toLowerCase());
}

export type IngestTemplateLike = {
  id: string;
  name: string;
  subject_pattern?: string | null;
  attachment_pattern?: string | null;
};

export function explainTemplateMismatch(
  template: IngestTemplateLike,
  subject: string,
  attachmentNames: string[],
): string | null {
  if (!subjectMatchesPattern(subject, template.subject_pattern)) {
    return `subject must contain "${template.subject_pattern}"`;
  }
  const pattern = template.attachment_pattern ?? "*.xlsx";
  if (!attachmentNames.some((name) => attachmentMatchesPattern(name, pattern))) {
    return `attachment must match "${pattern}"`;
  }
  return null;
}

export function findMatchingIngestTemplate<T extends IngestTemplateLike>(
  templates: T[],
  subject: string,
  attachmentNames: string[],
): { template: T | null; rejectionDetail: string } {
  if (templates.length === 0) {
    return { template: null, rejectionDetail: "No active templates — upload a column template first." };
  }

  const matched = templates.find((t) => !explainTemplateMismatch(t, subject, attachmentNames));
  if (matched) return { template: matched, rejectionDetail: "" };

  const hints = templates.map((t) => {
    const why = explainTemplateMismatch(t, subject, attachmentNames);
    return `"${t.name}" (${why ?? "unknown"})`;
  });
  return {
    template: null,
    rejectionDetail: `No template matched subject "${subject}" and attachments [${attachmentNames.join(", ")}]. Check: ${hints.join("; ")}`,
  };
}

export function buildSchemaFromParsed(
  parsed: ParsedWorkbook,
  sheetIndex = 0,
  templateFileName?: string,
): TemplateSchema {
  const sheet = parsed.sheets[sheetIndex] ?? parsed.sheets[0];
  return {
    sheet_name: sheet?.name ?? null,
    template_file_name: templateFileName ?? parsed.fileName,
    columns: (sheet?.headers ?? []).map((h) => ({
      api_name: h.api_name,
      original_name: h.original_name,
      data_type: h.data_type,
    })),
  };
}
