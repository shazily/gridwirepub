import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const siteFeedbackSchema = z.object({
  email: z.string().max(320).optional(),
  category: z.enum(["general", "bug", "feature", "support"]),
  message: z.string().min(5).max(4000),
  pagePath: z.string().max(500).optional(),
});

/**
 * Public marketing-site feedback — stored via service role (no anon INSERT policy).
 */
export const submitSiteFeedback = createServerFn({ method: "POST" })
  .inputValidator((data) => siteFeedbackSchema.parse(data))
  .handler(async ({ data }) => {
    const req = getRequest();
    if (req) {
      const { checkPublicEndpointRateLimit } = await import("@/lib/public-endpoint-guard.server");
      const limited = checkPublicEndpointRateLimit(req, "site-feedback", { perMin: 20, burst: 10 });
      if (limited) {
        throw new Error("Too many feedback submissions. Please wait a minute and try again.");
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rawEmail = data.email?.trim() ?? "";
    if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      throw new Error("Enter a valid email address or leave it blank");
    }
    const email = rawEmail || null;
    const { error } = await supabaseAdmin.from("site_feedback").insert({
      email,
      category: data.category,
      message: data.message.trim(),
      page_path: data.pagePath ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
