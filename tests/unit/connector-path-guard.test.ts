import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeConnectorPath,
  safeJoinUnderDir,
} from "../../src/lib/connector-path-guard.server";

describe("connector-path-guard", () => {
  it("rejects parent-directory segments", () => {
    expect(() => assertSafeConnectorPath("../etc/passwd")).toThrow(/parent-directory/);
  });

  it("rejects escape from allowed root", () => {
    const root = path.resolve("/tmp/gridwire-data");
    expect(() => assertSafeConnectorPath("/tmp/other/file.csv", root)).toThrow(/escapes allowed root/);
  });

  it("allows paths under the allowed root", () => {
    const root = path.resolve("/tmp/gridwire-data");
    const resolved = assertSafeConnectorPath(path.join(root, "inbox"), root);
    expect(resolved).toBe(path.resolve(root, "inbox"));
  });

  it("safeJoinUnderDir rejects nested names", () => {
    expect(() => safeJoinUnderDir("/data", "../secret")).toThrow(/invalid/);
    expect(safeJoinUnderDir("/data", "ok.csv")).toBe(path.join("/data", "ok.csv"));
  });
});
