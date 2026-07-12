import { describe, expect, it, afterEach } from "vitest";
import { envPdfParseMockEnabled, orgPdfParseMock } from "@/lib/llm-api-keys.server";

describe("orgPdfParseMock", () => {
  const prev = process.env.PDF_PARSE_MOCK;

  afterEach(() => {
    if (prev === undefined) delete process.env.PDF_PARSE_MOCK;
    else process.env.PDF_PARSE_MOCK = prev;
  });

  it("honors explicit org true/false", () => {
    process.env.PDF_PARSE_MOCK = "false";
    expect(orgPdfParseMock({ pdf_parse_mock: true })).toBe(true);
    process.env.PDF_PARSE_MOCK = "true";
    expect(orgPdfParseMock({ pdf_parse_mock: false })).toBe(false);
  });

  it("ignores env mock when an active LLM key is configured", () => {
    process.env.PDF_PARSE_MOCK = "true";
    expect(
      orgPdfParseMock({ active_llm_key_id: "11111111-1111-1111-1111-111111111111" }),
    ).toBe(false);
  });

  it("falls back to env when unset and no active key", () => {
    process.env.PDF_PARSE_MOCK = "true";
    expect(orgPdfParseMock({})).toBe(true);
    expect(envPdfParseMockEnabled()).toBe(true);
    process.env.PDF_PARSE_MOCK = "false";
    expect(orgPdfParseMock({})).toBe(false);
  });
});
