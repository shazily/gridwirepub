import { describe, expect, it } from "vitest";
import {
  extractRowsFromTextWithHeaders,
  isSampleOnlyRowCount,
  splitPdfTextIntoLines,
} from "@/lib/pdf-extract-rows";

describe("pdf-extract-rows", () => {
  it("splits date-prefixed bank lines from a single page blob", () => {
    const page =
      "Date Description Amount Balance 01/02/2024 GROCERY STORE -45.20 1200.00 01/03/2024 PAYROLL 2500.00 3700.00 01/04/2024 ATM -100.00 3600.00";
    const lines = splitPdfTextIntoLines([page]);
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it("extracts more than sample rows for a bank-style statement", () => {
    const pages = [
      [
        "Date Description Amount Balance",
        "01/02/2024 GROCERY STORE -45.20 1200.00",
        "01/03/2024 PAYROLL DEPOSIT 2500.00 3700.00",
        "01/04/2024 ATM WITHDRAWAL -100.00 3600.00",
        "01/05/2024 COFFEE SHOP -6.50 3593.50",
        "01/06/2024 ONLINE TRANSFER -200.00 3393.50",
      ].join("\n"),
    ];
    const rows = extractRowsFromTextWithHeaders(
      pages,
      ["Date", "Description", "Amount", "Balance"],
      5000,
    );
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows[0]![0]).toMatch(/01\/02\/2024/);
    expect(isSampleOnlyRowCount(rows.length)).toBe(false);
  });

  it("handles ISO YYYY-MM-DD dates and $ amounts", () => {
    const pages = [
      [
        "Date Description Amount Balance",
        "2024-03-01 ACME SUPPLIES -$128.40 $4,871.60",
        "2024-03-02 DIRECT DEPOSIT $3,200.00 $8,071.60",
        "2024-03-03 UTILITY BILL -$89.12 $7,982.48",
        "2024-03-04 WIRE FEE -$15.00 $7,967.48",
        "2024-03-05 INTEREST CREDIT $2.11 $7,969.59",
      ].join("\n"),
    ];
    const rows = extractRowsFromTextWithHeaders(
      pages,
      ["Date", "Description", "Amount", "Balance"],
      5000,
    );
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(String(rows[0]![0])).toMatch(/2024-03-01/);
    expect(String(rows[1]![2])).toMatch(/3200/);
  });

  it("handles European-style dates with parenthetical negatives", () => {
    const pages = [
      [
        "Date Description Amount Balance",
        "01.07.2024 REWE MARKET (45.20) 1200.00",
        "02.07.2024 GEHALT 2500.00 3700.00",
        "03.07.2024 MIETE (950.00) 2750.00",
        "04.07.2024 TANKSTELLE (68.40) 2681.60",
        "05.07.2024 UEBERWEISUNG (200.00) 2481.60",
      ].join("\n"),
    ];
    const rows = extractRowsFromTextWithHeaders(
      pages,
      ["Date", "Description", "Amount", "Balance"],
      5000,
    );
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(String(rows[0]![2])).toMatch(/-?45/);
  });

  it("handles month-name dates across two pages", () => {
    const pages = [
      ["Date Description Amount", "Jan 2, 2024 OFFICE SUPPLY -32.10", "Jan 3, 2024 CLIENT PAYMENT 900.00"].join(
        "\n",
      ),
      ["Jan 4, 2024 SOFTWARE SUB -49.00", "Jan 5, 2024 REFUND 12.00", "Jan 6, 2024 PARKING -8.50"].join("\n"),
    ];
    const rows = extractRowsFromTextWithHeaders(pages, ["Date", "Description", "Amount"], 5000);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(isSampleOnlyRowCount(rows.length)).toBe(false);
  });

  it("flags sample-sized counts", () => {
    expect(isSampleOnlyRowCount(3)).toBe(true);
    expect(isSampleOnlyRowCount(10)).toBe(false);
  });
});
