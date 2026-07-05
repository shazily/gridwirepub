import { describe, expect, it } from "vitest";
import { rowsToParquetBuffer } from "@/lib/parquet-export.server";
import type { ServeField } from "@/lib/api-serve.server";

const fields: ServeField[] = [
  { api_name: "id", sheet_name: "S", masking: "none", included: true, data_type: "number" },
  { api_name: "name", sheet_name: "S", masking: "none", included: true, data_type: "text" },
];

describe("parquet export", () => {
  it("returns valid Parquet magic bytes", async () => {
    const buf = await rowsToParquetBuffer(
      [
        { id: 1, name: "alpha" },
        { id: 2, name: "beta" },
      ],
      fields,
    );
    const magic = new TextDecoder().decode(buf.slice(0, 4));
    expect(magic).toBe("PAR1");
    const tail = new TextDecoder().decode(buf.slice(-4));
    expect(tail).toBe("PAR1");
  });
});
