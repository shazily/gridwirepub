import { describe, expect, it, afterEach } from "vitest";
import { resolvePublicOrigin } from "@/lib/api-serve.server";

function requestWith(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("resolvePublicOrigin", () => {
  const prevPublic = process.env.PUBLIC_APP_URL;
  const prevSite = process.env.SITE_URL;

  afterEach(() => {
    if (prevPublic === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = prevPublic;
    if (prevSite === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = prevSite;
  });

  it("prefers PUBLIC_APP_URL from deployment env", () => {
    process.env.PUBLIC_APP_URL = "https://data.example.com/";
    const origin = resolvePublicOrigin(requestWith("http://127.0.0.1:3020/api/v1/datasets/x/openapi.json"));
    expect(origin).toBe("https://data.example.com");
  });

  it("falls back to forwarded headers when env unset", () => {
    delete process.env.PUBLIC_APP_URL;
    delete process.env.SITE_URL;
    const origin = resolvePublicOrigin(
      requestWith("http://portal:3000/api/v1/datasets/x/openapi.json", {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "data.example.com",
      }),
    );
    expect(origin).toBe("https://data.example.com");
  });

  it("falls back to request URL origin for local dev", () => {
    delete process.env.PUBLIC_APP_URL;
    delete process.env.SITE_URL;
    const origin = resolvePublicOrigin(requestWith("http://127.0.0.1:3020/api/v1/datasets/x/openapi.json"));
    expect(origin).toBe("http://127.0.0.1:3020");
  });
});
