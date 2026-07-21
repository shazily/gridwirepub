import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

type MockState = {
  mailboxes: Row[];
  aliases: Row[];
  senders: Row[];
  templates: Row[];
  messages: Row[];
};

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const MSG_ID = "22222222-2222-2222-2222-222222222222";
const TEMPLATE_ID = "33333333-3333-3333-3333-333333333333";

const validCsvBase64 = Buffer.from("Customer ID,Amount\n1,100\n").toString("base64");

const templateSchema = {
  sheet_name: "Sheet1",
  columns: [
    { api_name: "customer_id", original_name: "Customer ID" },
    { api_name: "amount", original_name: "Amount" },
  ],
};

function makeState(overrides: Partial<MockState> = {}): MockState {
  return {
    mailboxes: [
      {
        org_id: ORG_ID,
        inbound_address: "reports@ingest.local",
        enabled: true,
      },
    ],
    aliases: [],
    senders: [{ org_id: ORG_ID, email_pattern: "analyst@corp.com" }],
    templates: [
      {
        id: TEMPLATE_ID,
        org_id: ORG_ID,
        name: "Monthly",
        subject_pattern: null,
        attachment_pattern: "*.csv",
        schema_snapshot: templateSchema,
        active: true,
      },
    ],
    messages: [],
    ...overrides,
  };
}


function createMockSupabase(getState: () => MockState) {
  class Builder {
    private table = "";
    private filters: Array<[string, unknown]> = [];
    private op: "select" | "insert" | "update" = "select";
    private insertPayload: Row | null = null;
    private updatePayload: Row | null = null;
    private limitN: number | null = null;

    constructor(table: string) {
      this.table = table;
    }

    select(_cols?: string) {
      return this;
    }

    insert(payload: Row) {
      this.op = "insert";
      this.insertPayload = payload;
      return this;
    }

    update(payload: Row) {
      this.op = "update";
      this.updatePayload = payload;
      return this;
    }

    eq(col: string, val: unknown) {
      this.filters.push([col, val]);
      return this;
    }

    limit(n: number) {
      this.limitN = n;
      return this;
    }

    maybeSingle() {
      return this.single(true);
    }

    single(allowNull = false) {
      const state = getState();
      const rows = this.rowsForTable(state);
      const filtered = this.applyFilters(rows);
      if (this.op === "insert" && this.insertPayload) {
        const row = { id: MSG_ID, ...this.insertPayload };
        if (this.table === "email_ingest_messages") state.messages.push(row);
        return Promise.resolve({ data: row, error: null });
      }
      if (filtered.length === 0) {
        return Promise.resolve({
          data: allowNull ? null : null,
          error: allowNull ? null : { message: "not found", code: "PGRST116" },
        });
      }
      return Promise.resolve({ data: filtered[0], error: null });
    }

    then(resolve: (v: unknown) => void) {
      void this.execute().then(resolve);
    }

    private rowsForTable(state: MockState): Row[] {
      switch (this.table) {
        case "email_ingest_mailboxes":
          return state.mailboxes;
        case "email_ingest_mailbox_aliases":
          return state.aliases;
        case "email_ingest_sender_allowlist":
          return state.senders;
        case "email_ingest_templates":
          return state.templates;
        case "email_ingest_messages":
          return state.messages;
        default:
          return [];
      }
    }

    private applyFilters(rows: Row[]): Row[] {
      let out = rows;
      for (const [col, val] of this.filters) {
        out = out.filter((r) => r[col] === val);
      }
      if (this.limitN != null) out = out.slice(0, this.limitN);
      return out;
    }

    private async execute() {
      const state = getState();
      if (this.op === "update" && this.updatePayload) {
        const idFilter = this.filters.find(([c]) => c === "id");
        if (idFilter && this.table === "email_ingest_messages") {
          const idx = state.messages.findIndex((m) => m.id === idFilter[1]);
          if (idx >= 0) state.messages[idx] = { ...state.messages[idx], ...this.updatePayload };
        }
        return { data: null, error: null };
      }
      const rows = this.applyFilters(this.rowsForTable(state));
      return { data: rows, error: null };
    }
  }

  return {
    from(table: string) {
      return new Builder(table);
    },
    async rpc(fn: string, args?: Record<string, unknown>) {
      if (fn !== "resolve_email_ingest_org") {
        return { data: null, error: { message: `unknown rpc ${fn}` } };
      }
      const addr = String(args?._address ?? "")
        .trim()
        .toLowerCase();
      const s = getState();
      const primary = s.mailboxes.find(
        (m) => m.enabled === true && String(m.inbound_address).toLowerCase() === addr,
      );
      if (primary) return { data: primary.org_id, error: null };
      const alias = s.aliases.find((a) => String(a.inbound_address).toLowerCase() === addr);
      if (alias) {
        const mb = s.mailboxes.find((m) => m.org_id === alias.org_id && m.enabled === true);
        if (mb) return { data: alias.org_id, error: null };
      }
      return { data: null, error: null };
    },
  };
}

