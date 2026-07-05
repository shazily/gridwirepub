import { emailDeliveryConfigured, sendEmail } from "@/lib/email.server";

function publicAuthBaseUrl(): string {
  return (
    process.env.API_EXTERNAL_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    "http://127.0.0.1:3040"
  ).replace(/\/$/, "");
}

function publicSiteUrl(): string {
  return (process.env.SITE_URL?.trim() || process.env.PUBLIC_APP_URL?.trim() || "http://127.0.0.1:3020").replace(
    /\/$/,
    "",
  );
}

/** Rewrite GoTrue's internal kong action_link into a browser-reachable verify URL. */
export function buildPublicRecoveryLink(hashedToken: string, redirectTo?: string): string {
  const redirect = redirectTo ?? `${publicSiteUrl()}/reset-password`;
  const params = new URLSearchParams({
    token: hashedToken,
    type: "recovery",
    redirect_to: redirect,
  });
  return `${publicAuthBaseUrl()}/auth/v1/verify?${params.toString()}`;
}

export async function sendPasswordResetEmail(args: {
  email: string;
  redirectTo?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  if (!emailDeliveryConfigured()) {
    return { sent: false, reason: "email_not_configured" };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const redirectTo = args.redirectTo ?? `${publicSiteUrl()}/reset-password`;

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email: args.email.trim().toLowerCase(),
    options: { redirectTo },
  });

  if (error || !data?.properties?.hashed_token) {
    // Do not leak whether the account exists.
    return { sent: true };
  }

  const resetLink = buildPublicRecoveryLink(data.properties.hashed_token, redirectTo);
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
