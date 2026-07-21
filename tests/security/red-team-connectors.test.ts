/**
 * Adversarial / red-team probes for vault-adjacent secrets, public URL open redirects,
 * and connector path / host guards (NFS / SFTP / folder / CBFS-style).
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertConnectorHostAllowed } from "../../worker/src/connector-host-guard.js";
import { assertSafeConnectorPath } from "../../src/lib/connector-path-guard.server";
import { resolvePublicAppUrl, sanitizePasswordResetRedirect } from "../../src/lib/public-app-url.server";
import { assertSecurityBaselineProductionConfig } from "../../src/lib/secrets.server";
import { resolveRoleFromGroups } from "../../src/lib/ad-group-role";

describe("red-team: password reset open redirect", () => {
  it("never redirects recovery to a foreign origin", () => {
    const publicOrigin = "https://portal.gridwire.local";
    const evil = sanitizePasswordResetRedirect(
      "https://evil.example/reset-password?next=steal",
      publicOrigin,
    );
    expect(evil).toBe(`${publicOrigin}/reset-password`);
  });

  it("does not prefer loopback env over a public preferred redirect", () => {
    const prev = process.env.PUBLIC_APP_URL;
    process.env.PUBLIC_APP_URL = "http://127.0.0.1:3020";
    try {
      expect(
        resolvePublicAppUrl({
          preferredRedirect: "https://cf-tunnel.example/reset-password",
        }),
      ).toBe("https://cf-tunnel.example");
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_APP_URL;
      else process.env.PUBLIC_APP_URL = prev;
    }
  });
});

describe("red-team: connector path traversal (folder/NFS/CBFS)", () => {
  it("blocks classic traversal payloads", () => {
    const payloads = [
      "../../etc/passwd",
      "/var/lib/gridwire/../../etc/shadow",
      "inbox/../../secret.key",
    ];
    for (const p of payloads) {
      expect(() => assertSafeConnectorPath(p)).toThrow();
    }
  });

  it("blocks jailbreak when CONNECTOR_ALLOWED_ROOT is set", () => {
    const root = path.resolve("/opt/gridwire/ingest");
    expect(() => assertSafeConnectorPath("/etc/hostname", root)).toThrow(/escapes/);
  });
});

describe("red-team: SFTP SSRF host guard", () => {
  const prev = process.env.ALLOW_INTERNAL_CONNECTOR_HOSTS;

  afterEach(() => {
    if (prev === undefined) delete process.env.ALLOW_INTERNAL_CONNECTOR_HOSTS;
    else process.env.ALLOW_INTERNAL_CONNECTOR_HOSTS = prev;
  });

  it("blocks metadata and loopback targets by default", async () => {
    delete process.env.ALLOW_INTERNAL_CONNECTOR_HOSTS;
    await expect(assertConnectorHostAllowed("169.254.169.254")).rejects.toThrow(/blocked/);
    await expect(assertConnectorHostAllowed("127.0.0.1")).rejects.toThrow(/blocked/);
    await expect(assertConnectorHostAllowed("10.0.0.1")).rejects.toThrow(/blocked/);
  });
});

describe("red-team: vault / field encryption baseline", () => {
  it("fails closed in production without FIELD_ENCRYPTION_KEY", () => {
    const prevNode = process.env.NODE_ENV;
    const prevKey = process.env.FIELD_ENCRYPTION_KEY;
    const prevWh = process.env.INBOUND_WEBHOOK_SECRET;
    const prevWorker = process.env.WORKER_INGEST_TOKEN;
    const prevMetrics = process.env.METRICS_TOKEN;
    process.env.NODE_ENV = "production";
    delete process.env.FIELD_ENCRYPTION_KEY;
    process.env.INBOUND_WEBHOOK_SECRET = "x".repeat(32);
    process.env.WORKER_INGEST_TOKEN = "y".repeat(32);
    process.env.METRICS_TOKEN = "z".repeat(32);
    try {
      expect(() => assertSecurityBaselineProductionConfig()).toThrow(/FIELD_ENCRYPTION_KEY/);
    } finally {
      process.env.NODE_ENV = prevNode;
      if (prevKey === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
      else process.env.FIELD_ENCRYPTION_KEY = prevKey;
      if (prevWh === undefined) delete process.env.INBOUND_WEBHOOK_SECRET;
      else process.env.INBOUND_WEBHOOK_SECRET = prevWh;
      if (prevWorker === undefined) delete process.env.WORKER_INGEST_TOKEN;
      else process.env.WORKER_INGEST_TOKEN = prevWorker;
      if (prevMetrics === undefined) delete process.env.METRICS_TOKEN;
      else process.env.METRICS_TOKEN = prevMetrics;
    }
  });
});

describe("red-team: AD group claim injection", () => {
  it("does not escalate to owner via injected claim names", () => {
    const role = resolveRoleFromGroups(
      ["owner", "CN=Domain Admins"],
      [
        { group: "Finance", role: "member" },
        { group: "IT", role: "admin" },
      ],
    );
    expect(role).toBeNull();
  });
});
