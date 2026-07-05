import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { slugify } from "@/lib/spreadsheet";
import { indexMergedRows, mergeRowsByKey, type RowRecord } from "@/lib/incremental-merge";
import { applyProtectionAtIngest } from "@/lib/field-protection.server";
import { buildOdcsContract, publishContract, validateAgainstContract } from "@/lib/contract.server";
import { recordPublishLineage } from "@/lib/lineage.server";
import { checkStorageQuota, getOrgMaxUploadBytes, recordStorageUsage } from "@/lib/quota.server";
import { diffSnapshots, buildSnapshotFromFields, type DiffSummary } from "@/lib/schema-diff";
import { putObject, storageEnabled, type StorageProfile } from "@/lib/storage.server";
import { writeParquetSnapshot } from "@/lib/version-snapshot.server";
import type { PublishField, PublishInput } from "@/lib/publish";

async function chunkInsert<T>(rows: T[], insert: (batch: T[]) => Promise<void>, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    await insert(rows.slice(i, i + size));
  }
}

async function resolvePublishActorId(
  admin: typeof supabaseAdmin,
  orgId: string,
  userId?: string | null,
): Promise<string> {
  if (userId) return userId;
  const { data } = await admin
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", orgId)
    .in("role", ["owner", "admin"])
    .order("role", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data?.user_id) {
    throw new Error("Cannot publish without a workspace owner or admin user (created_by)");
  }
  return data.user_id;
}