let state = makeState();

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: createMockSupabase(() => state),
}));

vi.mock("@/lib/audit.server", () => ({
  logSystemAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/email-ingest-import.server", () => ({
  storeEmailAttachment: vi.fn().mockResolvedValue("email-ingest/test/ref"),
  importEmailIngestMessage: vi.fn().mockResolvedValue({
    ok: true,
    datasetId: "44444444-4444-4444-4444-444444444444",
    versionId: "55555555-5555-5555-5555-555555555555",
    versionNo: 1,
    rowCount: 1,
  }),
}));

vi.mock("@/lib/clamav.server", () => ({
  scanBytesWithClamav: vi.fn().mockResolvedValue({ clean: true, detail: "scan_skipped" }),
}));

vi.mock("@/lib/quota.server", () => ({
  getOrgMaxUploadBytes: vi.fn().mockResolvedValue(50_000_000),
  getOrgMaxRowsPerSheet: vi.fn().mockResolvedValue(5000),
}));

const notifyEmailIngestOutcome = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/notifications.server", () => ({
  notifyEmailIngestOutcome: (...args: unknown[]) => notifyEmailIngestOutcome(...args),
}));

const findMatchingPdfTemplate = vi.fn();
const createPdfIngestDraft = vi.fn();
const assertPdfIngestCapacity = vi.fn().mockResolvedValue(undefined);
const raisePdfReadyAlert = vi.fn().mockResolvedValue(undefined);
const extractPdfDataWithStructure = vi.fn();

vi.mock("@/lib/pdf-templates.server", () => ({
  findMatchingPdfTemplate: (...args: unknown[]) => findMatchingPdfTemplate(...args),
}));

vi.mock("@/lib/pdf-ingest-draft.server", () => ({
  assertPdfIngestCapacity: (...args: unknown[]) => assertPdfIngestCapacity(...args),
  createPdfIngestDraft: (...args: unknown[]) => createPdfIngestDraft(...args),
  raisePdfReadyAlert: (...args: unknown[]) => raisePdfReadyAlert(...args),
}));

vi.mock("@/lib/pdf-parse.ai.server", () => ({
  extractPdfDataWithStructure: (...args: unknown[]) => extractPdfDataWithStructure(...args),
}));

vi.mock("@/lib/user-facing-error", () => ({
  logServer: vi.fn(),
  logServerError: vi.fn(),
}));

