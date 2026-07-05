import { describe, expect, it, beforeEach } from "vitest";
import { validateMetricsToken } from "@/lib/metrics-auth.server";

describe("metrics auth", () => {
  it("rejects when METRICS_TOKEN is unset", () => {
    const req = new Request("http://localhost/api/public/metrics");
    expect(validateMetricsToken(req, undefined)).toBe(false);
    expect(validateMetricsToken(req, "")).toBe(false);
    expect(validateMetricsToken(req, "   ")).toBe(false);
  });

  it("rejects missing or wrong token", () => {
    const req = new Request("http://localhost/api/public/metrics");
    expect(validateMetricsToken(req, "secret")).toBe(false);
  });

  it("accepts Bearer token", () => {
    const req = new Request("http://localhost/api/public/metrics", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(validateMetricsToken(req, "secret")).toBe(true);
  });

  it("accepts query token", () => {
    const req = new Request("http://localhost/api/public/metrics?token=secret");
    expect(validateMetricsToken(req, "secret")).toBe(true);
  });
});
