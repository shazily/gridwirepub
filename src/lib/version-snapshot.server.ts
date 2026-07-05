import type { AdminClient } from "@/lib/api-serve.server";
import { rowsToParquetBuffer } from "@/lib/parquet-export.server";
import { putObject, storageEnabled, type StorageProfile } from "@/lib/storage.server";

export type SnapshotFieldMeta = {
  api_name: string;
  data_type: string;
  nullable?: boolean;
};

/**
 * Writes a Parquet snapshot to object storage and updates dataset_versions.parquet_ref.
 */
export async function writeParquetSnapshot(
  admin: AdminClient,
  opts: {
    orgId: string;
    datasetId: string;
    versionId: string;
    versionNo: number;
    storageProfile: StorageProfile;
    rows: Record<string, unknown>[];
    fields: SnapshotFieldMeta[];
  },
): Promise<string | null> {
  if (!storageEnabled() || opts.rows.length === 0 || opts.fields.length === 0) return null;

  const buf = await rowsToParquetBuffer(
    opts.rows,
    opts.fields.map((f) => ({
      api_name: f.api_name,
      data_type: f.data_type,
      nullable: f.nullable ?? true,
      masking: "none" as const,
      is_pii: false,
      included: true,
    })),
  );

  const parquetRef = await putObject(
    { orgId: opts.orgId, profile: opts.storageProfile },
    ["parquet", opts.datasetId, `v${opts.versionNo}.parquet`],
    Buffer.from(buf),
    "application/vnd.apache.parquet",
  );

  await admin.from("dataset_versions").update({ parquet_ref: parquetRef }).eq("id", opts.versionId);
  return parquetRef;
}
