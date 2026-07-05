import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/datasets/$datasetId/contract.json")({
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
        const { data: contract } = await admin
          .from("dataset_contracts")
          .select("contract_body, contract_version, published_at")
          .eq("dataset_id", params.datasetId)
          .eq("is_active", true)
          .maybeSingle();
        if (!contract) return mod.json({ error: "No active data contract" }, 404);
        return mod.json(
          {
            data: contract.contract_body,
            meta: { contract_version: contract.contract_version, published_at: contract.published_at },
          },
          200,
          auth.rateLimitHeaders,
        );
      },
    },
  },
});
