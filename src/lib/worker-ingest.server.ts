import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseWorkbookFromBuffer, type ParsedWorkbook } from "@/lib/spreadsheet";
import { indexMergedRows, mergeRowsByKey, type RowRecord } from "@/lib/incremental-merge";
import type { Json } from "@/integrations/supabase/types";
import { applyProtectionAtIngest } from "@/lib/field-protection.server";
import { buildOdcsContract, publishContract, validateAgainstContract } from "@/lib/contract.server";
import { recordPublishLineage } from "@/lib/lineage.server";
import { checkStorageQuota, getOrgMaxUploadBytes, getOrgMaxRowsPerSheet, recordStorageUsage } from "@/lib/quota.server";
import { diffSnapshots, buildSnapshotFromSheets } from "@/lib/schema-diff";
import { putObject, storageEnabled, type StorageProfile } from "@/lib/storage.server";
import { writeParquetSnapshot } from "@/lib/version-snapshot.server";

export type IngestResult = {
  datasetId: string;
  versionNo: number;
  rowCount: number;
  sheetCount: number;
  deviates: boolean;
};

function buildSnapshot(wb: ParsedWorkbook) {
  return buildSnapshotFromSheets(
    wb.sheets.map((s) => ({
      name: s.name,
      headers: s.headers.map((h) => ({
        api_name: h.api_name,
        data_type: h.data_type,
        original_name: h.original_name,
      })),
    })),
  );
}

async function chunkInsert<T>(rows: T[], insert: (batch: T[]) => Promise<void>, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    await insert(rows.slice(i, i + size));
  }
}

/**
 * Server-side ingestion used by the companion worker's ingest endpoint.
 * Parses a workbook buffer and publishes a new dataset version for the
 * connector's target dataset.
 */
