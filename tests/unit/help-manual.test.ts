import { describe, expect, it } from "vitest";
import { searchHelp } from "../../src/lib/help-manual";

describe("help-manual search", () => {
  it("finds password reset / postmark articles", () => {
    const { articles, faqs } = searchHelp("postmark password reset");
    expect(articles.some((a) => a.id === "password-reset-email")).toBe(true);
    expect(faqs.some((f) => /Forgot password/i.test(f.q))).toBe(true);
  });

  it("finds SMTP stub caveat", () => {
    const { articles } = searchHelp("smtp admin authentication");
    expect(articles.some((a) => a.id === "authentication-email" || a.id === "password-reset-email")).toBe(
      true,
    );
  });

  it("returns all when query empty", () => {
    const { articles, faqs } = searchHelp("");
    expect(articles.length).toBeGreaterThan(5);
    expect(faqs.length).toBeGreaterThan(3);
  });
});
