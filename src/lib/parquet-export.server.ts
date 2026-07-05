import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ServeField } from "@/lib/api-serve.server";

type ParquetField = { type: string; optional?: boolean };

function parquetFieldType(dataType?: string): string {
  switch (dataType) {
    case "number":
      return "DOUBLE";
    case "boolean":
      return "BOOLEAN";
    case "date":
      return "TIMESTAMP_MILLIS";
    default:
      return "UTF8";
  }
}

function normalizeParquetValue(value: unknown, dataType?: string): unknown {
  if (value === null || value === undefined) return undefined;
  if (dataType === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (dataType === "boolean") return Boolean(value);
  return String(value);
}

/**
 * Builds a Parquet file buffer from shaped API rows (post-masking).
 */
export async function rowsToParquetBuffer(
  rows: Record<string, unknown>[],
  fields: ServeField[],
): Promise<Uint8Array> {
  const parquet = await import("parquetjs");
  const schemaDef: Record<string, ParquetField> = {};
  for (const f of fields) {
    schemaDef[f.api_name] = { type: parquetFieldType(f.data_type), optional: f.nullable ?? true };
  }
  const schema = new parquet.ParquetSchema(schemaDef);
  const dir = await mkdtemp(path.join(tmpdir(), "gridwire-parquet-"));
  const filePath = path.join(dir, "export.parquet");
  try {
    const writer = await parquet.ParquetWriter.openFile(schema, filePath);
    for (const row of rows) {
      const out: Record<string, unknown> = {};
      for (const f of fields) {
        out[f.api_name] = normalizeParquetValue(row[f.api_name], f.data_type);
      }
      await writer.appendRow(out);
    }
    await writer.close();
    return new Uint8Array(await readFile(filePath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
