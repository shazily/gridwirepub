import { describe, expect, it } from "vitest";
import {
  FEATURE_SPOTLIGHTS,
  PLATFORM_FEATURES,
  PLATFORM_FEATURE_CATEGORIES,
  getFeatureById,
  getFeaturesByCategory,
  MARKETING_SLIDESHOW_FEATURE_IDS,
} from "@/lib/platform-features";

describe("platform-features catalog", () => {
  it("has features in every category", () => {
    for (const cat of PLATFORM_FEATURE_CATEGORIES) {
      expect(getFeaturesByCategory(cat.id).length).toBeGreaterThan(0);
    }
  });

  it("slideshow ids resolve to features", () => {
    for (const id of MARKETING_SLIDESHOW_FEATURE_IDS) {
      expect(getFeatureById(id)).toBeDefined();
    }
  });

  it("includes lineage capabilities", () => {
    const lineage = getFeaturesByCategory("lineage");
    expect(lineage.some((f) => f.id === "lineage-graph")).toBe(true);
    expect(lineage.some((f) => f.id === "lineage-api")).toBe(true);
  });

  it("has feature spotlights for lineage and email ingest", () => {
    expect(FEATURE_SPOTLIGHTS.map((s) => s.id)).toEqual(["lineage", "email-ingest"]);
    for (const s of FEATURE_SPOTLIGHTS) {
      expect(s.steps.length).toBe(4);
    }
  });

  it("uses unique feature ids", () => {
    const ids = PLATFORM_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
