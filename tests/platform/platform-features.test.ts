/**
 * Platform feature checklist — run with: npm test -- tests/platform/platform-features.test.ts
 * HTTP checks require GRIDWIRE_PORTAL_URL (default http://127.0.0.1:3020).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PORTAL = process.env.GRIDWIRE_PORTAL_URL ?? "http://127.0.0.1:3020";

function inboundWebhookSecret(): string | undefined {
  const fromEnv = process.env.INBOUND_WEBHOOK_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const envFile = join(import.meta.dirname, "..", "..", ".env");
  if (!existsSync(envFile)) return undefined;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*INBOUND_WEBHOOK_SECRET=(.*)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

async function get(path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${PORTAL}${path}`, { redirect: "follow" });
  const body = await res.text();
  return { status: res.status, body };
}

describe("platform feature routes", () => {
  it("health endpoint is ok", async () => {
    const { status, body } = await get("/api/public/health");
    expect(status).toBe(200);
    expect(body).toContain('"status":"ok"');
  });

  it("marketing page highlights governed email ingest and lineage", async () => {
    const { status, body } = await get("/");
    expect(status).toBe(200);
    expect(body).toMatch(/spreadsheet|secure production API/i);
    expect(body).toMatch(/email|ingest|warehouse|inbox/i);
    expect(body).toMatch(/lineage/i);
    if (body.includes("What's new") || body.includes("What&apos;s new")) {
      expect(body).toMatch(/Governed email|email-to-warehouse|email ingest/i);
      expect(body).toMatch(/lineage/i);
    }
  });

  it("features page lists platform capabilities", async () => {
    const { status, body } = await get("/features");
    expect(status).toBe(200);
    expect(body).toMatch(/lineage/i);
    expect(body).toMatch(/email ingest|Governed email/i);
    expect(body).toMatch(/Data ingestion|Security|Workspace/i);
  });

  it("member routes respond (auth shell or redirect)", async () => {
    const storage = await get("/storage");
    const notifications = await get("/notifications");
    const feedback = await get("/feedback");
    for (const res of [storage, notifications, feedback]) {
      expect([200, 302, 307, 404]).toContain(res.status);
    }
  });

  it("portal branding API returns 404 for unknown slug", async () => {
    const res = await fetch(`${PORTAL}/api/public/portal/_gridwire_test_missing_`, {
      redirect: "follow",
    });
    expect(res.status).toBe(404);
  });

  it("readiness includes storage and optional clamav probe", async () => {
    const { status, body } = await get("/api/public/ready");
    expect(status).toBe(200);
    expect(body).toMatch(/storage/i);
    // Present after redeploy with ClamAV sidecar wiring
    if (body.includes('"clamav"')) {
      expect(body).toMatch(/"clamav":"(ok|unreachable|not_configured)"/);
    }
  });

  it("admin email ingest route is reachable", async () => {
    const res = await get("/admin/email-ingest");
    expect([200, 302, 307]).toContain(res.status);
  });

  it("inbound webhook accepts POST JSON", async () => {
    const secret = inboundWebhookSecret();
    expect(secret, "INBOUND_WEBHOOK_SECRET required for live portal webhook test").toBeTruthy();
    const res = await fetch(`${PORTAL}/api/public/inbound/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gridwire-Webhook-Secret": secret!,
      },
      body: JSON.stringify({
        From: "unknown@test.local",
        Subject: "Test",
        MessageID: `vitest-${Date.now()}`,
        Attachments: [],
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; status?: string };
    expect(json.ok).toBe(true);
    expect(json.status).toBeDefined();
  });
});
