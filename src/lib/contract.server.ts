import type { AdminClient } from "@/lib/api-serve.server";
import type { DiffSummary } from "@/lib/schema-diff";

export type ContractField = {
  name: string;
  type: string;
  nullable?: boolean;
  pii?: boolean;
  protection?: string;
  original_name?: string;
};

export type OdcsContract = {
  apiVersion: string;
  kind: string;
  id: string;
  name: string;
  version: string;
  status: string;
  schema: {
    type: string;
    properties: Record<string, { type: string; nullable?: boolean; description?: string }>;
  }[];
  quality: {
    row_count?: number;
    freshness_max_hours?: number;
  };
  sla: {
    update_frequency?: string;
  };
  owners: {
    uploaded_by?: string | null;
    published_by?: string | null;
    data_steward_id?: string | null;
  };
  breaking_change_policy: string;
  diff_from_previous?: DiffSummary | null;
};

export function buildOdcsContract(opts: {
  datasetId: string;
  datasetName: string;
  versionNo: number;
  fields: ContractField[];
  sheetName: string;
  rowCount: number;
  uploadedBy?: string | null;
  publishedBy?: string | null;
  stewardId?: string | null;
  diff?: DiffSummary | null;
}): OdcsContract {
  const properties: Record<string, { type: string; nullable?: boolean; description?: string }> = {};
  for (const f of opts.fields) {
    properties[f.name] = {
      type: f.type,
      nullable: f.nullable,
      description: [
        f.original_name ? `Source column: ${f.original_name}` : null,
        f.pii ? "PII" : null,
        f.protection && f.protection !== "none" ? `Protection: ${f.protection}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || undefined,
    };
  }
  return {
    apiVersion: "v3.0.1",
    kind: "DataContract",
    id: opts.datasetId,
    name: opts.datasetName,
    version: `${opts.versionNo}.0.0`,
    status: "published",
    schema: [{ type: "object", properties }],
    quality: { row_count: opts.rowCount },
    sla: { update_frequency: "on_demand" },
    owners: {
      uploaded_by: opts.uploadedBy ?? null,
      published_by: opts.publishedBy ?? null,
      data_steward_id: opts.stewardId ?? null,
    },
    breaking_change_policy: "semver",
    diff_from_previous: opts.diff ?? null,
  };
}

export async function publishContract(
  admin: AdminClient,
  opts: {
    orgId: string;
    datasetId: string;
    versionId: string;
    contract: OdcsContract;
    publishedBy?: string | null;
  },
): Promise<void> {
  await admin
    .from("dataset_contracts")
    .update({ is_active: false })
    .eq("dataset_id", opts.datasetId)
    .eq("is_active", true);

  const { error } = await admin.from("dataset_contracts").insert({
    org_id: opts.orgId,
    dataset_id: opts.datasetId,
    version_id: opts.versionId,
    contract_version: opts.contract.version,
    contract_body: opts.contract,
    format: "odcs",
    published_by: opts.publishedBy ?? null,
    is_active: true,
  });
  if (error) throw error;
}

export function validateAgainstContract(
  contract: OdcsContract,
  fields: ContractField[],
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  const props = contract.schema[0]?.properties ?? {};
  for (const f of fields) {
    const expected = props[f.name];
    if (!expected) {
      violations.push(`Unknown field: ${f.name}`);
      continue;
    }
    if (expected.type !== f.type) {
      violations.push(`Type mismatch for ${f.name}: expected ${expected.type}, got ${f.type}`);
    }
  }
  for (const name of Object.keys(props)) {
    if (!fields.some((f) => f.name === name)) {
      violations.push(`Missing required field from contract: ${name}`);
    }
  }
  return { valid: violations.length === 0, violations };
}

export function contractToYaml(contract: OdcsContract): string {
  const lines: string[] = [
    `apiVersion: ${contract.apiVersion}`,
    `kind: ${contract.kind}`,
    `id: ${contract.id}`,
    `name: ${contract.name}`,
    `version: ${contract.version}`,
    `status: ${contract.status}`,
    "schema:",
  ];
  for (const [name, spec] of Object.entries(contract.schema[0]?.properties ?? {})) {
    lines.push(`  - name: ${name}`);
    lines.push(`    type: ${spec.type}`);
    if (spec.nullable) lines.push(`    nullable: true`);
    if (spec.description) lines.push(`    description: "${spec.description.replace(/"/g, '\\"')}"`);
  }
  return lines.join("\n");
}