export async function ingestFileForConnector(opts: {
  connectorId: string;
  fileName: string;
  bytes: ArrayBuffer;
}): Promise<IngestResult> {
  const fileSize = opts.bytes.byteLength;

  const { data: connector, error: cErr } = await supabaseAdmin
    .from("connectors")
    .select("id, org_id, name, dataset_id, created_by")
    .eq("id", opts.connectorId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!connector) throw new Error("Connector not found");
  if (!connector.dataset_id) throw new Error("Connector has no target dataset configured");

  const { data: dataset, error: dErr } = await supabaseAdmin
    .from("datasets")
    .select("id, org_id, name, current_version_id")
    .eq("id", connector.dataset_id)
    .maybeSingle();
  if (dErr) throw new Error(dErr.message);
  if (!dataset || dataset.org_id !== connector.org_id) throw new Error("Target dataset not found");

  const maxUpload = await getOrgMaxUploadBytes(supabaseAdmin, dataset.org_id);
  if (fileSize > maxUpload) {
    throw new Error(`File exceeds organization upload limit (${Math.round(maxUpload / 1024 / 1024)} MB)`);
  }

  const actorId = connector.created_by ?? null;
  const quota = await checkStorageQuota(supabaseAdmin, {
    orgId: dataset.org_id,
    userId: actorId,
    bytes: fileSize,
  });
  if (!quota.allowed) {
    throw new Error(`Storage quota exceeded: ${quota.reason}`);
  }

  const { data: orgRow } = await supabaseAdmin
    .from("organizations")
    .select("storage_config")
    .eq("id", dataset.org_id)
    .maybeSingle();
  const storageProfile = (orgRow?.storage_config ?? {}) as StorageProfile;
  const maxRowsPerSheet = await getOrgMaxRowsPerSheet(supabaseAdmin, dataset.org_id);

  const wb = parseWorkbookFromBuffer(opts.bytes, opts.fileName, { maxRowsPerSheet });
  const incomingRowCount = wb.sheets.reduce((acc, s) => acc + s.rows.length, 0);

  const { data: prevVersions } = await supabaseAdmin
    .from("dataset_versions")
    .select("id, version_no, schema_snapshot, row_count, load_mode")
    .eq("dataset_id", dataset.id)
    .order("version_no", { ascending: false })
    .limit(1);
  const prev = prevVersions?.[0];
  const versionNo = (prev?.version_no ?? 0) + 1;
  const isBaseline = versionNo === 1;
  const loadMode = prev?.load_mode ?? "full";
  const prevVersionId = dataset.current_version_id ?? prev?.id ?? null;

  const snapshot = buildSnapshot(wb);
  const diff = diffSnapshots(
    (prev?.schema_snapshot as typeof snapshot) ?? null,
    snapshot,
    prev?.row_count ?? 0,
    incomingRowCount,
  );

  const fieldDefs = wb.sheets.flatMap((s) =>
    s.headers.map((h, idx) => ({
      sheet_name: s.name,
      original_name: h.original_name,
      api_name: h.api_name,
      data_type: h.data_type,
      nullable: true,
      is_pii: false,
      masking: "none" as const,
      position: idx,
    })),
  );

  if (!isBaseline) {
    const { data: activeContract } = await supabaseAdmin
      .from("dataset_contracts")
      .select("contract_body")
      .eq("dataset_id", dataset.id)
      .eq("is_active", true)
      .maybeSingle();
    if (activeContract?.contract_body) {
      const validation = validateAgainstContract(
        activeContract.contract_body as ReturnType<typeof buildOdcsContract>,
        fieldDefs.map((f) => ({
          name: f.api_name,
          type: f.data_type,
          nullable: f.nullable,
          pii: f.is_pii,
          protection: f.masking,
          original_name: f.original_name,
        })),
      );
      if (!validation.valid) {
        throw new Error(`Data contract violation: ${validation.violations.join("; ")}`);
      }
    }
  }

  let fileRef: string | null = null;
  if (storageEnabled()) {
    const ext = opts.fileName.includes(".") ? opts.fileName.split(".").pop() : "bin";
    fileRef = await putObject(
      { orgId: dataset.org_id, profile: storageProfile },
      ["raw", dataset.id, `v${versionNo}.${ext}`],
      Buffer.from(opts.bytes),
      "application/octet-stream",
    );
  }

  const { data: version, error: vErr } = await supabaseAdmin
    .from("dataset_versions")
    .insert({
      dataset_id: dataset.id,
      org_id: dataset.org_id,
      version_no: versionNo,
      file_name: opts.fileName,
      file_ref: fileRef,
      file_size_bytes: fileSize,
      uploaded_by: actorId,
      sheet_count: wb.sheets.length,
      row_count: incomingRowCount,
      schema_snapshot: snapshot as unknown as Json,
      load_mode: loadMode,
      is_baseline: isBaseline,
      diff_summary: isBaseline ? null : (diff as unknown as Json),
      has_macros: wb.hasMacros,
    })
    .select("id")
    .single();
  if (vErr) throw new Error(vErr.message);
  const versionId = version.id;

  const { data: prevVersionFields } = prevVersionId
    ? await supabaseAdmin
        .from("dataset_fields")
        .select("sheet_name, api_name, masking, hash_algo, is_key")
        .eq("version_id", prevVersionId)
    : { data: [] as { sheet_name: string; api_name: string; masking: string; hash_algo: string | null; is_key: boolean }[] };

  const prevMasking = new Map(
    (prevVersionFields ?? []).map((f) => [`${f.sheet_name}.${f.api_name}`, { masking: f.masking, hash_algo: f.hash_algo }]),
  );
  const keyFields = (prevVersionFields ?? []).filter((f) => f.is_key).map((f) => ({
    sheet_name: f.sheet_name,
    api_name: f.api_name,
  }));

  const fieldRows = wb.sheets.flatMap((s) =>
    s.headers.map((h, idx) => {
      const prevField = prevMasking.get(`${s.name}.${h.api_name}`);
      const wasKey = keyFields.some((k) => k.sheet_name === s.name && k.api_name === h.api_name);
      return {
        version_id: versionId,
        org_id: dataset.org_id,
        sheet_name: s.name,
        original_name: h.original_name,
        api_name: h.api_name,
        data_type: h.data_type,
        nullable: true,
        is_pii: false,
        masking: (prevField?.masking ?? "none") as "none" | "mask" | "hash" | "encrypt",
        hash_algo: prevField?.hash_algo ?? "sha256",
        is_key: wasKey,
        position: idx,
        included: true,
      };
    }),
  );

  if (fieldRows.length > 0) {
    const { error } = await supabaseAdmin.from("dataset_fields").insert(fieldRows);
    if (error) throw new Error(error.message);
  }

  const protectionFields = fieldRows.map((f) => ({
    api_name: f.api_name,
    masking: f.masking,
    hash_algo: f.hash_algo,
  }));

  const incomingRows: RowRecord[] = [];
  for (const sheet of wb.sheets) {
    for (const row of sheet.rows) {
      incomingRows.push({ sheet_name: sheet.name, data: row });
    }
  }

  let finalRows: { sheet_name: string; row_index: number; data: Record<string, unknown> }[] = [];

  if (loadMode === "incremental" && prevVersionId && keyFields.length > 0) {
    const { data: prevRows } = await supabaseAdmin
      .from("dataset_rows")
      .select("sheet_name, data")
      .eq("version_id", prevVersionId);
    const merged = mergeRowsByKey(
      (prevRows ?? []).map((r) => ({ sheet_name: r.sheet_name, data: r.data as Record<string, unknown> })),
      incomingRows,
      keyFields,
    );
    finalRows = indexMergedRows(merged);
  }

  if (finalRows.length === 0) {
    for (const sheet of wb.sheets) {
      sheet.rows.forEach((row, i) => {
        finalRows.push({ sheet_name: sheet.name, row_index: i, data: row });
      });
    }
  }

  const dataRows = finalRows.map((r) => ({
    version_id: versionId,
    org_id: dataset.org_id,
    sheet_name: r.sheet_name,
    row_index: r.row_index,
    data: applyProtectionAtIngest(r.data, protectionFields) as Json,
  }));

  await chunkInsert(dataRows, async (batch) => {
    const { error } = await supabaseAdmin.from("dataset_rows").insert(batch);
    if (error) throw new Error(error.message);
  });

  const totalRows = dataRows.length;
  if (totalRows !== incomingRowCount) {
    await supabaseAdmin.from("dataset_versions").update({ row_count: totalRows }).eq("id", versionId);
  }

  const plainRows = finalRows.map((r) => r.data);
  await writeParquetSnapshot(supabaseAdmin, {
    orgId: dataset.org_id,
    datasetId: dataset.id,
    versionId,
    versionNo,
    storageProfile,
    rows: plainRows,
    fields: fieldRows.map((f) => ({
      api_name: f.api_name,
      data_type: f.data_type,
      nullable: f.nullable,
    })),
  });

  await supabaseAdmin
    .from("datasets")
    .update({
      current_version_id: versionId,
      status: "published",
      published_by: actorId,
    })
    .eq("id", dataset.id);

  const { data: member } = actorId
    ? await supabaseAdmin
        .from("org_members")
        .select("team_id")
        .eq("org_id", dataset.org_id)
        .eq("user_id", actorId)
        .maybeSingle()
    : { data: null };

  await recordStorageUsage(supabaseAdmin, {
    orgId: dataset.org_id,
    userId: actorId,
    bytesDelta: fileSize,
    eventType: "connector_ingest",
    teamId: member?.team_id,
    datasetId: dataset.id,
    versionId,
    metadata: { file_name: opts.fileName, connector_id: connector.id },
  });

  const contract = buildOdcsContract({
    datasetId: dataset.id,
    datasetName: dataset.name,
    versionNo,
    sheetName: wb.sheets[0]?.name ?? "sheet",
    rowCount: totalRows,
    fields: fieldDefs.map((f) => ({
      name: f.api_name,
      type: f.data_type,
      nullable: f.nullable,
      pii: f.is_pii,
      protection: f.masking,
      original_name: f.original_name,
    })),
    uploadedBy: actorId,
    publishedBy: actorId,
    diff: isBaseline ? null : diff,
  });
  await publishContract(supabaseAdmin, {
    orgId: dataset.org_id,
    datasetId: dataset.id,
    versionId,
    contract,
    publishedBy: actorId,
  });

  await recordPublishLineage(supabaseAdmin, {
    orgId: dataset.org_id,
    datasetId: dataset.id,
    versionId,
    fileName: opts.fileName,
    actorId,
    connectorId: connector.id,
    fieldMappings: fieldRows.map((f) => ({
      original_name: f.original_name,
      api_name: f.api_name,
      data_type: f.data_type,
    })),
    typeChanges: diff.type_changed,
  });

  await supabaseAdmin.from("alert_events").insert({
    org_id: dataset.org_id,
    event_type: "publish",
    severity: "info",
    title: `Dataset "${dataset.name}" updated to v${versionNo}`,
    body: `Ingested ${opts.fileName} via connector "${connector.name}". ${totalRows} rows across ${wb.sheets.length} sheet(s).`,
    audience: "workspace",
  });
  if (!isBaseline && diff.deviates) {
    await supabaseAdmin.from("alert_events").insert({
      org_id: dataset.org_id,
      event_type: "baseline_drift",
      severity: "warning",
      title: `Schema drift detected in "${dataset.name}"`,
      body: `Added: ${diff.added.join(", ") || "none"} · Removed: ${diff.removed.join(", ") || "none"} · Type changes: ${diff.type_changed.length}`,
      audience: "workspace",
    });
  }
  await dispatchPendingAlertEmails(dataset.org_id);

  return { datasetId: dataset.id, versionNo, rowCount: totalRows, sheetCount: wb.sheets.length, deviates: diff.deviates };
}

