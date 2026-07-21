import { createFileRoute } from "@tanstack/react-router";
import { publicErrorBody } from "@/lib/api-error.server";

/**
 * POST /api/public/auth/resolve-login
 * Body: { identifier: "username" | "email@x.com" }
 * Returns { email } when found, or a generic 200 with email:null (no enumeration message).
 * Callers still use signInWithPassword; failed passwords look the same either way.
 */
export const Route = createFileRoute("/api/public/auth/resolve-login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkPublicEndpointRateLimit } = await import("@/lib/public-endpoint-guard.server");
        const rateLimited = checkPublicEndpointRateLimit(request, "resolve-login", {
          perMin: 30,
          burst: 10,
        });
        if (rateLimited) return rateLimited;

        let body: { identifier?: string };
        try {
          body = (await request.json()) as { identifier?: string };
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
        if (!identifier) {
          return Response.json({ error: "Identifier is required." }, { status: 400 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("resolve_login_email", {
            _identifier: identifier,
          });
          if (error) {
            return Response.json(
              publicErrorBody({ error: "Could not resolve login.", code: "resolve_failed" }, error),
              { status: 502 },
            );
          }
          const email = typeof data === "string" && data.includes("@") ? data : null;
          return Response.json(
            { email },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        } catch (err) {
          return Response.json(
            publicErrorBody({ error: "Could not resolve login.", code: "resolve_failed" }, err),
            { status: 502 },
          );
        }
      },
    },
  },
});
