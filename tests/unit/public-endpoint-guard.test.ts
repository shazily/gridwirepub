import { beforeEach, describe, expect, it } from "vitest";
import {
  checkPublicEndpointRateLimit,
  resetPublicRateLimitsForTests,
  verifyInboundWebhookSecret,
} from "@/lib/public-endpoint-guard.server";

describe("public-endpoint-guard", () => {
  beforeEach(() => {
    resetPublicRateLimitsForTests();
    delete process.env.INBOUND_WEBHOOK_SECRET;
  });

  it("allows webhook when secret env is unset in non-production", () => {
    process.env.NODE_ENV = "test";
    const req = new Request("http://localhost/api/public/inbound/webhook", { method: "POST" });
    expect(verifyInboundWebhookSecret(req)).toBeNull();
  });

  it("returns 503 in production when secret env is unset", () => {
    process.env.NODE_ENV = "production";
    const req = new Request("http://localhost/api/public/inbound/webhook", { method: "POST" });
    const res = verifyInboundWebhookSecret(req);
    expect(res?.status).toBe(503);
    process.env.NODE_ENV = "test";
  });

  it("rejects webhook when secret env is set but header missing", () => {
    process.env.INBOUND_WEBHOOK_SECRET = "test-secret-value";
    const req = new Request("http://localhost/api/public/inbound/webhook", { method: "POST" });
    const res = verifyInboundWebhookSecret(req);
    expect(res?.status).toBe(401);
  });

  it("accepts webhook when secret header matches", () => {
    process.env.INBOUND_WEBHOOK_SECRET = "test-secret-value";
    const req = new Request("http://localhost/api/public/inbound/webhook", {
      method: "POST",
      headers: { "X-Gridwire-Webhook-Secret": "test-secret-value" },
    });
    expect(verifyInboundWebhookSecret(req)).toBeNull();
  });

  it("rate limits after burst exceeded", () => {
    const req = new Request("http://localhost/api/public/auth/recover", {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.10" },
    });
    for (let i = 0; i < 2; i++) {
      expect(checkPublicEndpointRateLimit(req, "test-endpoint", { perMin: 2, burst: 2 })).toBeNull();
    }
    const limited = checkPublicEndpointRateLimit(req, "test-endpoint", { perMin: 2, burst: 2 });
    expect(limited?.status).toBe(429);
  });
});
