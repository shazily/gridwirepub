/**
 * Merges new row batches into a previous snapshot keyed by is_key fields (per sheet).
 */
export type RowRecord = {
  sheet_name: string;
  data: Record<string, unknown>;
};

export type KeyField = {
  sheet_name: string;
  api_name: string;
};

function rowKey(sheetName: string, data: Record<string, unknown>, keyApiName: string): string | null {
  const v = data[keyApiName];
  if (v === null || v === undefined || v === "") return null;
  return `${sheetName}\0${String(v)}`;
}

export function mergeRowsByKey(
  prevRows: RowRecord[],
  newRows: RowRecord[],
  keyFields: KeyField[],
): RowRecord[] {
  const keyBySheet = new Map(keyFields.map((k) => [k.sheet_name, k.api_name]));
  const merged = new Map<string, RowRecord>();

  for (const row of prevRows) {
    const keyName = keyBySheet.get(row.sheet_name);
    if (!keyName) {
      merged.set(`${row.sheet_name}\0${merged.size}`, row);
      continue;
    }
    const k = rowKey(row.sheet_name, row.data, keyName);
    if (k) merged.set(k, row);
  }

  for (const row of newRows) {
    const keyName = keyBySheet.get(row.sheet_name);
    if (!keyName) {
      merged.set(`${row.sheet_name}\0new:${merged.size}`, row);
      continue;
    }
    const k = rowKey(row.sheet_name, row.data, keyName);
    if (!k) continue;
    merged.set(k, row);
  }

  return [...merged.values()];
}

export function indexMergedRows(
  rows: RowRecord[],
): { sheet_name: string; row_index: number; data: Record<string, unknown> }[] {
  const perSheet = new Map<string, number>();
  return rows.map((row) => {
    const idx = perSheet.get(row.sheet_name) ?? 0;
    perSheet.set(row.sheet_name, idx + 1);
    return { sheet_name: row.sheet_name, row_index: idx, data: row.data };
  });
}
