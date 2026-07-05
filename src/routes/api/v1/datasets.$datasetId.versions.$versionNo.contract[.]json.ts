import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/api/v1/datasets/$datasetId/versions/$versionNo/contract.json",
)({
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
        const versionNo = parseInt(params.versionNo, 10);
        if (!Number.isFinite(versionNo) || versionNo < 1) {
          return mod.json({ error: "Invalid version number" }, 400);
        }

        const { data: version } = await admin
          .from("dataset_versions")
          .select("id")
          .eq("dataset_id", params.datasetId)
          .eq("version_no", versionNo)
          .maybeSingle();
        if (!version) return mod.json({ error: "Version not found" }, 404);

        const { data: contract } = await admin
          .from("dataset_contracts")
          .select("contract_body, contract_version, published_at")
          .eq("dataset_id", params.datasetId)
          .eq("version_id", version.id)
          .maybeSingle();
        if (!contract) return mod.json({ error: "No contract for this version" }, 404);

        return mod.json(
          {
            data: contract.contract_body,
            meta: {
              version_no: versionNo,
              contract_version: contract.contract_version,
              published_at: contract.published_at,
            },
          },
          200,
          auth.rateLimitHeaders,
        );
      },
    },
  },
});
