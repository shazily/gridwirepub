import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const inputSchema = z.object({
  token: z.string().min(1).max(256),
});

export type InvitePreview =
  | { valid: true; org_name: string; role: string }
  | { valid: false; reason: string };

/**
 * Token-gated invite preview for the public invite landing page.
 *
 * The underlying SECURITY DEFINER function `get_invite_preview` is no longer
 * executable by the `anon` or `authenticated` database roles. Instead, this
 * public server function validates input and runs the lookup with the service
 * role, returning only the org name + role for a valid secret token. This
 * removes the anon-executable SECURITY DEFINER path while keeping the
 * pre-signup preview working for people who land on an invite link.
 */
export const getInvitePreview = createServerFn({ method: "GET" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<InvitePreview> => {
    const req = getRequest();
    if (req) {
      const { checkPublicEndpointRateLimit } = await import("@/lib/public-endpoint-guard.server");
      const limited = checkPublicEndpointRateLimit(req, "invite-preview", { perMin: 60, burst: 30 });
      if (limited) {
        throw new Error("Too many requests. Please wait a moment and refresh.");
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: preview, error } = await supabaseAdmin.rpc("get_invite_preview", {
      _token: data.token,
    });
    if (error) throw new Error(error.message);
    return preview as unknown as InvitePreview;
  });
