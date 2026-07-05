/**
 * Rate limits and auth for unauthenticated public endpoints.
 */

import { extractClientIp } from "@/lib/portal-access.server";
import {
  assertInboundWebhookProductionConfig,
  inboundWebhookSecret,
  verifyInboundWebhookSharedSecret,
} from "@/lib/inbound-webhook-auth.server";

const publicRateWindows = new Map<string, number[]>();

export type PublicRateLimitOptions = {
  perMin?: number;
  burst?: number;
  windowMs?: number;
};

function publicRateLimitConfig(overrides?: PublicRateLimitOptions) {
  const envPerMin = Number(process.env.PUBLIC_RATE_LIMIT_PER_MIN ?? 60);
  const envBurst = Number(process.env.PUBLIC_RATE_LIMIT_BURST ?? 30);
  const perMin = Math.max(1, overrides?.perMin ?? envPerMin);
  const burst = Math.max(1, overrides?.burst ?? envBurst);
  const windowMs = overrides?.windowMs ?? 60_000;
  return { perMin, burst, windowMs, limit: Math.max(perMin, burst) };
}

type RateLimitState = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

function consumePublicRateLimit(bucketKey: string, overrides?: PublicRateLimitOptions): RateLimitState {
  const { limit, windowMs } = publicRateLimitConfig(overrides);
  const now = Date.now();
  const hits = (publicRateWindows.get(bucketKey) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    return { allowed: false, limit, remaining: 0, resetAt: hits[0]! + windowMs };
  }
  hits.push(now);
  publicRateWindows.set(bucketKey, hits);
  return { allowed: true, limit, remaining: limit - hits.length, resetAt: now + windowMs };
}

function rateLimitHeaders(state: RateLimitState): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(state.limit),
    "X-RateLimit-Remaining": String(Math.max(0, state.remaining)),
    "X-RateLimit-Reset": String(Math.ceil(state.resetAt / 1000)),
  };
}

export function jsonRateLimitResponse(state: RateLimitState): Response {
  const retryAfter = Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000));
  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again shortly.", code: "rate_limit_exceeded" }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        ...rateLimitHeaders(state),
        "Retry-After": String(retryAfter),
      },
    },
  );
}

/** Returns a 429 Response when limited, otherwise null. */
export function checkPublicEndpointRateLimit(
  request: Request,
  endpoint: string,
  overrides?: PublicRateLimitOptions,
): Response | null {
  const ip = extractClientIp(request);
  const bucketKey = `public:${endpoint}:ip:${ip}`;
  const state = consumePublicRateLimit(bucketKey, overrides);
  if (state.allowed) return null;

  console.warn(
    JSON.stringify({
      level: "warn",
      event: "public_rate_limit_exceeded",
      endpoint,
      ipPrefix: ip.slice(0, 8),
    }),
  );

  return jsonRateLimitResponse(state);
}

/**
 * Requires INBOUND_WEBHOOK_SECRET in production; shared secret header/Bearer in all environments
 * where the secret is configured.
 */
export function verifyInboundWebhookSecret(request: Request): Response | null {
  try {
    assertInboundWebhookProductionConfig();
  } catch {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Inbound webhook authentication is not configured",
        code: "webhook_auth_not_configured",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!inboundWebhookSecret()) return null;

  if (verifyInboundWebhookSharedSecret(request)) {
    return null;
  }

  console.warn(
    JSON.stringify({
      level: "warn",
      event: "inbound_webhook_auth_failed",
      reason: "shared_secret_mismatch",
    }),
  );

  return new Response(JSON.stringify({ ok: false, error: "unauthorized", code: "webhook_unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export function inboundWebhookAuthConfigured(): boolean {
  return Boolean(inboundWebhookSecret());
}

export { assertInboundWebhookProductionConfig, inboundWebhookProductionReady } from "@/lib/inbound-webhook-auth.server";

/** Clears in-memory public rate limit windows (tests only). */
export function resetPublicRateLimitsForTests(): void {
  publicRateWindows.clear();
}
