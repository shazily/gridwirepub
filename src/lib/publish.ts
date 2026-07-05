import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { slugify } from "@/lib/spreadsheet";
import { raiseAlertEvents } from "@/lib/alerts.functions";
import { logAuditEvent } from "@/lib/audit.functions";
import { indexMergedRows, mergeRowsByKey, type RowRecord } from "@/lib/incremental-merge";

export type HashAlgo =
  | "sha256"
  | "sha512"
  | "sha3_256"
  | "sha3_512"
  | "hmac_sha256"
  | "hmac_sha512";

export type PublishField = {
  source_key: string;
  sheet_name: string;
  original_name: string;
  api_name: string;
  data_type: string;
  nullable: boolean;
  is_pii: boolean;
  masking: "none" | "mask" | "hash" | "encrypt";
  hash_algo?: HashAlgo;
  included: boolean;
  is_key?: boolean;
  position: number;
};

export type PublishSheet = {
  name: string;
  included: boolean;
  rows: Record<string, unknown>[];
};

export type PublishInput = {
  orgId: string;
  datasetId?: string;
  name: string;
  description?: string;
  fields: PublishField[];
  sheets: PublishSheet[];
  loadMode: "full" | "incremental";
  hasMacros: boolean;
  fileName: string;
  apiAccess?: "secure" | "public";
};

type SnapshotField = { api_name: string; data_type: string };
type Snapshot = { sheets: { name: string; fields: SnapshotField[] }[] };

function buildSnapshot(fields: PublishField[], sheets: PublishSheet[]): Snapshot {
  return {
    sheets: sheets
      .filter((s) => s.included)
      .map((s) => ({
        name: s.name,
        fields: fields
          .filter((f) => f.sheet_name === s.name && f.included)
          .map((f) => ({ api_name: f.api_name, data_type: f.data_type })),
      })),
  };
}

export type DiffSummary = {
  added: string[];
  removed: string[];
  type_changed: { field: string; from: string; to: string }[];
  row_delta: number;
  deviates: boolean;
};

function diffSnapshots(prev: Snapshot | null, next: Snapshot, prevRows: number, nextRows: number): DiffSummary {
  const flat = (s: Snapshot) =>
    new Map(s.sheets.flatMap((sh) => sh.fields.map((f) => [`${sh.name}.${f.api_name}`, f.data_type])));
  const prevMap = prev ? flat(prev) : new Map<string, string>();
  const nextMap = flat(next);
  const added: string[] = [];
  const removed: string[] = [];
  const type_changed: DiffSummary["type_changed"] = [];
  for (const [k, t] of nextMap) {
    if (!prevMap.has(k)) added.push(k);
    else if (prevMap.get(k) !== t) type_changed.push({ field: k, from: prevMap.get(k)!, to: t });
  }
  for (const k of prevMap.keys()) if (!nextMap.has(k)) removed.push(k);
  const deviates = added.length > 0 || removed.length > 0 || type_changed.length > 0;
  return { added, removed, type_changed, row_delta: nextRows - prevRows, deviates };
}

async function chunkInsert<T>(rows: T[], insert: (batch: T[]) => Promise<void>, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    await insert(rows.slice(i, i + size));
  }
}

