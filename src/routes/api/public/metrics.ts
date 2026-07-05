import { createFileRoute } from "@tanstack/react-router";

// GET /api/public/metrics — Prometheus-compatible metrics for the portal.
//
// Exposes process health plus application gauges (datasets, active API keys,
// API reads, auth failures, open alerts, connector job outcomes). Designed to
// be scraped by Prometheus and visualized with the bundled Grafana dashboard
// (deploy/grafana/gridwire-dashboard.json).
//
// Auth: METRICS_TOKEN is required. Send it as a Bearer token
// (Authorization: Bearer <token>) or `?token=<token>`.
//
// Time-windowed counters use a 24h lookback and are exported as gauges with a
// `_24h` suffix (serverless instances do not keep cumulative process counters).

// Process start time — best-effort per-instance uptime.
const PROCESS_STARTED_AT = Date.now();

type Sample = {
  name: string;
  help: string;
  type: "gauge" | "counter";
  value: number;
  labels?: Record<string, string>;
};

function renderPrometheus(samples: Sample[]): string {
  const byName = new Map<string, Sample[]>();
  for (const s of samples) {
    const arr = byName.get(s.name) ?? [];
    arr.push(s);
    byName.set(s.name, arr);
  }
  const lines: string[] = [];
  for (const [name, group] of byName) {
    lines.push(`# HELP ${name} ${group[0].help}`);
    lines.push(`# TYPE ${name} ${group[0].type}`);
    for (const s of group) {
      const labels = s.labels
        ? "{" +
          Object.entries(s.labels)
            .map(([k, v]) => `${k}="${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
            .join(",") +
          "}"
        : "";
      lines.push(`${name}${labels} ${s.value}`);
    }
  }
  return lines.join("\n") + "\n";
}

import { validateMetricsToken } from "@/lib/metrics-auth.server";

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

export const Route = createFileRoute("/api/public/metrics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!validateMetricsToken(request, process.env.METRICS_TOKEN)) return unauthorized();

        const samples: Sample[] = [
          { name: "gridwire_portal_up", help: "Portal process is serving requests.", type: "gauge", value: 1 },
          {
            name: "gridwire_portal_uptime_seconds",
            help: "Seconds since this portal instance started.",
            type: "gauge",
            value: Math.round((Date.now() - PROCESS_STARTED_AT) / 1000),
          },
        ];

        // --- backend reachability (readiness) --------------------------------
        const supaUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
        const supaKey =
          process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
        let backendUp = 0;
        if (supaUrl) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(`${supaUrl}/rest/v1/`, {
              headers: supaKey ? { apikey: supaKey, Authorization: `Bearer ${supaKey}` } : undefined,
              signal: controller.signal,
            });
            clearTimeout(timeout);
            backendUp = res.ok || res.status < 500 ? 1 : 0;
          } catch {
            backendUp = 0;
          }
        }
        samples.push({
          name: "gridwire_backend_up",
          help: "Backend (database/REST) reachable from the portal.",
          type: "gauge",
          value: backendUp,
        });

        // --- application gauges (best-effort; never fail the scrape) ----------
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

          const count = async (
            fn: () => PromiseLike<{ count: number | null }>,
          ): Promise<number> => {
            try {
              const { count: c } = await fn();
              return c ?? 0;
            } catch {
              return 0;
            }
          };

          const [datasets, apiKeys, reads24h, authFail24h, alertsOpen, runsOk24h, runsErr24h] =
            await Promise.all([
              count(() => supabaseAdmin.from("datasets").select("*", { count: "exact", head: true })),
              count(() =>
                supabaseAdmin
                  .from("api_keys")
                  .select("*", { count: "exact", head: true })
                  .is("revoked_at", null),
              ),
              count(() =>
                supabaseAdmin
                  .from("consumption_events")
                  .select("*", { count: "exact", head: true })
                  .gte("created_at", since),
              ),
              count(() =>
                supabaseAdmin
                  .from("audit_events")
                  .select("*", { count: "exact", head: true })
                  .eq("action", "api.auth.failed")
                  .gte("created_at", since),
              ),
              count(() =>
                supabaseAdmin
                  .from("alert_events")
                  .select("*", { count: "exact", head: true })
                  .gte("created_at", since),
              ),
              count(() =>
                supabaseAdmin
                  .from("connector_runs")
                  .select("*", { count: "exact", head: true })
                  .eq("status", "success")
                  .gte("created_at", since),
              ),
              count(() =>
                supabaseAdmin
                  .from("connector_runs")
                  .select("*", { count: "exact", head: true })
                  .eq("status", "error")
                  .gte("created_at", since),
              ),
            ]);

          samples.push(
            { name: "gridwire_datasets_total", help: "Total datasets.", type: "gauge", value: datasets },
            {
              name: "gridwire_api_keys_active_total",
              help: "Active (non-revoked) API keys.",
              type: "gauge",
              value: apiKeys,
            },
            {
              name: "gridwire_api_reads_24h",
              help: "API read requests recorded in the last 24h.",
              type: "gauge",
              value: reads24h,
            },
            {
              name: "gridwire_api_auth_failures_24h",
              help: "Failed API auth attempts in the last 24h.",
              type: "gauge",
              value: authFail24h,
            },
            {
              name: "gridwire_alert_events_24h",
              help: "Alert events raised in the last 24h.",
              type: "gauge",
              value: alertsOpen,
            },
            {
              name: "gridwire_connector_runs_24h",
              help: "Connector job runs in the last 24h by status.",
              type: "gauge",
              value: runsOk24h,
              labels: { status: "success" },
            },
            {
              name: "gridwire_connector_runs_24h",
              help: "Connector job runs in the last 24h by status.",
              type: "gauge",
              value: runsErr24h,
              labels: { status: "error" },
            },
          );
        } catch {
          // Backend unavailable — still return process metrics above.
        }

        return new Response(renderPrometheus(samples), {
          status: 200,
          headers: {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
