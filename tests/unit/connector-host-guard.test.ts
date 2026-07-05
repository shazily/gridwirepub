import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertConnectorHostAllowed } from "../../worker/src/connector-host-guard.js";

describe("connector-host-guard", () => {
  const prevAllow = process.env.ALLOW_INTERNAL_CONNECTOR_HOSTS;

  beforeEach(() => {
    delete process.env.ALLOW_INTERNAL_CONNECTOR_HOSTS;
  });

  afterEach(() => {
    if (prevAllow === undefined) delete process.env.ALLOW_INTERNAL_CONNECTOR_HOSTS;
    else process.env.ALLOW_INTERNAL_CONNECTOR_HOSTS = prevAllow;
  });

  it("blocks literal private IPv4 addresses", async () => {
    await expect(assertConnectorHostAllowed("10.0.0.5")).rejects.toThrow(/blocked/);
    await expect(assertConnectorHostAllowed("169.254.169.254")).rejects.toThrow(/blocked/);
    await expect(assertConnectorHostAllowed("127.0.0.1")).rejects.toThrow(/blocked/);
  });

  it("allows public IPv4 literals", async () => {
    await expect(assertConnectorHostAllowed("8.8.8.8")).resolves.toBeUndefined();
  });

  it("allows internal hosts when ALLOW_INTERNAL_CONNECTOR_HOSTS=true", async () => {
    process.env.ALLOW_INTERNAL_CONNECTOR_HOSTS = "true";
    await expect(assertConnectorHostAllowed("10.0.0.5")).resolves.toBeUndefined();
  });
});
