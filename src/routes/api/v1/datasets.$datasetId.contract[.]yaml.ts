import { createFileRoute } from "@tanstack/react-router";
import { contractToYaml } from "@/lib/contract.server";
import type { OdcsContract } from "@/lib/contract.server";

export const Route = createFileRoute("/api/v1/datasets/$datasetId/contract.yaml")({
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
          .select("contract_body")
          .eq("dataset_id", params.datasetId)
          .eq("is_active", true)
          .maybeSingle();
        if (!contract) return new Response("No active data contract", { status: 404 });
        const yaml = contractToYaml(contract.contract_body as OdcsContract);
        return new Response(yaml, {
          status: 200,
          headers: {
            "Content-Type": "text/yaml; charset=utf-8",
            ...mod.CORS_HEADERS,
            ...auth.rateLimitHeaders,
          },
        });
      },
    },
  },
});
