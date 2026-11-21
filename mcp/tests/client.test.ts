import { describe, expect, test } from "bun:test";
import { GridwireClient, resolveSheetSlug } from "../src/client.ts";
import { GridwireApiError } from "../src/errors.ts";
import { formatToolError } from "../src/errors.ts";
import type { McpConfig } from "../src/config.ts";

const config: McpConfig = {
  baseUrl: "https://portal.example",
  apiKey: "gw_test_key_abcdefgh",
  datasetAllowlist: null,
};

describe("GridwireClient", () => {
  test("listDatasets calls discovery endpoint with Bearer", async () => {
    const original = globalThis.fetch;
    let seenAuth = "";
    let seenUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input);
      seenAuth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      return new Response(
        JSON.stringify({
          count: 1,
          data: [
            {
              id: "11111111-1111-1111-1111-111111111111",
              name: "FX",
              slug: "fx",
              access: "secure",
              sheets: [{ name: "Rates", slug: "rates" }],
              version: { id: "v1", version_no: 1, row_count: 10 },
              openapi: "https://portal.example/api/v1/datasets/11111111-1111-1111-1111-111111111111/openapi.json",
              docs: "https://portal.example/docs/11111111-1111-1111-1111-111111111111",
              description: null,
              status: "published",
              updated_at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const client = new GridwireClient(config);
      const rows = await client.listDatasets();
      expect(seenUrl).toBe("https://portal.example/api/v1/datasets");
      expect(seenAuth).toBe("Bearer gw_test_key_abcdefgh");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe("FX");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("maps 401 to GridwireApiError", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Invalid API key" }), { status: 401 })) as typeof fetch;
    try {
      const client = new GridwireClient(config);
      await expect(client.listDatasets()).rejects.toBeInstanceOf(GridwireApiError);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("respects dataset allowlist", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "11111111-1111-1111-1111-111111111111", name: "A", sheets: [], version: {}, access: "public", slug: "a", description: null, status: "published", updated_at: "", openapi: "", docs: "" },
            { id: "22222222-2222-2222-2222-222222222222", name: "B", sheets: [], version: {}, access: "public", slug: "b", description: null, status: "published", updated_at: "", openapi: "", docs: "" },
          ],
        }),
        { status: 200 },
      )) as typeof fetch;
    try {
      const client = new GridwireClient({
        ...config,
        datasetAllowlist: new Set(["22222222-2222-2222-2222-222222222222"]),
      });
      const rows = await client.listDatasets();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe("22222222-2222-2222-2222-222222222222");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("query_rows enforces path and query", async () => {
    const original = globalThis.fetch;
    let seen = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen = String(input);
      return new Response(
        JSON.stringify({
          dataset: "11111111-1111-1111-1111-111111111111",
          sheet: "Rates",
          version: "v1",
          total: 1,
          count: 1,
          limit: 10,
          offset: 0,
          data: [{ rate: 1.1 }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const client = new GridwireClient(config);
      await client.queryRows("11111111-1111-1111-1111-111111111111", "rates", {
        limit: 10,
        offset: 0,
        filters: { currency: "USD" },
      });
      expect(seen).toContain("/api/v1/datasets/11111111-1111-1111-1111-111111111111/rates?");
      expect(seen).toContain("limit=10");
      expect(seen).toContain("currency=USD");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("resolveSheetSlug", () => {
  test("matches name or slug", () => {
    const ds = {
      sheets: [
        { name: "Sheet 1", slug: "sheet-1" },
        { name: "Rates", slug: "rates" },
      ],
    } as Parameters<typeof resolveSheetSlug>[0];
    expect(resolveSheetSlug(ds, "Rates")).toBe("rates");
    expect(resolveSheetSlug(ds, "sheet-1")).toBe("sheet-1");
  });
});

describe("formatToolError", () => {
  test("formats auth errors clearly", () => {
    const msg = formatToolError(new GridwireApiError(401, "Invalid API key"));
    expect(msg).toContain("GRIDWIRE_API_KEY");
    expect(msg).not.toContain("at Object");
  });
});
