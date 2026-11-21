import { describe, expect, test } from "vitest";

import { probeDatasetEndpoints } from "../../src/lib/api-endpoint-probe.server";

describe("probeDatasetEndpoints URL building", () => {
  test("builds absolute URLs under the given origin", async () => {
    const fetchCalls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    try {
      const results = await probeDatasetEndpoints({
        origin: "https://portal.example",
        datasetId: "11111111-1111-1111-1111-111111111111",
        sheetName: "Sheet 1",
        secure: false,
        kinds: ["rows", "openapi"],
      });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.outcome === "healthy")).toBe(true);
      expect(fetchCalls[0]).toContain("/api/v1/datasets/11111111-1111-1111-1111-111111111111/sheet-1?limit=1");
      expect(fetchCalls[1]).toContain("/openapi.json");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("classifies 401 on secure datasets as auth_required", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Missing API key" }), { status: 401 })) as typeof fetch;

    try {
      const [result] = await probeDatasetEndpoints({
        origin: "https://portal.example",
        datasetId: "11111111-1111-1111-1111-111111111111",
        sheetName: "Data",
        secure: true,
        kinds: ["schema"],
      });
      expect(result.outcome).toBe("auth_required");
      expect(result.http_status).toBe(401);
    } finally {
      globalThis.fetch = original;
    }
  });
});
