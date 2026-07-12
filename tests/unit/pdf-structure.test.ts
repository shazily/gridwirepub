import { describe, expect, it } from "vitest";
import {
  fileNameMatchesPdfPattern,
  includedStructureTables,
  normalizeStructureSnapshot,
  PDF_STRUCTURE_SAMPLE_ROWS,
  workbookFromStructure,
} from "@/lib/pdf-structure";

describe("pdf-structure", () => {
  it("normalizes headers and caps sample rows", () => {
    const snap = normalizeStructureSnapshot({
      page_count: 4,
      tables: [
        {
          name: "Sales",
          headers: ["Customer ID", "Amount"],
          sample_rows: [
            ["a", 1],
            ["b", 2],
            ["c", 3],
            ["d", 4],
            ["e", 5],
          ],
        },
      ],
    });
    expect(snap.tables).toHaveLength(1);
    expect(snap.tables[0]!.headers.map((h) => h.api_name)).toEqual(["customer_id", "amount"]);
    expect(snap.tables[0]!.sample_rows).toHaveLength(PDF_STRUCTURE_SAMPLE_ROWS);
    expect(includedStructureTables(snap)).toHaveLength(1);
  });

  it("builds preview workbook from included tables only", () => {
    const snap = normalizeStructureSnapshot({
      page_count: 1,
      tables: [
        {
          name: "Keep",
          included: true,
          headers: [{ original_name: "A", api_name: "a", included: true }],
          sample_rows: [["x"]],
        },
        {
          name: "Skip",
          included: false,
          headers: [{ original_name: "B", api_name: "b", included: true }],
          sample_rows: [["y"]],
        },
      ],
    });
    const wb = workbookFromStructure(snap, "demo.pdf");
    expect(wb.sheets.map((s) => s.name)).toEqual(["Keep"]);
    expect(wb.sheets[0]!.rowCount).toBe(1);
  });

  it("matches PDF file name patterns", () => {
    expect(fileNameMatchesPdfPattern("report.pdf", "*.pdf")).toBe(true);
    expect(fileNameMatchesPdfPattern("monthly_kpi.pdf", "*kpi*.pdf")).toBe(true);
    expect(fileNameMatchesPdfPattern("notes.txt", "*.pdf")).toBe(false);
  });
});
