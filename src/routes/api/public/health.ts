import { createFileRoute } from "@tanstack/react-router";

// GET /api/public/health — liveness probe.
// Returns 200 whenever the portal process is up and serving requests. It does
// NOT touch the database, so a slow/unavailable backend never restarts the pod.
// Use this for Kubernetes livenessProbe and container HEALTHCHECK.
export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () =>
        new Response(
          JSON.stringify({ status: "ok", service: "portal", time: new Date().toISOString() }),
          { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
        ),
    },
  },
});
