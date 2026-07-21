import { createFileRoute } from "@tanstack/react-router";
import { emailDeliveryConfigured } from "@/lib/email.server";

// GET /api/public/config — non-secret deployment capabilities for the auth UI.
export const Route = createFileRoute("/api/public/config")({
  server: {
    handlers: {
      GET: async () => {
        const mailerAutoconfirm = process.env.GOTRUE_MAILER_AUTOCONFIRM === "true";
        const postmarkConfigured = Boolean(process.env.POSTMARK_API_TOKEN?.trim());
        const smtpConfigured = Boolean(process.env.SMTP_HOST?.trim());
        const passwordResetAvailable = emailDeliveryConfigured();
        const emailConfirmRequired = !mailerAutoconfirm;

        return new Response(
          JSON.stringify({
            deployment_mode: process.env.DEPLOYMENT_MODE ?? "onprem",
            password_reset_available: passwordResetAvailable,
            email_confirm_required: emailConfirmRequired,
            smtp_configured: smtpConfigured || postmarkConfigured,
            email_provider: postmarkConfigured ? "postmark" : smtpConfigured ? "smtp" : "none",
            public_app_url_configured: Boolean(
              (process.env.PUBLIC_APP_URL || process.env.SITE_URL || "").trim() &&
                !(process.env.PUBLIC_APP_URL || process.env.SITE_URL || "").includes("127.0.0.1") &&
                !(process.env.PUBLIC_APP_URL || process.env.SITE_URL || "").includes("localhost"),
            ),
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=60",
            },
          },
        );
      },
    },
  },
});
