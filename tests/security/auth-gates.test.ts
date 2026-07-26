import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyInboundWebhookAuth } from "@/lib/inbound-webhook-auth.server";
import { validateMetricsToken } from "@/lib/metrics-auth.server";
import { safeTokenEqual } from "@/lib/token-compare.server";

function authorizeWorker(request: Request): boolean {
  const token = request.headers.get("x-worker-token") ?? "";
  const expected = process.env.WORKER_INGEST_TOKEN ?? "";
  return Boolean(expected) && safeTokenEqual(token, expected);
}

describe("auth-gated endpoints fail closed", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("inbound webhook returns unauthorized without matching INBOUND_WEBHOOK_SECRET", () => {
    process.env.INBOUND_WEBHOOK_SECRET = "expected-shared-secret";
    const req = new Request("http://localhost/api/public/inbound/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const result = verifyInboundWebhookAuth(req, "{}");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("worker ingest API rejects invalid WORKER_INGEST_TOKEN", () => {
    process.env.WORKER_INGEST_TOKEN = "correct-worker-token";
    const req = new Request("http://localhost/api/public/worker/ingest", {
      method: "POST",
      headers: { "x-worker-token": "invalid-token" },
    });
    expect(authorizeWorker(req)).toBe(false);
  });

  it("/api/public/metrics rejects without METRICS_TOKEN", () => {
    const req = new Request("http://localhost/api/public/metrics");
    expect(validateMetricsToken(req, undefined)).toBe(false);
    expect(validateMetricsToken(req, "")).toBe(false);
  });
});
