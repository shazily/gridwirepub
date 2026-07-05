/**
 * Outbound email — Postmark HTTP API (preferred) or SMTP (GoTrue-compatible).
 * Use purpose-specific From addresses (noreply, notifications, support, info).
 */

export type EmailPurpose = "noreply" | "notifications" | "support" | "info" | "auth";

export type SmtpConfig = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  secure: boolean;
};

export type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  tag?: string;
  /** Selects a verified Postmark sender for this message type. */
  purpose?: EmailPurpose;
  /** Optional explicit From override (must be a verified sender). */
  from?: string;
};

const PURPOSE_ENV: Record<EmailPurpose, string> = {
  noreply: "EMAIL_FROM_NOREPLY",
  notifications: "EMAIL_FROM_NOTIFICATIONS",
  support: "EMAIL_FROM_SUPPORT",
  info: "EMAIL_FROM_INFO",
  auth: "EMAIL_FROM_AUTH",
};

const PURPOSE_DISPLAY_SUFFIX: Record<EmailPurpose, string | null> = {
  noreply: null,
  notifications: "Alerts",
  support: "Support",
  info: null,
  auth: null,
};

function skipEmail(): boolean {
  return process.env.SKIP_EMAIL === "true";
}

function platformName(): string {
  return process.env.SMTP_SENDER_NAME?.trim() || "Gridwire";
}

function formatFromAddress(email: string, purpose: EmailPurpose): string {
  const suffix = PURPOSE_DISPLAY_SUFFIX[purpose];
  const name = suffix ? `${platformName()} ${suffix}` : platformName();
  return `${name} <${email}>`;
}

/** Resolved From header for a given email purpose (Postmark Sender Signature). */
export function emailFromForPurpose(purpose: EmailPurpose = "noreply"): string | null {
  const envKey = PURPOSE_ENV[purpose];
  const address =
    process.env[envKey]?.trim() ||
    (purpose === "noreply" ? process.env.SMTP_FROM?.trim() : undefined) ||
    process.env.SMTP_FROM?.trim();
  if (!address) return null;
  return formatFromAddress(address, purpose);
}

/** Default From — noreply / SMTP_FROM (GoTrue compatibility). */
export function emailFromAddress(): string | null {
  return emailFromForPurpose("noreply");
}

function resolveFrom(payload: EmailPayload): string | null {
  if (payload.from?.trim()) return payload.from.trim();
  return emailFromForPurpose(payload.purpose ?? "noreply");
}

export function smtpConfigFromEnv(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const from = emailFromAddress();
  if (!host || !from) return null;
  const port = Number(process.env.SMTP_PORT ?? 587);
  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    user: process.env.SMTP_USER?.trim() || undefined,
    pass: process.env.SMTP_PASS?.trim() || undefined,
    from,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
  };
}

export function postmarkConfigFromEnv(): { token: string; apiUrl: string } | null {
  const token = process.env.POSTMARK_API_TOKEN?.trim();
  if (!token) return null;
  return {
    token,
    apiUrl: process.env.POSTMARK_API_URL?.trim() || "https://api.postmarkapp.com/email",
  };
}

/** Whether password reset / app email can be sent in this deployment. */
export function emailDeliveryConfigured(): boolean {
  if (skipEmail()) return false;
  return postmarkConfigFromEnv() !== null || smtpConfigFromEnv() !== null;
}

async function sendPostmarkEmail(args: EmailPayload): Promise<boolean> {
  const cfg = postmarkConfigFromEnv();
  const from = resolveFrom(args);
  if (!cfg || !from) return false;

  const res = await fetch(cfg.apiUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": cfg.token,
    },
    body: JSON.stringify({
      From: from,
      To: args.to,
      Subject: args.subject,
      TextBody: args.text,
      HtmlBody: args.html,
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM?.trim() || "outbound",
      Tag: args.tag ?? (process.env.POSTMARK_TAG?.trim() || undefined),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Postmark send failed (${res.status}): ${body}`);
  }
  return true;
}

export async function sendSmtpEmail(args: EmailPayload): Promise<boolean> {
  const host = process.env.SMTP_HOST?.trim();
  const from = resolveFrom(args);
  if (!host || !from) return false;

  const port = Number(process.env.SMTP_PORT ?? 587);
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth:
      process.env.SMTP_USER?.trim()
        ? { user: process.env.SMTP_USER.trim(), pass: process.env.SMTP_PASS?.trim() ?? "" }
        : undefined,
  });

  await transport.sendMail({
    from,
    to: args.to,
    subject: args.subject,
    text: args.text,
    html: args.html ?? undefined,
  });
  return true;
}

/** Send via Postmark API when configured, otherwise SMTP. */
export async function sendEmail(args: EmailPayload): Promise<boolean> {
  if (skipEmail()) return false;
  if (postmarkConfigFromEnv()) {
    return sendPostmarkEmail(args);
  }
  return sendSmtpEmail(args);
}
