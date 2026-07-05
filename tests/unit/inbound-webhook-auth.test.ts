import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertInboundWebhookProductionConfig,
  verifyInboundWebhookAuth,
  verifyInboundWebhookSharedSecret,
  verifyPostmarkWebhookSignature,
} from "@/lib/inbound-webhook-auth.server";

describe("inbound-webhook-auth", () => {
  const prevNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.INBOUND_WEBHOOK_SECRET;
    delete process.env.POSTMARK_WEBHOOK_SECRET;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env.NODE_ENV = prevNodeEnv;
  });

  it("allows dev webhook without secret configured", () => {
    const req = new Request("http://localhost/api/public/inbound/webhook", { method: "POST" });
    expect(verifyInboundWebhookSharedSecret(req)).toBe(true);
    const auth = verifyInboundWebhookAuth(req, "{}", undefined);
    expect(auth.ok).toBe(true);
  });

  it("requires INBOUND_WEBHOOK_SECRET in production", () => {
    process.env.NODE_ENV = "production";
    expect(() => assertInboundWebhookProductionConfig()).toThrow(/INBOUND_WEBHOOK_SECRET/);
    const req = new Request("http://localhost/api/public/inbound/webhook", { method: "POST" });
    const auth = verifyInboundWebhookAuth(req, "{}", undefined);
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.status).toBe(503);
  });

  it("rejects missing shared secret when configured", () => {
    process.env.INBOUND_WEBHOOK_SECRET = "shared-secret";
    const req = new Request("http://localhost/api/public/inbound/webhook", { method: "POST" });
    const auth = verifyInboundWebhookAuth(req, "{}", undefined);
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.status).toBe(401);
  });

  it("accepts matching shared secret header", () => {
    process.env.INBOUND_WEBHOOK_SECRET = "shared-secret";
    const req = new Request("http://localhost/api/public/inbound/webhook", {
      method: "POST",
      headers: { "X-Gridwire-Webhook-Secret": "shared-secret" },
    });
    const auth = verifyInboundWebhookAuth(req, "{}", undefined);
    expect(auth.ok).toBe(true);
  });

  it("verifies Postmark signature when required in production", () => {
    process.env.NODE_ENV = "production";
    process.env.INBOUND_WEBHOOK_SECRET = "shared-secret";
    process.env.POSTMARK_WEBHOOK_SECRET = "postmark-token";
    const body = '{"From":"a@b.com"}';
    const sig = createHmac("sha256", "postmark-token").update(body, "utf8").digest("base64");
    const req = new Request("http://localhost/api/public/inbound/postmark", {
      method: "POST",
      headers: {
        "X-Gridwire-Webhook-Secret": "shared-secret",
        "X-Postmark-Signature": sig,
      },
    });
    const auth = verifyInboundWebhookAuth(req, body, { requirePostmarkSignature: true });
    expect(auth.ok).toBe(true);
    expect(verifyPostmarkWebhookSignature(body, sig)).toBe(true);
  });

  it("rejects invalid Postmark signature when required", () => {
    process.env.INBOUND_WEBHOOK_SECRET = "shared-secret";
    process.env.POSTMARK_WEBHOOK_SECRET = "postmark-token";
    const body = '{"From":"a@b.com"}';
    const req = new Request("http://localhost/api/public/inbound/postmark", {
      method: "POST",
      headers: {
        "X-Gridwire-Webhook-Secret": "shared-secret",
        "X-Postmark-Signature": "invalid",
      },
    });
    const auth = verifyInboundWebhookAuth(req, body, { requirePostmarkSignature: true });
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.code).toBe("postmark_signature_invalid");
  });
});
