import { describe, expect, it } from "vitest";
import {
  detectIngestFormat,
  isPdfFileName,
  isSpreadsheetFileName,
  parseSpreadsheetIngest,
} from "@/lib/ingest-parse";
import { buildSheetsFromAiTables, buildTextFallbackTables } from "@/lib/pdf-parse.ai.server";

describe("ingest-parse facade", () => {
  it("detects spreadsheet and pdf extensions", () => {
    expect(detectIngestFormat("a.xlsx")).toBe("spreadsheet");
    expect(detectIngestFormat("b.CSV")).toBe("spreadsheet");
    expect(detectIngestFormat("c.pdf")).toBe("pdf");
    expect(detectIngestFormat("d.txt")).toBeNull();
    expect(isPdfFileName("report.PDF")).toBe(true);
    expect(isSpreadsheetFileName("book.xls")).toBe(true);
  });

  it("parses CSV via spreadsheet path", () => {
    const csv = "Name,Amount\nAlice,10\nBob,20\n";
    const buf = new TextEncoder().encode(csv).buffer;
    const result = parseSpreadsheetIngest(buf, "demo.csv");
    expect(result.meta.format).toBe("spreadsheet");
    expect(result.meta.parser).toBe("sheetjs");
    expect(result.workbook.sheets[0]?.headers.map((h) => h.api_name)).toEqual(["name", "amount"]);
    expect(result.workbook.sheets[0]?.rowCount).toBe(2);
  });
});

describe("AI PDF table → ParsedWorkbook", () => {
  it("builds sheets with snake_case headers and confidence", () => {
    const { sheets, sheetConf } = buildSheetsFromAiTables(
      [
        {
          name: "Sales",
          headers: ["Customer ID", "Amount"],
          rows: [
            ["c1", 12],
            ["c2", 34],
          ],
          confidence: 0.92,
          flags: [],
        },
      ],
      5000,
    );
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.name).toBe("Sales");
    expect(sheets[0]!.headers.map((h) => h.api_name)).toEqual(["customer_id", "amount"]);
    expect(sheets[0]!.rowCount).toBe(2);
    expect(sheetConf[0]!.needsReview).toBe(true);
    expect(sheetConf[0]!.confidence).toBeCloseTo(0.92);
  });

  it("flags empty headers as needing review", () => {
    const { sheets, sheetConf } = buildSheetsFromAiTables([{ name: "Empty", headers: [], rows: [] }], 100);
    expect(sheets).toHaveLength(0);
    expect(sheetConf[0]!.flags).toContain("empty_headers");
  });

  it("builds a reviewable text fallback when AI finds no tables", () => {
    const tables = buildTextFallbackTables(
      ["Revenue 100\nCost 40", "Notes line one. Notes line two."],
      "no tables",
    );
    expect(tables).toHaveLength(1);
    expect(tables[0]!.headers).toEqual(["page", "content"]);
    expect(tables[0]!.flags).toContain("text_fallback");
    expect(tables[0]!.flags).toContain("needs_human_curation");
    expect((tables[0]!.rows ?? []).length).toBeGreaterThan(0);
    const { sheets } = buildSheetsFromAiTables(tables, 5000);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.headers.map((h) => h.api_name)).toEqual(["page", "content"]);
  });
});
