import { createFileRoute } from "@tanstack/react-router";

// GET /api/v1/datasets/:datasetId
// Returns dataset metadata, available sheets and their endpoints. Doubles as a
// lightweight poll endpoint (version + updated_at + ETag) so consumers can
// detect when the dataset has changed without downloading rows.
export const Route = createFileRoute("/api/v1/datasets/$datasetId")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/api-serve.server");
        return preflight();
      },
      HEAD: async ({ request, params }) => {
        const mod = await import("@/lib/api-serve.server");
        const admin = await mod.getAdmin();
        const auth = await mod.authorizeDataset(admin, request, params.datasetId);
        if (!auth.ok) return new Response(null, { status: auth.response.status, headers: mod.CORS_HEADERS });
        return new Response(null, {
          status: 200,
          headers: {
            ...mod.CORS_HEADERS,
            "X-Dataset-Version": auth.dataset.current_version_id ?? "",
            "Last-Modified": new Date(auth.dataset.updated_at).toUTCString(),
          },
        });
      },
      GET: async ({ request, params }) => {
        const mod = await import("@/lib/api-serve.server");
        const admin = await mod.getAdmin();
        const auth = await mod.authorizeDataset(admin, request, params.datasetId);
        if (!auth.ok) return auth.response;
        const { dataset } = auth;
        const versionId = dataset.current_version_id!;

        const { all, sheets } = await mod.loadSheetFields(admin, versionId);
        const { data: version } = await admin
          .from("dataset_versions")
          .select("version_no, row_count, sheet_count, created_at, load_mode")
          .eq("id", versionId)
          .maybeSingle();

        const base = `/api/v1/datasets/${dataset.id}`;
        const etag = `"${versionId.slice(0, 8)}-${version?.version_no ?? 0}"`;
        if (request.headers.get("if-none-match") === etag) {
          return new Response(null, { status: 304, headers: { ...mod.CORS_HEADERS, ETag: etag } });
        }

        const body = {
          id: dataset.id,
          name: dataset.name,
          description: dataset.description,
          slug: dataset.slug,
          access: dataset.api_access,
          status: dataset.status,
          ownership: {
            uploaded_by: (dataset as { uploaded_by?: string | null }).uploaded_by ?? null,
            published_by: (dataset as { published_by?: string | null }).published_by ?? null,
            data_steward_id: (dataset as { data_steward_id?: string | null }).data_steward_id ?? null,
          },
          version: { id: versionId, ...(version ?? {}) },
          updated_at: dataset.updated_at,
          openapi: `${base}/openapi.json`,
          contract: `${base}/contract.json`,
          contract_yaml: `${base}/contract.yaml`,
          lineage: `${base}/lineage.json`,
          docs: `/docs/${dataset.id}`,
          sheets: sheets.map((s) => {
            const fs = all.filter((f) => f.sheet_name === s && f.included);
            return {
              name: s,
              slug: mod.slugify(s),
              field_count: fs.length,
              data_url: `${base}/${mod.slugify(s)}`,
              schema_url: `${base}/${mod.slugify(s)}/schema`,
              export_url: `${base}/${mod.slugify(s)}/export?format=parquet`,
            };
          }),
        };

        return mod.json(body, 200, {
          ETag: etag,
          "X-Dataset-Version": versionId,
          "Last-Modified": new Date(dataset.updated_at).toUTCString(),
          ...auth.rateLimitHeaders,
        });
      },
    },
  },
});
