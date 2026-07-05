import { describe, expect, it } from "vitest";
import {
  buildSchemaFromParsed,
  validateAttachmentAgainstTemplate,
  findMatchingIngestTemplate,
  type TemplateSchema,
} from "@/lib/email-template-validation";
import type { ParsedWorkbook } from "@/lib/spreadsheet";

const baseWorkbook = (headers: string[], apiNames: string[]): ParsedWorkbook => ({
  fileName: "test.xlsx",
  hasMacros: false,
  sheets: [
    {
      name: "Sheet1",
      headers: headers.map((original, i) => ({
        original_name: original,
        api_name: apiNames[i] ?? original,
        data_type: "string" as const,
      })),
      rows: [],
      rowCount: 0,
      truncated: false,
    },
  ],
});

describe("validateAttachmentAgainstTemplate", () => {
  const schema: TemplateSchema = {
    sheet_name: "Sheet1",
    columns: [
      { api_name: "customer_id", original_name: "Customer ID" },
      { api_name: "amount", original_name: "Amount" },
    ],
  };

  it("accepts attachment with matching columns", () => {
    const parsed = baseWorkbook(["Customer ID", "Amount"], ["customer_id", "amount"]);
    const result = validateAttachmentAgainstTemplate(parsed, schema);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sheetName).toBe("Sheet1");
  });

  it("rejects missing columns", () => {
    const parsed = baseWorkbook(["Customer ID"], ["customer_id"]);
    const result = validateAttachmentAgainstTemplate(parsed, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("amount");
    }
  });

  it("rejects extra columns", () => {
    const parsed = baseWorkbook(["Customer ID", "Amount", "Extra"], ["customer_id", "amount", "extra"]);
    const result = validateAttachmentAgainstTemplate(parsed, schema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.extra).toContain("extra");
    }
  });

  it("rejects empty template schema", () => {
    const parsed = baseWorkbook(["A"], ["a"]);
    const result = validateAttachmentAgainstTemplate(parsed, { columns: [] });
    expect(result.ok).toBe(false);
  });

  it("builds schema from parsed workbook", () => {
    const parsed = baseWorkbook(["Foo Bar"], ["foo_bar"]);
    const built = buildSchemaFromParsed(parsed, 0, "template.xlsx");
    expect(built.columns).toHaveLength(1);
    expect(built.columns[0]?.api_name).toBe("foo_bar");
    expect(built.template_file_name).toBe("template.xlsx");
  });
});

describe("findMatchingIngestTemplate", () => {
  const templates = [
    { id: "1", name: "Monthly", subject_pattern: "gridwiretest", attachment_pattern: "*.xlsx" },
    { id: "2", name: "Any subject", subject_pattern: null, attachment_pattern: "*.csv" },
  ];

  it("matches when subject and attachment fit", () => {
    const { template } = findMatchingIngestTemplate(templates, "gridwiretest report", ["data.xlsx"]);
    expect(template?.name).toBe("Monthly");
  });

  it("rejects when subject does not contain required text", () => {
    const { template, rejectionDetail } = findMatchingIngestTemplate(templates, "Test ingest", [
      "MASKED_synthetic_data.xlsx",
    ]);
    expect(template).toBeNull();
    expect(rejectionDetail).toContain("gridwiretest");
    expect(rejectionDetail).toContain("Test ingest");
  });

  it("matches csv template without subject rule", () => {
    const { template } = findMatchingIngestTemplate(templates, "anything", ["report.csv"]);
    expect(template?.name).toBe("Any subject");
  });
});
