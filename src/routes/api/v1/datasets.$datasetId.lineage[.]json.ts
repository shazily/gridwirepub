import { createFileRoute } from "@tanstack/react-router";
import { fetchLineageGraph } from "@/lib/lineage.server";

export const Route = createFileRoute("/api/v1/datasets/$datasetId/lineage.json")({
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
        const { dataset } = auth;
        const graph = await fetchLineageGraph(admin, dataset.org_id, dataset.id);
        return mod.json(
          {
            data: graph,
            meta: { dataset_id: dataset.id, dataset_name: dataset.name, format: "gridwire-lineage-v1" },
          },
          200,
          auth.rateLimitHeaders,
        );
      },
    },
  },
});
