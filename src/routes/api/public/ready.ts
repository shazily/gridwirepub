import { createFileRoute } from "@tanstack/react-router";
import { exposeErrorDetail } from "@/lib/api-error.server";

// GET /api/public/ready — readiness probe.
// Verifies config + backend reachability. Returns 503 when not safe to route traffic.
export const Route = createFileRoute("/api/public/ready")({
  server: {
    handlers: {
      GET: async () => {
        const started = Date.now();
        const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
        const publishable =
          process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
        const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

        const respond = (ok: boolean, detail: Record<string, unknown>) =>
          new Response(
            JSON.stringify({
              status: ok ? "ready" : "not-ready",
              service: "portal",
              checks: { backend: ok ? "ok" : "unreachable", ...detail },
              latency_ms: Date.now() - started,
              time: new Date().toISOString(),
            }),
            {
              status: ok ? 200 : 503,
              headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            },
          );

        if (!url) return respond(false, { reason: "SUPABASE_URL not configured" });
        if (!publishable) return respond(false, { reason: "SUPABASE_PUBLISHABLE_KEY not configured" });
        if (!serviceRole || serviceRole.includes("replace-with")) {
          return respond(false, { reason: "SUPABASE_SERVICE_ROLE_KEY not configured" });
        }

        try {
          const { assertFieldEncryptionProductionConfig } = await import("@/lib/field-protection.server");
          const { assertInboundWebhookProductionConfig } = await import("@/lib/inbound-webhook-auth.server");
          assertFieldEncryptionProductionConfig();
          assertInboundWebhookProductionConfig();
        } catch (err) {
          return respond(false, { reason: "security_config_invalid", detail: exposeErrorDetail(err) });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("organizations").select("id", { head: true, count: "exact" });
          if (error) {
            return respond(false, {
              reason: "service_role query failed",
              ...(exposeErrorDetail(error) ? { detail: exposeErrorDetail(error) } : {}),
            });
          }
        } catch (err) {
          const detail = exposeErrorDetail(err);
          return respond(false, detail ? { reason: "service_role_check_failed", detail } : { reason: "service_role_check_failed" });
        }

        let storageStatus = "disabled";
        try {
          const { storageEnabled, testStorageConnection } = await import("@/lib/storage.server");
          if (storageEnabled()) {
            const result = await testStorageConnection({ provider: "platform" });
            storageStatus = result.ok ? "ok" : "unreachable";
          }
        } catch {
          storageStatus = "unreachable";
        }

        let clamavStatus = "not_configured";
        try {
          const { clamavConfigured, clamavReachable } = await import("@/lib/clamav.server");
          if (clamavConfigured()) {
            const ping = await clamavReachable();
            clamavStatus = ping.ok ? "ok" : "unreachable";
          }
        } catch {
          clamavStatus = "unreachable";
        }

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(`${url}/rest/v1/`, {
            method: "GET",
            headers: publishable ? { apikey: publishable, Authorization: `Bearer ${publishable}` } : undefined,
            signal: controller.signal,
          });
          clearTimeout(timeout);
          return respond(true, { http_status: res.status, service_role: "ok", storage: storageStatus, clamav: clamavStatus });
        } catch (err) {
          const detail = exposeErrorDetail(err);
          return respond(false, detail ? { reason: "backend_unreachable", detail } : { reason: "backend_unreachable" });
        }
      },
    },
  },
});
