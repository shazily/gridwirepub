import { describe, expect, it } from "vitest";
import {
  INGEST_STATUS_LABELS,
  isValidIngestEmail,
  suggestIngestAddress,
} from "@/lib/ingest-email";

describe("ingest-email helpers", () => {
  it("suggests slug-based address", () => {
    expect(suggestIngestAddress("Finance Team", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(
      "finance-team@ingest.local",
    );
  });

  it("falls back to org id prefix when slug empty", () => {
    expect(suggestIngestAddress("", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(
      "ingest-aaaaaaaa@ingest.local",
    );
  });

  it("validates email format", () => {
    expect(isValidIngestEmail("reports@ingest.example.com")).toBe(true);
    expect(isValidIngestEmail("not-an-email")).toBe(false);
  });

  it("labels all ingest statuses for admin UI", () => {
    expect(INGEST_STATUS_LABELS.ingested).toContain("Imported");
    expect(INGEST_STATUS_LABELS.ingest_failed).toContain("Import failed");
    expect(INGEST_STATUS_LABELS.quarantined).toContain("Quarantined");
    expect(INGEST_STATUS_LABELS.rejected_schema_mismatch).toContain("columns");
  });
});
