import { createFileRoute } from "@tanstack/react-router";
import { emailDeliveryConfigured } from "@/lib/email.server";
import { sendPasswordResetEmail } from "@/lib/password-reset.server";
import { publicErrorBody } from "@/lib/api-error.server";

// POST /api/public/auth/recover — password reset via Postmark HTTP (GoTrue SMTP blocked in Docker).
export const Route = createFileRoute("/api/public/auth/recover")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { checkPublicEndpointRateLimit } = await import("@/lib/public-endpoint-guard.server");
        const rateLimited = checkPublicEndpointRateLimit(request, "auth-recover", { perMin: 10, burst: 5 });
        if (rateLimited) return rateLimited;

        if (!emailDeliveryConfigured()) {
          return new Response(
            JSON.stringify({
              error: "Password reset email is not configured on this server.",
              code: "email_not_configured",
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }

        let body: { email?: string; redirectTo?: string };
        try {
          body = (await request.json()) as { email?: string; redirectTo?: string };
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!email || !email.includes("@")) {
          return new Response(JSON.stringify({ error: "A valid email is required." }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const redirectTo =
          typeof body.redirectTo === "string" && body.redirectTo.startsWith("http")
            ? body.redirectTo
            : undefined;

        try {
          const result = await sendPasswordResetEmail({ email, redirectTo });
          if (!result.sent && result.reason === "delivery_failed") {
            return new Response(
              JSON.stringify({
                error: "Could not send reset email. Check Postmark configuration.",
                code: "delivery_failed",
              }),
              { status: 502, headers: { "Content-Type": "application/json" } },
            );
          }
        } catch (err) {
          return new Response(
            JSON.stringify(
              publicErrorBody({ error: "Could not send reset email.", code: "delivery_failed" }, err),
            ),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            ok: true,
            message: "If an account exists for that email, a reset link has been sent.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
