import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimitsForTests } from "@/lib/api-serve.server";

describe("rate limiter", () => {
  beforeEach(() => {
    resetRateLimitsForTests();
    process.env.API_RATE_LIMIT_PER_MIN = "2";
    process.env.API_RATE_LIMIT_BURST = "2";
  });

  it("allows requests under the limit", () => {
    const req = new Request("http://localhost/api/v1/datasets/x", {
      headers: { "x-forwarded-for": "203.0.113.1" },
    });
    const r1 = checkRateLimit(req, null);
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.headers["X-RateLimit-Limit"]).toBeDefined();
      expect(Number(r1.headers["X-RateLimit-Remaining"])).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns 429 after burst exceeded", () => {
    const req = new Request("http://localhost/api/v1/datasets/x", {
      headers: { "x-forwarded-for": "203.0.113.99" },
    });
    checkRateLimit(req, null);
    checkRateLimit(req, null);
    const r3 = checkRateLimit(req, null);
    expect(r3.ok).toBe(false);
    if (!r3.ok) {
      expect(r3.response.status).toBe(429);
      expect(r3.response.headers.get("X-RateLimit-Limit")).toBeTruthy();
      expect(r3.response.headers.get("Retry-After")).toBeTruthy();
    }
  });

  it("honors per-key override", () => {
    const req = new Request("http://localhost/api/v1/datasets/x", {
      headers: { "x-forwarded-for": "203.0.113.50" },
    });
    checkRateLimit(req, "key-1", { perMin: 1, burst: 1 });
    const r2 = checkRateLimit(req, "key-1", { perMin: 1, burst: 1 });
    expect(r2.ok).toBe(false);
  });
});
