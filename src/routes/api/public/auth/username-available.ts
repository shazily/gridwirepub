import { createFileRoute } from "@tanstack/react-router";
import { publicErrorBody } from "@/lib/api-error.server";

const USERNAME_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i;

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

function isValidUsername(username: string): boolean {
  return username.length >= 3 && username.length <= 32 && USERNAME_RE.test(username);
}

// GET /api/public/auth/username-available?username=ada
export const Route = createFileRoute("/api/public/auth/username-available")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { checkPublicEndpointRateLimit } = await import("@/lib/public-endpoint-guard.server");
        const rateLimited = checkPublicEndpointRateLimit(request, "username-available", {
          perMin: 30,
          burst: 10,
        });
        if (rateLimited) return rateLimited;

        const url = new URL(request.url);
        const username = normalizeUsername(url.searchParams.get("username") ?? "");
        if (!isValidUsername(username)) {
          return Response.json(
            { available: false, reason: "invalid" },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("is_username_available", {
            _username: username,
          });
          if (error) {
            return Response.json(
              publicErrorBody({ error: "Could not check username.", code: "username_check_failed" }, error),
              { status: 502 },
            );
          }
          return Response.json(
            { available: Boolean(data), username },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        } catch (err) {
          return Response.json(
            publicErrorBody({ error: "Could not check username.", code: "username_check_failed" }, err),
            { status: 502 },
          );
        }
      },
    },
  },
});
