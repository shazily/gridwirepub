import { createFileRoute } from "@tanstack/react-router";

// GET /api/v1/datasets/:datasetId/:sheet/schema
// Returns the field schema (name, type, protection) for a sheet. No row data.
export const Route = createFileRoute("/api/v1/datasets/$datasetId/$sheet/schema")({
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
        const versionId = auth.dataset.current_version_id!;

        const { all, sheets } = await mod.loadSheetFields(admin, versionId);
        const matchedSheet = sheets.find((s) => mod.slugify(s) === params.sheet || s === params.sheet);
        if (!matchedSheet)
          return mod.json({ error: "Sheet not found", available: sheets.map(mod.slugify) }, 404);

        const fields = all
          .filter((f) => f.sheet_name === matchedSheet && f.included)
          .map((f) => ({
            name: f.api_name,
            type: f.data_type ?? "string",
            nullable: f.nullable ?? true,
            pii: f.is_pii ?? false,
            protection: f.masking, // none | mask | hash | encrypt
            source_column: f.original_name ?? f.api_name,
          }));

        return mod.json({
          dataset: auth.dataset.id,
          sheet: matchedSheet,
          slug: mod.slugify(matchedSheet),
          access: auth.dataset.api_access,
          field_count: fields.length,
          fields,
        }, 200, auth.rateLimitHeaders);
      },
    },
  },
});
