import { afterEach, describe, expect, it } from "vitest";
import {
  buildPortalRecoveryLink,
  isLoopbackUrl,
  resolvePublicAppUrl,
  sanitizePasswordResetRedirect,
} from "../../src/lib/public-app-url.server";

describe("public-app-url", () => {
  const prevPublic = process.env.PUBLIC_APP_URL;
  const prevSite = process.env.SITE_URL;

  afterEach(() => {
    if (prevPublic === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = prevPublic;
    if (prevSite === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = prevSite;
  });

  it("detects loopback hosts", () => {
    expect(isLoopbackUrl("http://127.0.0.1:3020")).toBe(true);
    expect(isLoopbackUrl("https://data.example.com")).toBe(false);
  });

  it("prefers non-loopback PUBLIC_APP_URL", () => {
    process.env.PUBLIC_APP_URL = "https://grid.example.com";
    expect(resolvePublicAppUrl()).toBe("https://grid.example.com");
  });

  it("falls back to preferredRedirect origin when env is loopback", () => {
    process.env.PUBLIC_APP_URL = "http://127.0.0.1:3020";
    expect(
      resolvePublicAppUrl({
        preferredRedirect: "https://tunnel.example.com/reset-password",
      }),
    ).toBe("https://tunnel.example.com");
  });

  it("honors explicit org override when not loopback", () => {
    process.env.PUBLIC_APP_URL = "http://127.0.0.1:3020";
    expect(
      resolvePublicAppUrl({
        explicitOverride: "https://org.example.com",
        preferredRedirect: "https://tunnel.example.com/reset-password",
      }),
    ).toBe("https://org.example.com");
  });

  it("sanitizes open redirects off the public origin", () => {
    const origin = "https://grid.example.com";
    expect(sanitizePasswordResetRedirect("https://evil.com/reset-password", origin)).toBe(
      "https://grid.example.com/reset-password",
    );
    expect(sanitizePasswordResetRedirect("https://grid.example.com/reset-password", origin)).toBe(
      "https://grid.example.com/reset-password",
    );
  });

  it("builds portal recovery links with token_hash", () => {
    const link = buildPortalRecoveryLink("abc123", "https://grid.example.com");
    expect(link).toContain("https://grid.example.com/reset-password?");
    expect(link).toContain("token_hash=abc123");
    expect(link).toContain("type=recovery");
    expect(link).not.toContain("127.0.0.1");
    expect(link).not.toContain(":3040");
  });
});
