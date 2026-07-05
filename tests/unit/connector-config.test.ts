import { describe, expect, it } from "vitest";
import {
  connectorConfigContainsCredentials,
  sanitizeConnectorConfigForStorage,
  stripConnectorConfigForWorker,
} from "@/lib/connector-config";

describe("connector-config", () => {
  it("strips credential keys from storage config", () => {
    const out = sanitizeConnectorConfigForStorage({
      host: "sftp.example.com",
      username: "svc",
      password: "secret",
      privateKey: "key-material",
    });
    expect(out).toEqual({ host: "sftp.example.com", username: "svc" });
    expect(connectorConfigContainsCredentials({ password: "x" })).toBe(true);
  });

  it("returns only safe fields for worker API", () => {
    const out = stripConnectorConfigForWorker({
      host: "sftp.example.com",
      path: "/exports/*.xlsx",
      port: 22,
      username: "svc",
      password: "must-not-leak",
    });
    expect(out).toEqual({
      host: "sftp.example.com",
      path: "/exports/*.xlsx",
      port: 22,
      username: "svc",
    });
    expect(out).not.toHaveProperty("password");
  });
});
