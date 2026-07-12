import { describe, expect, it } from "vitest";
import { toUserFacingMessage } from "@/lib/user-facing-error";

describe("toUserFacingMessage", () => {
  it("maps pdf worker / bundler failures", () => {
    const msg = toUserFacingMessage(
      new Error(
        `Setting up fake worker failed: "Cannot find module '/app/.output/server/_libs/pdf.worker.mjs' imported from /app/.output/server/_libs/pdfjs-dist.mjs".`,
      ),
    );
    expect(msg).toMatch(/couldn't open this PDF/i);
    expect(msg).not.toMatch(/\.output|pdf\.worker/);
  });

  it("maps LLM auth failures", () => {
    expect(toUserFacingMessage(new Error("LLM request failed (401): Incorrect API key"))).toMatch(
      /rejected the API key/i,
    );
  });

  it("maps mock-mode PDF failures", () => {
    expect(
      toUserFacingMessage(
        new Error("PDF_PARSE_MOCK: no mock JSON marker or pipe-delimited table found in PDF text"),
      ),
    ).toMatch(/mock\/test mode/i);
  });

  it("maps PostgREST single-row conflicts", () => {
    expect(
      toUserFacingMessage(new Error("JSON object requested, multiple (or no) rows returned")),
    ).toMatch(/conflict|refresh|upload again/i);
  });
});
