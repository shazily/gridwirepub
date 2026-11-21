/**
 * Lightweight eval-style smoke checks for MCP agent workflows (mocked HTTP).
 * Fixed questions → expected tool sequence outcomes (MCP-4.5).
 */
import { describe, expect, test } from "bun:test";
import { GridwireClient } from "../src/client.ts";
import type { McpConfig } from "../src/config.ts";

const config: McpConfig = {
  baseUrl: "https://portal.example",
  apiKey: "gw_eval_key_abcdefgh",
  datasetAllowlist: null,
};

describe("MCP eval smoke (mocked)", () => {
  test("Q: what columns does FX expose? → schema fields include rate", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/schema")) {
        return new Response(
          JSON.stringify({
            dataset: "11111111-1111-1111-1111-111111111111",
            sheet: "Rates",
            slug: "rates",
            access: "secure",
            field_count: 2,
            fields: [
              { name: "currency", type: "string", protection: "none" },
              { name: "rate", type: "number", protection: "none" },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.match(/\/datasets\/[^/]+$/)) {
        return new Response(
          JSON.stringify({
            id: "11111111-1111-1111-1111-111111111111",
            name: "FX",
            mcp_enabled: true,
            access: "secure",
            status: "published",
            sheets: [{ name: "Rates", slug: "rates", field_count: 2, data_url: "", schema_url: "" }],
            version: { id: "v1" },
            updated_at: "",
            openapi: "/api/v1/datasets/11111111-1111-1111-1111-111111111111/openapi.json",
            docs: "/docs/11111111-1111-1111-1111-111111111111",
            description: null,
            slug: "fx",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    try {
      const client = new GridwireClient(config);
      const schema = await client.getSchema("11111111-1111-1111-1111-111111111111", "rates");
      expect(schema.fields.some((f) => f.name === "rate")).toBe(true);
      // Agent must not invent a "bid" column that is not in schema.
      expect(schema.fields.some((f) => f.name === "bid")).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("Q: MCP-disabled dataset is flagged for refusal", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: "11111111-1111-1111-1111-111111111111",
          name: "Secret",
          mcp_enabled: false,
          access: "public",
          status: "published",
          sheets: [],
          version: {},
          updated_at: "",
          openapi: "",
          docs: "",
          description: null,
          slug: "secret",
        }),
        { status: 200 },
      )) as typeof fetch;
    try {
      const client = new GridwireClient(config);
      const ds = await client.getDataset("11111111-1111-1111-1111-111111111111");
      expect(ds.mcp_enabled).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});
