import { describe, expect, it } from "vitest";
import { rowsToCsv } from "@/lib/csv-export.server";
import type { ServeField } from "@/lib/api-serve.server";

const fields: ServeField[] = [
  { api_name: "id", sheet_name: "S", masking: "none", included: true },
  { api_name: "note", sheet_name: "S", masking: "none", included: true },
];

describe("csv export", () => {
  it("emits header and escaped cells", () => {
    const csv = rowsToCsv([{ id: 1, note: 'hello, "world"' }], fields);
    expect(csv.startsWith("id,note\n")).toBe(true);
    expect(csv).toContain('"hello, ""world"""');
  });
});
