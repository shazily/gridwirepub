import { createFileRoute } from "@tanstack/react-router";
import { type PortalBranding } from "@/lib/portal-branding";
import { exposeErrorDetail } from "@/lib/api-error.server";

// GET /api/public/portal/:orgSlug — branding for one organization's portal page.
export const Route = createFileRoute("/api/public/portal/$orgSlug")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const orgSlug = params.orgSlug?.trim();
        if (!orgSlug) {
          return Response.json(
            { errors: [{ code: "invalid_slug", message: "Organization slug is required" }] },
            { status: 400 },
          );
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { extractClientIp, isPortalIpAllowed } = await import("@/lib/portal-access.server");
          const { data, error } = await supabaseAdmin.rpc("get_public_portal_branding", {
            _slug: orgSlug,
          });
          if (error) {
            const detail = exposeErrorDetail(error);
            return Response.json(
              {
                errors: [
                  {
                    code: "branding_unavailable",
                    message: "Branding is temporarily unavailable.",
                    ...(detail ? { detail } : {}),
                  },
                ],
              },
              { status: 503 },
            );
          }
          if (!data) {
            return Response.json(
              { errors: [{ code: "not_found", message: "Organization not found" }] },
              { status: 404 },
            );
          }
          const branding = data as PortalBranding & { org_id?: string };
          if (branding.org_id) {
            const clientIp = extractClientIp(request);
            const allowed = await isPortalIpAllowed(branding.org_id, clientIp);
            if (!allowed) {
              return Response.json(
                {
                  errors: [
                    {
                      code: "portal_access_denied",
                      message: "Access to this portal is restricted from your network.",
                    },
                  ],
                },
                { status: 403 },
              );
            }
          }
          return Response.json(
            { data: branding },
            { status: 200, headers: { "Cache-Control": "public, max-age=60" } },
          );
        } catch (err) {
          const detail = exposeErrorDetail(err);
          return Response.json(
            {
              errors: [
                {
                  code: "branding_error",
                  message: "Could not load portal branding.",
                  ...(detail ? { detail } : {}),
                },
              ],
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
