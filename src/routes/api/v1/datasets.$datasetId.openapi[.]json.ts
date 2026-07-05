import { createFileRoute } from "@tanstack/react-router";

// GET /api/v1/datasets/:datasetId/openapi.json
// Auto-generated OpenAPI 3.0 spec for a published dataset. Public datasets
// expose the spec without a key; secure datasets require an org-scoped API key.
export const Route = createFileRoute("/api/v1/datasets/$datasetId/openapi.json")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/api-serve.server");
        return preflight();
      },
      GET: async ({ request, params }) => {
        const mod = await import("@/lib/api-serve.server");
        const admin = await mod.getAdmin();
        const auth = await mod.authorizeDataset(admin, request, params.datasetId);
        if (!auth.ok) return auth.response;
        const ds = auth.dataset;

        const { all, sheets } = await mod.loadSheetFields(admin, ds.current_version_id!);
        const origin = mod.resolvePublicOrigin(request);
        const secure = ds.api_access === "secure";

        const typeMap = (t?: string) =>
          t === "number" ? { type: "number" } : t === "boolean" ? { type: "boolean" } : { type: "string" };

        const schemas: Record<string, unknown> = {};
        const paths: Record<string, unknown> = {};

        for (const s of sheets) {
          const slug = mod.slugify(s);
          const fs = all.filter((f) => f.sheet_name === s && f.included);
          const props: Record<string, unknown> = {};
          for (const f of fs) {
            props[f.api_name] = {
              ...(f.masking === "none" ? typeMap(f.data_type) : { type: "string" }),
              nullable: f.nullable ?? true,
              ...(f.masking !== "none" ? { description: `Protected: ${f.masking}` } : {}),
            };
          }
          const schemaName = `${slug.replace(/-/g, "_")}_row`;
          schemas[schemaName] = { type: "object", properties: props };

          paths[`/api/v1/datasets/${ds.id}/${slug}`] = {
            get: {
              summary: `List rows from "${s}"`,
              tags: [s],
              parameters: [
                { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 1000 } },
                { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
                { name: "fields", in: "query", schema: { type: "string" }, description: "Comma-separated field names" },
              ],
              ...(secure ? { security: [{ bearerAuth: [] }] } : {}),
              responses: {
                "200": {
                  description: "Rows",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          total: { type: "integer" },
                          count: { type: "integer" },
                          limit: { type: "integer" },
                          offset: { type: "integer" },
                          data: { type: "array", items: { $ref: `#/components/schemas/${schemaName}` } },
                        },
                      },
                    },
                  },
                },
                ...(secure ? { "401": { description: "Missing or invalid API key" } } : {}),
              },
            },
          };
          paths[`/api/v1/datasets/${ds.id}/${slug}/schema`] = {
            get: {
              summary: `Field schema for "${s}"`,
              tags: [s],
              ...(secure ? { security: [{ bearerAuth: [] }] } : {}),
              responses: { "200": { description: "Schema" } },
            },
          };
          paths[`/api/v1/datasets/${ds.id}/${slug}/export`] = {
            get: {
              summary: `Export "${s}" as Parquet`,
              tags: [s],
              parameters: [
                {
                  name: "format",
                  in: "query",
                  required: true,
                  schema: { type: "string", enum: ["parquet"] },
                },
              ],
              ...(secure ? { security: [{ bearerAuth: [] }] } : {}),
              responses: {
                "200": {
                  description: "Parquet file",
                  content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
                },
              },
            },
          };
        }

        paths[`/api/v1/datasets/${ds.id}`] = {
          get: {
            summary: "Dataset metadata & sheet index (poll endpoint)",
            tags: ["dataset"],
            ...(secure ? { security: [{ bearerAuth: [] }] } : {}),
            responses: { "200": { description: "Metadata" }, "304": { description: "Not modified" } },
          },
        };

        const spec = {
          openapi: "3.1.0",
          info: {
            title: `${ds.name} API`,
            description: ds.description ?? `Auto-generated API for the "${ds.name}" dataset.`,
            version: "1.0.0",
            "x-data-contract-url": `${origin}/api/v1/datasets/${ds.id}/contract.json`,
          },
          servers: [{ url: origin }],
          ...(secure
            ? {
                components: {
                  securitySchemes: {
                    bearerAuth: { type: "http", scheme: "bearer", description: "Use your Gridwire API key" },
                  },
                  schemas,
                },
                security: [{ bearerAuth: [] }],
              }
            : { components: { schemas } }),
          paths,
        };

        return mod.json(spec, 200, auth.rateLimitHeaders);
      },
    },
  },
});
