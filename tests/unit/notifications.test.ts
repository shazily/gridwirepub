import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn().mockResolvedValue(undefined);
const emailDeliveryConfigured = vi.fn().mockReturnValue(true);
const insertSingle = vi.fn().mockResolvedValue({ data: { id: "alert-1" }, error: null });

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "alert_events") {
        return {
          insert: () => ({
            select: () => ({
              single: () => insertSingle(),
            }),
          }),
        };
      }
      if (table === "email_ingest_notification_recipients") {
        return {
          select: () => ({
            eq: () => ({
              eq: () =>
                Promise.resolve({
                  data: [{ email: "ops@corp.com" }],
                  error: null,
                }),
            }),
          }),
        };
      }
      return {};
    },
  },
}));

vi.mock("@/lib/email.server", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  emailDeliveryConfigured: (...args: unknown[]) => emailDeliveryConfigured(...args),
}));

import {
  emailIngestSeverity,
  extractEmailAddress,
  isEmailIngestFailure,
  isEmailIngestSuccess,
  notifyEmailIngestOutcome,
  notifyEmailIngestSenderRejection,
} from "@/lib/notifications.server";

describe("notifications.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emailDeliveryConfigured.mockReturnValue(true);
    sendEmail.mockResolvedValue(undefined);
    insertSingle.mockResolvedValue({ data: { id: "alert-1" }, error: null });
  });

  it("classifies ingest success statuses", () => {
    expect(isEmailIngestSuccess("ingested")).toBe(true);
    expect(isEmailIngestSuccess("accepted_pending_ingest")).toBe(true);
    expect(isEmailIngestSuccess("rejected_sender")).toBe(false);
  });

  it("classifies ingest failure statuses", () => {
    expect(isEmailIngestFailure("rejected_sender")).toBe(true);
    expect(isEmailIngestFailure("rejected_schema_mismatch")).toBe(true);
    expect(isEmailIngestFailure("rejected_template")).toBe(true);
    expect(isEmailIngestFailure("quarantined")).toBe(true);
    expect(isEmailIngestFailure("ingest_failed")).toBe(true);
    expect(isEmailIngestFailure("ingested")).toBe(false);
    expect(isEmailIngestFailure("pending_pdf_review")).toBe(false);
  });

  it("maps severity from status", () => {
    expect(emailIngestSeverity("ingested")).toBe("info");
    expect(emailIngestSeverity("rejected_sender")).toBe("error");
    expect(emailIngestSeverity("received")).toBe("warning");
  });

  it("extracts email from From headers", () => {
    expect(extractEmailAddress("analyst@corp.com")).toBe("analyst@corp.com");
    expect(extractEmailAddress("Analyst <analyst@corp.com>")).toBe("analyst@corp.com");
    expect(extractEmailAddress("")).toBeNull();
  });

  it("emails the sender with the rejection reason", async () => {
    await notifyEmailIngestSenderRejection({
      fromAddress: "Analyst <analyst@corp.com>",
      status: "rejected_template",
      detail: 'No curated PDF structure template matches "statement.pdf".',
      subject: "Jan statement",
      attachmentName: "statement.pdf",
    });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "analyst@corp.com",
        purpose: "noreply",
        tag: "email-ingest-sender-reject",
        text: expect.stringContaining("No curated PDF structure template"),
      }),
    );
  });

  it("on failure notifies receivers and the sender with Reason", async () => {
    await notifyEmailIngestOutcome({
      orgId: "11111111-1111-1111-1111-111111111111",
      status: "rejected_template",
      fromAddress: "analyst@corp.com",
      subject: "Jan statement",
      attachmentName: "statement.pdf",
      detail: 'No curated PDF structure template matches "statement.pdf".',
    });

    expect(insertSingle).toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ops@corp.com",
        tag: "email-ingest-failure",
        text: expect.stringContaining("Reason: No curated PDF structure template"),
      }),
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "analyst@corp.com",
        tag: "email-ingest-sender-reject",
        text: expect.stringContaining("Reason: No curated PDF structure template"),
      }),
    );
  });

  it("does not email the sender on success", async () => {
    await notifyEmailIngestOutcome({
      orgId: "11111111-1111-1111-1111-111111111111",
      status: "ingested",
      fromAddress: "analyst@corp.com",
      detail: "Imported 10 rows",
      datasetId: "22222222-2222-2222-2222-222222222222",
    });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ops@corp.com",
        tag: "email-ingest-success",
      }),
    );
    expect(sendEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({ tag: "email-ingest-sender-reject" }),
    );
  });
});
