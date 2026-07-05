import { describe, expect, it } from "vitest";
import {
  emailIngestSeverity,
  isEmailIngestFailure,
  isEmailIngestSuccess,
} from "@/lib/notifications.server";

describe("notifications.server", () => {
  it("classifies ingest success statuses", () => {
    expect(isEmailIngestSuccess("ingested")).toBe(true);
    expect(isEmailIngestSuccess("accepted_pending_ingest")).toBe(true);
    expect(isEmailIngestSuccess("rejected_sender")).toBe(false);
  });

  it("classifies ingest failure statuses", () => {
    expect(isEmailIngestFailure("rejected_sender")).toBe(true);
    expect(isEmailIngestFailure("rejected_schema_mismatch")).toBe(true);
    expect(isEmailIngestFailure("quarantined")).toBe(true);
    expect(isEmailIngestFailure("ingest_failed")).toBe(true);
    expect(isEmailIngestFailure("ingested")).toBe(false);
  });

  it("maps severity from status", () => {
    expect(emailIngestSeverity("ingested")).toBe("info");
    expect(emailIngestSeverity("rejected_sender")).toBe("error");
    expect(emailIngestSeverity("received")).toBe("warning");
  });
});