/**
 * Best-effort email delivery for alert events. Sends through the project's
 * configured email infrastructure when available; otherwise marks events as
 * skipped so they remain visible in the in-app feed.
 */
export async function dispatchPendingAlertEmails(orgId: string) {
  const { data: alertConfigs } = await supabaseAdmin
    .from("alerts")
    .select("event_type, enabled, recipients")
    .eq("org_id", orgId)
    .eq("enabled", true);
  if (!alertConfigs || alertConfigs.length === 0) return;

  const recipients = [...new Set(alertConfigs.flatMap((a) => a.recipients ?? []))].filter(Boolean);
  if (recipients.length === 0) return;

  const { data: pending } = await supabaseAdmin
    .from("alert_events")
    .select("id, title, body, severity, event_type")
    .eq("org_id", orgId)
    .eq("audience", "admins")
    .eq("email_status", "skipped")
    .order("created_at", { ascending: false })
    .limit(20);
  if (!pending || pending.length === 0) return;

  const enabledTypes = new Set(alertConfigs.map((a) => a.event_type));
  const toSend = pending.filter((ev) => enabledTypes.has(ev.event_type));
  if (toSend.length === 0) return;

  const { sendEmail, emailDeliveryConfigured } = await import("@/lib/email.server");
  const mailReady = emailDeliveryConfigured();

  for (const ev of toSend) {
    let status = "skipped";
    try {
      if (mailReady) {
        const ok = await sendEmail({
          to: recipients[0]!,
          subject: `[Gridwire] ${ev.title}`,
          text: `${ev.title}\n\n${ev.body ?? ""}\n\nSeverity: ${ev.severity}`,
          purpose: "notifications",
          tag: "alert",
        });
        status = ok ? "sent" : "skipped";
      }
    } catch {
      status = "pending";
    }
    await supabaseAdmin.from("alert_events").update({ email_status: status, recipients }).eq("id", ev.id);
  }
}
