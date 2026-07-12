import { describe, expect, it, afterEach } from "vitest";
import {
  formatBytesShort,
  pdfParseLlmTimeoutMs,
  pdfParseMaxBytes,
  pdfParseMaxConcurrentPerOrg,
  pdfParseStructureMaxChars,
  pdfParseStructureMaxPages,
} from "@/lib/pdf-parse-limits.server";

describe("pdf-parse-limits", () => {
  const keys = [
    "PDF_PARSE_MAX_BYTES",
    "PDF_PARSE_MAX_CONCURRENT_PER_ORG",
    "PDF_PARSE_LLM_TIMEOUT_MS",
    "PDF_PARSE_STRUCTURE_MAX_PAGES",
    "PDF_PARSE_STRUCTURE_MAX_CHARS",
  ] as const;
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  function snapshot() {
    for (const k of keys) prev[k] = process.env[k];
  }

  it("defaults protect the portal", () => {
    snapshot();
    for (const k of keys) delete process.env[k];
    expect(pdfParseMaxBytes()).toBe(25 * 1024 * 1024);
    expect(pdfParseMaxConcurrentPerOrg()).toBe(2);
    expect(pdfParseLlmTimeoutMs()).toBe(120_000);
    expect(pdfParseStructureMaxPages()).toBe(2);
    expect(pdfParseStructureMaxChars()).toBe(8_000);
    expect(formatBytesShort(25 * 1024 * 1024)).toBe("25 MB");
  });

  it("honors env overrides", () => {
    snapshot();
    process.env.PDF_PARSE_MAX_BYTES = "1048576";
    process.env.PDF_PARSE_MAX_CONCURRENT_PER_ORG = "3";
    process.env.PDF_PARSE_LLM_TIMEOUT_MS = "30000";
    process.env.PDF_PARSE_STRUCTURE_MAX_PAGES = "1";
    process.env.PDF_PARSE_STRUCTURE_MAX_CHARS = "4000";
    expect(pdfParseMaxBytes()).toBe(1_048_576);
    expect(pdfParseMaxConcurrentPerOrg()).toBe(3);
    expect(pdfParseLlmTimeoutMs()).toBe(30_000);
    expect(pdfParseStructureMaxPages()).toBe(1);
    expect(pdfParseStructureMaxChars()).toBe(4_000);
  });
});
