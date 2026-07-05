import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
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

const schema = z.object({
  connector_id: z.string().uuid(),
  run_id: z.string().uuid().optional(),
  kind: z.enum(["poll", "test"]).default("poll"),
  status: z.enum(["running", "success", "error"]),
  message: z.string().max(2000).optional(),
  files_found: z.number().int().min(0).default(0),
  files_ingested: z.number().int().min(0).default(0),
  retry_count: z.number().int().min(0).optional(),
  dead_letter: z.boolean().optional(),
});

/**
 * Companion worker reports the outcome of a poll or test back to the portal.
 * Updates the connector's last run status and records a connector_runs row.
 */
export const Route = createFileRoute("/api/public/worker/report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorize(request)) return json({ error: "Unauthorized" }, 401);
        const parsed = schema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return json({ error: "Invalid payload", details: parsed.error.flatten() }, 400);
        const body = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: connector } = await supabaseAdmin
          .from("connectors")
          .select("id, org_id")
          .eq("id", body.connector_id)
          .maybeSingle();
        if (!connector) return json({ error: "Connector not found" }, 404);

        const now = new Date().toISOString();
        const finished = body.status !== "running";

        const runPatch = {
          status: body.status,
          message: body.message ?? null,
          files_found: body.files_found,
          files_ingested: body.files_ingested,
          started_at: now,
          finished_at: finished ? now : null,
          ...(body.retry_count !== undefined ? { retry_count: body.retry_count } : {}),
          ...(body.dead_letter ? { dead_letter_at: now } : {}),
        };

        if (body.run_id) {
          await supabaseAdmin.from("connector_runs").update(runPatch).eq("id", body.run_id);
        } else {
          await supabaseAdmin.from("connector_runs").insert({
            org_id: connector.org_id,
            connector_id: connector.id,
            kind: body.kind,
            ...runPatch,
          });
        }

        if (finished) {
          const patch: { last_run_at: string; last_status: string; last_test_at?: string } = {
            last_run_at: now,
            last_status: body.status,
          };
          if (body.kind === "test") patch.last_test_at = now;
          await supabaseAdmin.from("connectors").update(patch).eq("id", connector.id);

          if (body.status === "error") {
            await supabaseAdmin.from("alert_events").insert({
              org_id: connector.org_id,
              event_type: "connector_error",
              severity: "error",
              title: `Connector run failed`,
              body: body.message ?? "The companion worker reported a failure.",
              audience: "admins",
            });
            const { dispatchPendingAlertEmails } = await import("@/lib/worker-ingest.server");
            await dispatchPendingAlertEmails(connector.org_id);
          }
        }

        return json({ ok: true });
      },
    },
  },
});
