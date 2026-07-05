/**
 * Inbound email webhook authentication — shared secret + provider signatures.
 * In production, INBOUND_WEBHOOK_SECRET is mandatory (fail closed).
 */

import { createHmac, timingSafeEqual } from "crypto";

export function isProductionDeployment(): boolean {
  return process.env.NODE_ENV === "production";
}

export function inboundWebhookSecret(): string {
  return process.env.INBOUND_WEBHOOK_SECRET?.trim() ?? "";
}

export function postmarkWebhookSecret(): string {
  return process.env.POSTMARK_WEBHOOK_SECRET?.trim() || inboundWebhookSecret();
}

/** Throws when production is missing mandatory inbound webhook configuration. */
export function assertInboundWebhookProductionConfig(): void {
  if (!isProductionDeployment()) return;
  if (!inboundWebhookSecret()) {
    throw new Error(
      "INBOUND_WEBHOOK_SECRET must be set in production. Inbound email webhooks refuse unauthenticated payloads.",
    );
  }
}

export function inboundWebhookProductionReady(): boolean {
  try {
    assertInboundWebhookProductionConfig();
    return true;
  } catch {
    return false;
  }
}

function safeSecretEqual(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Gridwire shared secret via header or Bearer (required in production). */
export function verifyInboundWebhookSharedSecret(request: Request): boolean {
  const secret = inboundWebhookSecret();
  if (!secret) {
    return !isProductionDeployment();
  }

  const headerSecret =
    request.headers.get("x-gridwire-webhook-secret")?.trim() ??
    request.headers.get("x-webhook-secret")?.trim() ??
    "";
  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  return safeSecretEqual(headerSecret, secret) || safeSecretEqual(bearer, secret);
}

/**
 * Postmark delivery/inbound webhook signature — Base64(HMAC-SHA256(rawBody, secret)).
 * @see https://postmarkapp.com/developer/webhooks/webhooks-overview
 */
export function verifyPostmarkWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = postmarkWebhookSecret();
  if (!secret || !signatureHeader?.trim()) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return safeSecretEqual(signatureHeader.trim(), expected);
}

export type InboundWebhookAuthOptions = {
  /** When true (Postmark route), production requires a valid X-Postmark-Signature. */
  requirePostmarkSignature?: boolean;
};

export type InboundWebhookAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string; code: string };

export function verifyInboundWebhookAuth(
  request: Request,
  rawBody: string,
  opts?: InboundWebhookAuthOptions,
): InboundWebhookAuthResult {
  if (isProductionDeployment() && !inboundWebhookSecret()) {
    return {
      ok: false,
      status: 503,
      error: "Inbound webhook authentication is not configured",
      code: "webhook_auth_not_configured",
    };
  }

  if (!verifyInboundWebhookSharedSecret(request)) {
    return { ok: false, status: 401, error: "unauthorized", code: "webhook_unauthorized" };
  }

  const postmarkSig = request.headers.get("x-postmark-signature");

  if (opts?.requirePostmarkSignature) {
    const secret = postmarkWebhookSecret();
    if (isProductionDeployment() || secret) {
      if (!verifyPostmarkWebhookSignature(rawBody, postmarkSig)) {
        return {
          ok: false,
          status: 401,
          error: "invalid_postmark_signature",
          code: "postmark_signature_invalid",
        };
      }
    }
  } else if (postmarkSig && !verifyPostmarkWebhookSignature(rawBody, postmarkSig)) {
    return {
      ok: false,
      status: 401,
      error: "invalid_postmark_signature",
      code: "postmark_signature_invalid",
    };
  }

  return { ok: true };
}
