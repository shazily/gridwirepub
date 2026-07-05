import { createFileRoute } from "@tanstack/react-router";
import { stripConnectorConfigForWorker } from "@/lib/connector-config";
import { safeTokenEqual } from "@/lib/token-compare.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function authorize(request: Request): boolean {
  const token = request.headers.get("x-worker-token") ?? "";
  const expected = process.env.WORKER_INGEST_TOKEN ?? "";
  return Boolean(expected) && safeTokenEqual(token, expected);
}

/**
 * Companion worker polls this endpoint to discover which connectors to fetch
 * from, plus any queued "test" requests it should execute. Credentials are
 * never returned here — the worker holds those in its own environment.
 */
export const Route = createFileRoute("/api/public/worker/connectors")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorize(request)) return json({ error: "Unauthorized" }, 401);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: connectors, error } = await supabaseAdmin
          .from("connectors")
          .select("id, org_id, name, type, config, schedule, enabled, dataset_id");
        if (error) return json({ error: error.message }, 500);

        const { data: queuedTests } = await supabaseAdmin
          .from("connector_runs")
          .select("id, connector_id")
          .eq("kind", "test")
          .eq("status", "queued");

        const testByConnector = new Map<string, string>();
        for (const t of queuedTests ?? []) testByConnector.set(t.connector_id, t.id);

        return json({
          connectors: (connectors ?? []).map((c) => ({
            id: c.id,
            org_id: c.org_id,
            name: c.name,
            type: c.type,
            config: stripConnectorConfigForWorker((c.config ?? {}) as Record<string, unknown>),
            schedule: c.schedule,
            enabled: c.enabled,
            dataset_id: c.dataset_id,
            queued_test_run_id: testByConnector.get(c.id) ?? null,
          })),
        });
      },
    },
  },
});