export async function publishVersionServer(
  input: PublishInput & {
    userId?: string | null;
    fileBytes?: ArrayBuffer | null;
    inviteId?: string | null;
  },
): Promise<{ datasetId: string; versionNo: number; diff: DiffSummary }> {
  const admin = supabaseAdmin;
  const actorId = await resolvePublishActorId(admin, input.orgId, input.userId);
  const includedSheets = input.sheets.filter((s) => s.included);
  const includedFields = input.fields.filter((f) => f.included && includedSheets.some((s) => s.name === f.sheet_name));
  const totalRows = includedSheets.reduce((acc, s) => acc + s.rows.length, 0);
  const fileSize = input.fileBytes?.byteLength ?? 0;

  if (fileSize > 0) {
    const maxUpload = await getOrgMaxUploadBytes(admin, input.orgId);
    if (fileSize > maxUpload) {
      throw new Error(`File exceeds organization upload limit (${Math.round(maxUpload / 1024 / 1024)} MB)`);
    }
    const quota = await checkStorageQuota(admin, {
      orgId: input.orgId,
      userId: actorId,
      bytes: fileSize,
      inviteId: input.inviteId,
    });
    if (!quota.allowed) {
      throw new Error(`Storage quota exceeded: ${quota.reason}`);
    }
  }

  let datasetId = input.datasetId;
  if (!datasetId) {
    const slug = `${slugify(input.name)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await admin
      .from("datasets")
      .insert({
        org_id: input.orgId,
        name: input.name,
        slug,
        description: input.description ?? null,
        source_type: "upload",
        status: "draft",
        api_access: input.apiAccess ?? "secure",
        created_by: actorId,
        uploaded_by: actorId,
        published_by: actorId,
        data_steward_id: actorId,
      })
      .select("id")
      .single();
    if (error) throw error;
    datasetId = data.id;
  }

  const { data: prevVersions, error: pvErr } = await admin
    .from("dataset_versions")
    .select("version_no, schema_snapshot, row_count")
    .eq("dataset_id", datasetId)
    .order("version_no", { ascending: false })
    .limit(1);
  if (pvErr) throw pvErr;
  const prev = prevVersions?.[0];
  const versionNo = (prev?.version_no ?? 0) + 1;
  const isBaseline = versionNo === 1;

  const snapshot = buildSnapshotFromFields(
    includedFields,
    includedSheets.map((s) => s.name),
  );
  const diff = diffSnapshots(
    (prev?.schema_snapshot as typeof snapshot) ?? null,
    snapshot,
    prev?.row_count ?? 0,
    totalRows,
  );

  if (!isBaseline && input.datasetId) {
    const { data: activeContract } = await admin
      .from("dataset_contracts")
      .select("contract_body")
      .eq("dataset_id", datasetId)
      .eq("is_active", true)
      .maybeSingle();
    if (activeContract?.contract_body) {
      const validation = validateAgainstContract(
        activeContract.contract_body as ReturnType<typeof buildOdcsContract>,
        includedFields.map((f) => ({
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
  const { data: orgRow } = await admin
    .from("organizations")
    .select("storage_config")
    .eq("id", input.orgId)
    .maybeSingle();
  const storageProfile = (orgRow?.storage_config ?? {}) as StorageProfile;

  if (input.fileBytes && storageEnabled()) {
    const ext = input.fileName.includes(".") ? input.fileName.split(".").pop() : "bin";
    fileRef = await putObject(
      { orgId: input.orgId, profile: storageProfile },
      ["raw", datasetId, `v${versionNo}.${ext}`],
      Buffer.from(input.fileBytes),
      "application/octet-stream",
    );
  }

  const { data: version, error: vErr } = await admin
    .from("dataset_versions")
    .insert({
      dataset_id: datasetId,
      org_id: input.orgId,
      version_no: versionNo,
      file_name: input.fileName,
      file_ref: fileRef,
      file_size_bytes: fileSize || null,
      uploaded_by: actorId,
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
    const { error } = await admin.from("dataset_fields").insert(fieldRows);
    if (error) throw error;
  }

  const protectionFields = includedFields.map((f) => ({
    api_name: f.api_name,
    masking: f.masking,
    hash_algo: f.hash_algo,
  }));

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
    const { data: prevDataset } = await admin
      .from("datasets")
      .select("current_version_id")
      .eq("id", datasetId)
      .maybeSingle();
    const prevVersionId = prevDataset?.current_version_id;
    if (prevVersionId) {
      const { data: prevKeyFields } = await admin
        .from("dataset_fields")
        .select("sheet_name, api_name")
        .eq("version_id", prevVersionId)
        .eq("is_key", true);
      const { data: prevRows } = await admin
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
          data: applyProtectionAtIngest(r.data, protectionFields) as Json,
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
        dataRows.push({
          version_id: versionId,
          org_id: input.orgId,
          sheet_name: sheet.name,
          row_index: i,
          data: applyProtectionAtIngest(data, protectionFields) as Json,
        });
      });
    }
  }

  await chunkInsert(dataRows, async (batch) => {
    const { error } = await admin.from("dataset_rows").insert(batch);
    if (error) throw error;
  });

  const plainRows = dataRows.map((r) => r.data as Record<string, unknown>);
  await writeParquetSnapshot(admin, {
    orgId: input.orgId,
    datasetId,
    versionId,
    versionNo,
    storageProfile,
    rows: plainRows,
    fields: includedFields.map((f) => ({
      api_name: f.api_name,
      data_type: f.data_type,
      nullable: f.nullable,
    })),
  });

  if (dataRows.length !== totalRows) {
    await admin.from("dataset_versions").update({ row_count: dataRows.length }).eq("id", versionId);
  }

  await admin
    .from("datasets")
    .update({
      current_version_id: versionId,
      status: "published",
      published_by: actorId,
      uploaded_by: actorId,
    })
    .eq("id", datasetId);

  if (fileSize > 0) {
    const { data: member } = await admin
      .from("org_members")
      .select("team_id")
      .eq("org_id", input.orgId)
      .eq("user_id", actorId)
      .maybeSingle();
    await recordStorageUsage(admin, {
      orgId: input.orgId,
      userId: actorId,
      bytesDelta: fileSize,
      eventType: "version_publish",
      teamId: member?.team_id,
      datasetId,
      versionId,
      metadata: {
        file_name: input.fileName,
        ...(input.inviteId ? { invite_id: input.inviteId } : {}),
      },
    });
  }

  const contract = buildOdcsContract({
    datasetId,
    datasetName: input.name,
    versionNo,
    sheetName: includedSheets[0]?.name ?? "sheet",
    rowCount: dataRows.length,
    fields: includedFields.map((f) => ({
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
  await publishContract(admin, {
    orgId: input.orgId,
    datasetId,
    versionId,
    contract,
    publishedBy: actorId,
  });

  await recordPublishLineage(admin, {
    orgId: input.orgId,
    datasetId,
    versionId,
    fileName: input.fileName,
    actorId,
    fieldMappings: includedFields.map((f) => ({
      original_name: f.original_name,
      api_name: f.api_name,
      data_type: f.data_type,
    })),
    typeChanges: diff.type_changed,
  });

  return { datasetId, versionNo, diff };
}
