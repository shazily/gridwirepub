import { emailDeliveryConfigured, sendEmail } from "@/lib/email.server";
import {
  buildPortalRecoveryLink,
  resolvePublicAppUrl,
  sanitizePasswordResetRedirect,
} from "@/lib/public-app-url.server";

export { buildPortalRecoveryLink } from "@/lib/public-app-url.server";

export async function sendPasswordResetEmail(args: {
  email: string;
  redirectTo?: string;
  /** Org auth_config.public_app_url when available */
  publicAppUrlOverride?: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  if (!emailDeliveryConfigured()) {
    return { sent: false, reason: "email_not_configured" };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const publicOrigin = resolvePublicAppUrl({
    explicitOverride: args.publicAppUrlOverride,
    preferredRedirect: args.redirectTo,
  });
  const redirectTo = sanitizePasswordResetRedirect(args.redirectTo, publicOrigin);

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email: args.email.trim().toLowerCase(),
    options: { redirectTo },
  });

  if (error || !data?.properties?.hashed_token) {
    // Do not leak whether the account exists.
    return { sent: true };
  }

  const resetLink = buildPortalRecoveryLink(data.properties.hashed_token, publicOrigin);
  const senderName = process.env.SMTP_SENDER_NAME?.trim() || "Gridwire";

  const ok = await sendEmail({
    to: args.email.trim(),
    subject: "Reset your Gridwire password",
    purpose: "noreply",
    tag: "password-reset",
    text: [
      `You requested a password reset for your ${senderName} account.`,
      "",
      `Reset your password: ${resetLink}`,
      "",
      "If you did not request this, you can ignore this email.",
      "This link expires after a short time.",
    ].join("\n"),
    html: `<p>You requested a password reset for your ${senderName} account.</p>
<p><a href="${resetLink}">Reset your password</a></p>
<p>If you did not request this, you can ignore this email. This link expires after a short time.</p>`,
  });

  return ok ? { sent: true } : { sent: false, reason: "delivery_failed" };
}
