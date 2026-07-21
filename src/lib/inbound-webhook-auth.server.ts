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

/** Gridwire shared secret via header, Bearer, or HTTP Basic (Postmark inbound URL auth). */
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

  if (safeSecretEqual(headerSecret, secret) || safeSecretEqual(bearer, secret)) {
    return true;
  }

  // Postmark inbound recommends https://user:password@host/path — password (or user) = secret.
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      const user = colon >= 0 ? decoded.slice(0, colon) : decoded;
      const pass = colon >= 0 ? decoded.slice(colon + 1) : "";
      if (safeSecretEqual(pass, secret) || safeSecretEqual(user, secret)) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Optional Postmark HMAC when the provider sends X-Postmark-Signature.
 * Postmark inbound does not currently sign payloads — use HTTP Basic in the hook URL instead.
 * @see https://postmarkapp.com/developer/webhooks/webhooks-overview
 */
export function verifyPostmarkWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = postmarkWebhookSecret();
  if (!secret || !signatureHeader?.trim()) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return safeSecretEqual(signatureHeader.trim(), expected);
}

export type InboundWebhookAuthOptions = {
  /**
   * When true, if X-Postmark-Signature is present it must validate.
   * Missing signature is allowed (Postmark inbound uses Basic Auth, not HMAC).
   */
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

  // Only enforce HMAC when the provider actually sent a signature header.
  if (postmarkSig) {
    if (!verifyPostmarkWebhookSignature(rawBody, postmarkSig)) {
      return {
        ok: false,
        status: 401,
        error: "invalid_postmark_signature",
        code: "postmark_signature_invalid",
      };
    }
  } else if (opts?.requirePostmarkSignature && isProductionDeployment()) {
    // Prefer Basic Auth / shared secret for inbound; do not fail closed on missing HMAC
    // because Postmark inbound does not sign requests today.
  }

  return { ok: true };
}
