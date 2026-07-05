import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

type MockState = {
  mailboxes: Row[];
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
    state = makeState({
      templates: [
        {
          ...makeState().templates[0]!,
          attachment_pattern: null,
        },
      ],
    });
    const result = await run({ from: "analyst@corp.com", attachments: [] });
    expect(result.status).toBe("rejected_template");
    expect(result.detail).toMatch(/attachment/i);
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
});
