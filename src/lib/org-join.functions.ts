import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const inputSchema = z.object({
  ref: z.string().min(1).max(256),
});

export type JoinPreview =
  | { valid: true; org_name: string; org_id?: string; portal_slug?: string | null }
  | { valid: false };

/**
 * Join-link preview. Uses service_role RPC get_join_preview so anon cannot
 * probe org existence; only returns a name when allow_join_by_org_id is on.
 */
export const getJoinPreview = createServerFn({ method: "GET" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<JoinPreview> => {
    const req = getRequest();
    if (req) {
      const { checkPublicEndpointRateLimit } = await import("@/lib/public-endpoint-guard.server");
      const limited = checkPublicEndpointRateLimit(req, "join-preview", { perMin: 60, burst: 30 });
      if (limited) {
        throw new Error("Too many requests. Please wait a moment and refresh.");
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: preview, error } = await supabaseAdmin.rpc("get_join_preview", {
      _ref: data.ref,
    });
    if (error) throw new Error(error.message);
    const row = preview as JoinPreview | null;
    if (!row || typeof row !== "object" || !("valid" in row)) {
      return { valid: false };
    }
    return row;
  });
