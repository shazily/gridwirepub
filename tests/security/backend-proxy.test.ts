import { describe, expect, it } from "vitest";
import {
  isRestOpenApiRoot,
  proxyRateBucketForPath,
  shouldProxyBackend,
} from "@/lib/backend-proxy.server";

describe("backend proxy path guards", () => {
  it("proxies only auth and rest prefixes", () => {
    expect(shouldProxyBackend("/auth/v1/token")).toBe(true);
    expect(shouldProxyBackend("/rest/v1/datasets")).toBe(true);
    expect(shouldProxyBackend("/api/v1/datasets/x")).toBe(false);
  });

  it("normalizes path traversal before matching", () => {
    // `/auth/v1/../rest/v1/` → `/auth/rest/v1/` (not an allowed proxy prefix)
    expect(shouldProxyBackend("/auth/v1/../rest/v1/")).toBe(false);
    expect(isRestOpenApiRoot("/auth/v1/../rest/v1/")).toBe(false);
    expect(shouldProxyBackend("/auth/v1/../../etc/passwd")).toBe(false);
    // Traversal that lands on REST root is still blocked as OpenAPI root
    expect(isRestOpenApiRoot("/foo/../rest/v1/")).toBe(true);
    expect(shouldProxyBackend("/foo/../rest/v1/datasets")).toBe(true);
  });

  it("blocks PostgREST OpenAPI root", () => {
    expect(isRestOpenApiRoot("/rest/v1")).toBe(true);
    expect(isRestOpenApiRoot("/rest/v1/")).toBe(true);
    expect(isRestOpenApiRoot("/rest/v1/datasets")).toBe(false);
  });

  it("applies stricter buckets to credential stuffing paths", () => {
    expect(proxyRateBucketForPath("/auth/v1/token?grant_type=password").endpoint).toBe(
      "proxy-auth-token",
    );
    expect(proxyRateBucketForPath("/auth/v1/signup").perMin).toBe(10);
    expect(proxyRateBucketForPath("/rest/v1/datasets").endpoint).toBe("proxy-rest");
  });
});