describe("processInboundPostmarkEmail pipeline", () => {
  beforeEach(() => {
    state = makeState();
    vi.clearAllMocks();
  });

  async function run(args: {
    from: string;
    subject?: string;
    attachments?: { name: string; contentType: string; contentBase64: string }[];
    mailboxHash?: string;
  }) {
    const { processInboundPostmarkEmail } = await import("@/lib/email-inbound.server");
    return processInboundPostmarkEmail({
      from: args.from,
      subject: args.subject ?? "Monthly report",
      mailboxHash: args.mailboxHash ?? "reports@ingest.local",
      attachments: args.attachments ?? [
        { name: "report.csv", contentType: "text/csv", contentBase64: validCsvBase64 },
      ],
      testMode: true,
    });
  }

  it("accepts valid sender, template, and matching CSV columns", async () => {
    const result = await run({ from: "analyst@corp.com" });
    expect(result.status).toBe("ingested");
    expect(state.messages.some((m) => m.status === "ingested")).toBe(true);
  });

  it("rejects when mailbox disabled or missing", async () => {
    state = makeState({ mailboxes: [] });
    const result = await run({ from: "analyst@corp.com" });
    expect(result.status).toBe("rejected_no_mailbox");
  });

  it("rejects sender not on allowlist", async () => {
    const result = await run({ from: "stranger@evil.com" });
    expect(result.status).toBe("rejected_sender");
    const msg = state.messages.find((m) => m.id === MSG_ID);
    expect(msg?.rejection_reason).toMatch(/not allowlisted/i);
  });

  it("rejects when no spreadsheet attachment", async () => {
    const result = await run({ from: "analyst@corp.com", attachments: [] });
    expect(result.status).toBe("rejected_no_attachment");
    expect(result.detail).toMatch(/Excel\/CSV\/PDF/i);
  });

  it("rejects schema mismatch (extra column)", async () => {
    const badCsv = Buffer.from("Customer ID,Amount,Extra\n1,2,x\n").toString("base64");
    const result = await run({
      from: "analyst@corp.com",
      attachments: [{ name: "bad.csv", contentType: "text/csv", contentBase64: badCsv }],
    });
    expect(result.status).toBe("rejected_schema_mismatch");
  });

  it("rejects when no active template matches", async () => {
    state = makeState({ templates: [] });
    const result = await run({ from: "analyst@corp.com" });
    expect(result.status).toBe("rejected_template");
  });

  it("rejects emailed PDF without a curated PDF structure template", async () => {
    findMatchingPdfTemplate.mockResolvedValue(null);
    const result = await run({
      from: "analyst@corp.com",
      attachments: [
        {
          name: "statement.pdf",
          contentType: "application/pdf",
          contentBase64: Buffer.from("%PDF-1.4").toString("base64"),
        },
      ],
    });
    expect(result.status).toBe("rejected_template");
    expect(result.detail).toMatch(/curated PDF structure template/i);
    expect(extractPdfDataWithStructure).not.toHaveBeenCalled();
    expect(notifyEmailIngestOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "rejected_template",
        fromAddress: "analyst@corp.com",
        attachmentName: "statement.pdf",
        detail: expect.stringMatching(/curated PDF structure template/i),
      }),
    );
  });

  it("stages emailed PDF for review when a structure template matches", async () => {
    const PDF_TEMPLATE_ID = "66666666-6666-6666-6666-666666666666";
    const DRAFT_ID = "77777777-7777-7777-7777-777777777777";
    findMatchingPdfTemplate.mockResolvedValue({
      id: PDF_TEMPLATE_ID,
      name: "Bank statement",
      file_name_pattern: "*statement*.pdf",
      structure_snapshot: { tables: [{ name: "Tx", headers: ["Date", "Amount"], sample_rows: [] }] },
      target_dataset_id: null,
    });
    extractPdfDataWithStructure.mockResolvedValue({
      workbook: {
        fileName: "statement.pdf",
        sheets: [{ name: "Tx", headers: [{ api_name: "date" }], rows: [{ date: "2024-01-01" }] }],
        hasMacros: false,
      },
      meta: { format: "pdf", parser: "text-extract", aiModel: "text-extract" },
    });
    createPdfIngestDraft.mockResolvedValue({ id: DRAFT_ID });

    const result = await run({
      from: "analyst@corp.com",
      attachments: [
        {
          name: "jan_statement.pdf",
          contentType: "application/pdf",
          contentBase64: Buffer.from("%PDF-1.4 fake").toString("base64"),
        },
      ],
    });

    expect(result.status).toBe("pending_pdf_review");
    expect(findMatchingPdfTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "jan_statement.pdf", orgId: ORG_ID }),
    );
    expect(extractPdfDataWithStructure).toHaveBeenCalled();
    expect(createPdfIngestDraft).toHaveBeenCalledWith(
      expect.objectContaining({ source: "email", fileName: "jan_statement.pdf" }),
    );
    expect(result.detail).toMatch(/Bank statement/);
  });
});