export async function publishVersion(input: PublishInput): Promise<{ datasetId: string; versionNo: number; diff: DiffSummary }> {
  const includedSheets = input.sheets.filter((s) => s.included);
  const includedFields = input.fields.filter((f) => f.included && includedSheets.some((s) => s.name === f.sheet_name));
  const totalRows = includedSheets.reduce((acc, s) => acc + s.rows.length, 0);

  // 1. Ensure dataset
  let datasetId = input.datasetId;
  if (!datasetId) {
    const slug = `${slugify(input.name)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await supabase
      .from("datasets")
      .insert({
        org_id: input.orgId,
        name: input.name,
        slug,
        description: input.description ?? null,
        source_type: "upload",
        status: "draft",
        api_access: input.apiAccess ?? "secure",
      })
      .select("id")
      .single();
    if (error) throw error;
    datasetId = data.id;
  }

  // 2. Determine version number + previous snapshot
  const { data: prevVersions, error: pvErr } = await supabase
    .from("dataset_versions")
    .select("version_no, schema_snapshot, row_count")
    .eq("dataset_id", datasetId)
    .order("version_no", { ascending: false })
    .limit(1);
  if (pvErr) throw pvErr;
  const prev = prevVersions?.[0];
  const versionNo = (prev?.version_no ?? 0) + 1;
  const isBaseline = versionNo === 1;

  const snapshot = buildSnapshot(input.fields, input.sheets);
  const diff = diffSnapshots(
    (prev?.schema_snapshot as Snapshot) ?? null,
    snapshot,
    prev?.row_count ?? 0,
    totalRows,
  );

  // 3. Insert version
  const { data: version, error: vErr } = await supabase
    .from("dataset_versions")
    .insert({
      dataset_id: datasetId,
      org_id: input.orgId,
      version_no: versionNo,
      file_name: input.fileName,
      sheet_count: includedSheets.length,
      row_count: totalRows,
      schema_snapshot: snapshot as unknown as Json,
      load_mode: input.loadMode,
      is_baseline: isBaseline,
      diff_summary: isBaseline ? null : (diff as unknown as Json),
      has_macros: input.hasMacros,
    })
    .select("id")
    .single();
  if (vErr) throw vErr;
  const versionId = version.id;

  // 4. Insert fields
  const fieldRows = includedFields.map((f, idx) => ({
    version_id: versionId,
    org_id: input.orgId,
    sheet_name: f.sheet_name,
    original_name: f.original_name,
    api_name: f.api_name,
    data_type: f.data_type,
    nullable: f.nullable,
    is_pii: f.is_pii,
    masking: f.masking,
    hash_algo: f.hash_algo ?? "sha256",
    is_key: f.is_key ?? false,
    position: f.position ?? idx,
    included: true,
  }));
  if (fieldRows.length > 0) {
    const { error } = await supabase.from("dataset_fields").insert(fieldRows);
    if (error) throw error;
  }

  // 5. Insert rows (remap source_key -> api_name, included fields only)
  let dataRows: { version_id: string; org_id: string; sheet_name: string; row_index: number; data: Json }[] = [];
  const incomingRows: RowRecord[] = [];
  for (const sheet of includedSheets) {
    const sheetFields = includedFields.filter((f) => f.sheet_name === sheet.name);
    sheet.rows.forEach((row) => {
      const data: Record<string, unknown> = {};
      for (const f of sheetFields) data[f.api_name] = row[f.source_key] ?? null;
      incomingRows.push({ sheet_name: sheet.name, data });
    });
  }

  if (input.loadMode === "incremental" && input.datasetId && prev) {
    const { data: prevVersion } = await supabase
      .from("datasets")
      .select("current_version_id")
      .eq("id", datasetId)
      .maybeSingle();
    const prevVersionId = prevVersion?.current_version_id;
    if (prevVersionId) {
      const { data: prevKeyFields } = await supabase
        .from("dataset_fields")
        .select("sheet_name, api_name")
        .eq("version_id", prevVersionId)
        .eq("is_key", true);
      const { data: prevRows } = await supabase
        .from("dataset_rows")
        .select("sheet_name, data")
        .eq("version_id", prevVersionId);
      const keyFields =
        (prevKeyFields?.length ?? 0) > 0
          ? prevKeyFields!
          : includedFields.filter((f) => f.is_key).map((f) => ({ sheet_name: f.sheet_name, api_name: f.api_name }));
      if (keyFields.length > 0) {
        const merged = mergeRowsByKey(
          (prevRows ?? []).map((r) => ({ sheet_name: r.sheet_name, data: r.data as Record<string, unknown> })),
          incomingRows,
          keyFields,
        );
        dataRows = indexMergedRows(merged).map((r) => ({
          version_id: versionId,
          org_id: input.orgId,
          sheet_name: r.sheet_name,
          row_index: r.row_index,
          data: r.data as Json,
        }));
      }
    }
  }

  if (dataRows.length === 0) {
    for (const sheet of includedSheets) {
      const sheetFields = includedFields.filter((f) => f.sheet_name === sheet.name);
      sheet.rows.forEach((row, i) => {
        const data: Record<string, unknown> = {};
        for (const f of sheetFields) data[f.api_name] = row[f.source_key] ?? null;
        dataRows.push({ version_id: versionId, org_id: input.orgId, sheet_name: sheet.name, row_index: i, data: data as Json });
      });
    }
  }
  await chunkInsert(dataRows, async (batch) => {
    const { error } = await supabase.from("dataset_rows").insert(batch);
    if (error) throw error;
  });

  if (dataRows.length !== totalRows) {
    await supabase.from("dataset_versions").update({ row_count: dataRows.length }).eq("id", versionId);
  }

  // 6. Mark dataset published + current version
  const { error: uErr } = await supabase
    .from("datasets")
    .update({ current_version_id: versionId, status: "published" })
    .eq("id", datasetId);
  if (uErr) throw uErr;

  // 7. Raise alert events (best-effort; surfaced in the in-app Alerts feed).
  //    Written via a backend server function — alert_events is no longer
  //    client-writable, so members cannot inject arbitrary alert records.
  const alertEvents: {
    event_type: string;
    severity: "info" | "warning" | "error";
    title: string;
    body: string;
  }[] = [
    {
      event_type: "publish",
      severity: "info",
      title: `Dataset "${input.name}" published v${versionNo}`,
      body: `${totalRows} rows across ${includedSheets.length} sheet(s) from ${input.fileName}.`,
    },
  ];
  if (!isBaseline && diff.deviates) {
    alertEvents.push({
      event_type: "baseline_drift",
      severity: "warning",
      title: `Schema drift in "${input.name}"`,
      body: `Added: ${diff.added.join(", ") || "none"} · Removed: ${diff.removed.join(", ") || "none"} · Type changes: ${diff.type_changed.length} · Row delta: ${diff.row_delta}`,
    });
  }
  try {
    await raiseAlertEvents({ data: { orgId: input.orgId, events: alertEvents } });
  } catch {
    /* best-effort: alerts must never block publishing */
  }

  // 8. Audit trail (best-effort): record who published/created the dataset.
  try {
    await logAuditEvent({
      data: {
        orgId: input.orgId,
        action: input.datasetId ? "dataset.version.published" : "dataset.created",
        resourceType: "dataset",
        resourceId: datasetId,
        datasetId,
        metadata: {
          version_no: versionNo,
          row_count: totalRows,
          sheets: includedSheets.length,
          access: input.apiAccess ?? "secure",
          protected_fields: includedFields.filter((f) => f.masking !== "none").length,
        },
      },
    });
  } catch {
    /* best-effort: auditing must never block publishing */
  }

  return { datasetId, versionNo, diff };
}
