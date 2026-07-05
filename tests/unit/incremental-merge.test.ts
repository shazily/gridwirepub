import { describe, expect, it } from "vitest";
import { mergeRowsByKey, indexMergedRows } from "@/lib/incremental-merge";

describe("incremental merge", () => {
  it("updates rows with matching key and preserves others", () => {
    const prev = [
      { sheet_name: "Sheet1", data: { id: "1", name: "Alice" } },
      { sheet_name: "Sheet1", data: { id: "2", name: "Bob" } },
    ];
    const next = [{ sheet_name: "Sheet1", data: { id: "1", name: "Alicia" } }];
    const keys = [{ sheet_name: "Sheet1", api_name: "id" }];
    const merged = mergeRowsByKey(prev, next, keys);
    expect(merged).toHaveLength(2);
    const byId = Object.fromEntries(
      merged.map((r) => [String(r.data.id), r.data.name]),
    );
    expect(byId["1"]).toBe("Alicia");
    expect(byId["2"]).toBe("Bob");
  });

  it("reindexes merged rows per sheet", () => {
    const rows = [
      { sheet_name: "A", data: { id: "1" } },
      { sheet_name: "B", data: { id: "x" } },
      { sheet_name: "A", data: { id: "2" } },
    ];
    const indexed = indexMergedRows(rows);
    expect(indexed.map((r) => r.row_index)).toEqual([0, 0, 1]);
  });
});
