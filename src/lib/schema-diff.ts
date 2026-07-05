export type SnapshotField = { api_name: string; data_type: string; original_name?: string };
export type Snapshot = { sheets: { name: string; fields: SnapshotField[] }[] };

export type DiffSummary = {
  added: string[];
  removed: string[];
  type_changed: { field: string; from: string; to: string }[];
  row_delta: number;
  deviates: boolean;
};

export function diffSnapshots(
  prev: Snapshot | null,
  next: Snapshot,
  prevRows: number,
  nextRows: number,
): DiffSummary {
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

export function buildSnapshotFromFields(
  fields: { sheet_name: string; api_name: string; data_type: string; original_name?: string; included?: boolean }[],
  sheetNames: string[],
): Snapshot {
  return {
    sheets: sheetNames.map((name) => ({
      name,
      fields: fields
        .filter((f) => f.sheet_name === name && f.included !== false)
        .map((f) => ({ api_name: f.api_name, data_type: f.data_type, original_name: f.original_name })),
    })),
  };
}

export function buildSnapshotFromSheets(
  sheets: { name: string; headers: { api_name: string; data_type: string; original_name: string }[] }[],
): Snapshot {
  return {
    sheets: sheets.map((s) => ({
      name: s.name,
      fields: s.headers.map((h) => ({
        api_name: h.api_name,
        data_type: h.data_type,
        original_name: h.original_name,
      })),
    })),
  };
}
