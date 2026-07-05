import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedWorkbook } from "@/lib/spreadsheet";

const publishMock = vi.fn().mockResolvedValue({
  datasetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  versionNo: 2,
  diff: { deviates: false, added: [], removed: [], type_changed: [], row_delta: 0 },
});

vi.mock("@/lib/publish.server", () => ({
  publishVersionServer: (...args: unknown[]) => publishMock(...args),
}));

vi.mock("@/lib/audit.server", () => ({
  logSystemAuditEvent: vi.fn(),
}));

function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  for (const method of ["select", "eq", "in", "order", "limit", "insert", "update"]) {
    builder[method] = () => self();
  }
  builder.maybeSingle = () => Promise.resolve(result);
  builder.single = () => Promise.resolve(result);
  builder.then = (resolve: (v: unknown) => void) => {
    resolve(result);
  };
  return builder;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "org_members") {
        return chain({ data: { user_id: "user-1", role: "owner" }, error: null });
      }
      if (table === "datasets") {
        return chain({ data: { name: "Finance reports" }, error: null });
      }
      if (table === "dataset_versions") {
        return chain({ data: { id: "ver-1" }, error: null });
      }
      if (table === "alert_events") {
        return chain({ data: null, error: null });
      }
      return chain({ data: null, error: null });
    },
  },
}));

const parsed: ParsedWorkbook = {
  fileName: "report.csv",
  hasMacros: false,
  sheets: [
    {
      name: "Sheet1",
      headers: [
        { original_name: "Customer ID", api_name: "customer_id", data_type: "string" },
        { original_name: "Amount", api_name: "amount", data_type: "number" },
      ],
      rows: [{ customer_id: "1", amount: 100 }],
      rowCount: 1,
      truncated: false,
    },
  ],
};

describe("importEmailIngestMessage", () => {
  beforeEach(() => {
    publishMock.mockClear();
  });

  it("publishes to target dataset when configured", async () => {
    const { importEmailIngestMessage } = await import("@/lib/email-ingest-import.server");
    const result = await importEmailIngestMessage({
      messageId: "msg-1",
      orgId: "org-1",
      template: {
        id: "tpl-1",
        name: "Monthly",
        target_dataset_id: "ds-existing",
        load_mode: "full",
        schema_snapshot: {
          sheet_name: "Sheet1",
          columns: [
            { api_name: "customer_id", original_name: "Customer ID" },
            { api_name: "amount", original_name: "Amount" },
          ],
        },
      },
      fileName: "report.csv",
      bytes: Buffer.from("a,b\n1,2"),
      parsed,
    });
    if (!result.ok) {
      expect.fail(`import failed: ${result.error}`);
    }
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetId: "ds-existing",
        loadMode: "full",
        fields: expect.arrayContaining([
          expect.objectContaining({ source_key: "customer_id", api_name: "customer_id" }),
        ]),
      }),
    );
  });
});
