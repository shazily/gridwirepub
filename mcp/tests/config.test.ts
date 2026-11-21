import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
  test("requires base URL and API key", () => {
    expect(() => loadConfig({})).toThrow(/GRIDWIRE_BASE_URL/);
    expect(() =>
      loadConfig({ GRIDWIRE_BASE_URL: "https://portal.example" }),
    ).toThrow(/GRIDWIRE_API_KEY/);
  });

  test("parses allowlist", () => {
    const cfg = loadConfig({
      GRIDWIRE_BASE_URL: "https://portal.example/",
      GRIDWIRE_API_KEY: "gw_test_key_12345678",
      GRIDWIRE_DATASET_IDS: "11111111-1111-1111-1111-111111111111, 22222222-2222-2222-2222-222222222222",
    });
    expect(cfg.baseUrl).toBe("https://portal.example");
    expect(cfg.datasetAllowlist?.size).toBe(2);
    expect(cfg.datasetAllowlist?.has("11111111-1111-1111-1111-111111111111")).toBe(true);
  });
});
