import type { AdminClient } from "@/lib/api-serve.server";

export type LineageNodeType =
  | "source_file"
  | "connector"
  | "dataset"
  | "version"
  | "field"
  | "transform"
  | "api_consumer"
  | "user";

export type LineageRelationship =
  | "uploaded_by"
  | "derived_from"
  | "mapped_to"
  | "type_changed"
  | "formula_in"
  | "published_as"
  | "consumed_by"
  | "ingested_from";

export async function upsertLineageNode(
  admin: AdminClient,
  opts: {
    orgId: string;
    nodeType: LineageNodeType;
    label: string;
    refType?: string;
    refId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  if (opts.refType && opts.refId) {
    const { data: existing } = await admin
      .from("lineage_nodes")
      .select("id")
      .eq("org_id", opts.orgId)
      .eq("ref_type", opts.refType)
      .eq("ref_id", opts.refId)
      .maybeSingle();
    if (existing?.id) return existing.id;
  }
  const { data, error } = await admin
    .from("lineage_nodes")
    .insert({
      org_id: opts.orgId,
      node_type: opts.nodeType,
      label: opts.label,
      ref_type: opts.refType ?? null,
      ref_id: opts.refId ?? null,
      metadata: opts.metadata ?? {},
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function recordLineageEdge(
  admin: AdminClient,
  opts: {
    orgId: string;
    fromNodeId: string;
    toNodeId: string;
    relationship: LineageRelationship;
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin.from("lineage_edges").insert({
    org_id: opts.orgId,
    from_node_id: opts.fromNodeId,
    to_node_id: opts.toNodeId,
    relationship: opts.relationship,
    actor_id: opts.actorId ?? null,
    metadata: opts.metadata ?? {},
  });
  if (error) throw error;
}

export async function recordPublishLineage(
  admin: AdminClient,
  opts: {
    orgId: string;
    datasetId: string;
    versionId: string;
    fileName: string;
    actorId?: string | null;
    connectorId?: string | null;
    fieldMappings?: { original_name: string; api_name: string; data_type: string }[];
    typeChanges?: { field: string; from: string; to: string }[];
  },
): Promise<void> {
  const datasetNodeId = await upsertLineageNode(admin, {
    orgId: opts.orgId,
    nodeType: "dataset",
    label: opts.fileName,
    refType: "dataset",
    refId: opts.datasetId,
  });
  const versionNodeId = await upsertLineageNode(admin, {
    orgId: opts.orgId,
    nodeType: "version",
    label: `Version ${opts.versionId.slice(0, 8)}`,
    refType: "dataset_version",
    refId: opts.versionId,
    metadata: { file_name: opts.fileName },
  });
  const sourceNodeId = await upsertLineageNode(admin, {
    orgId: opts.orgId,
    nodeType: opts.connectorId ? "connector" : "source_file",
    label: opts.fileName,
    refType: opts.connectorId ? "connector" : "source_file",
    refId: opts.connectorId ?? opts.versionId,
  });

  await recordLineageEdge(admin, {
    orgId: opts.orgId,
    fromNodeId: sourceNodeId,
    toNodeId: versionNodeId,
    relationship: opts.connectorId ? "ingested_from" : "derived_from",
    actorId: opts.actorId,
  });
  await recordLineageEdge(admin, {
    orgId: opts.orgId,
    fromNodeId: versionNodeId,
    toNodeId: datasetNodeId,
    relationship: "published_as",
    actorId: opts.actorId,
  });

  if (opts.actorId) {
    const userNodeId = await upsertLineageNode(admin, {
      orgId: opts.orgId,
      nodeType: "user",
      label: opts.actorId,
      refType: "user",
      refId: opts.actorId,
    });
    await recordLineageEdge(admin, {
      orgId: opts.orgId,
      fromNodeId: userNodeId,
      toNodeId: sourceNodeId,
      relationship: "uploaded_by",
      actorId: opts.actorId,
    });
  }

  for (const m of opts.fieldMappings ?? []) {
    const fieldNodeId = await upsertLineageNode(admin, {
      orgId: opts.orgId,
      nodeType: "field",
      label: `${m.original_name} → ${m.api_name}`,
      metadata: { original_name: m.original_name, api_name: m.api_name, data_type: m.data_type },
    });
    await recordLineageEdge(admin, {
      orgId: opts.orgId,
      fromNodeId: sourceNodeId,
      toNodeId: fieldNodeId,
      relationship: "mapped_to",
      actorId: opts.actorId,
      metadata: { original_name: m.original_name, api_name: m.api_name },
    });
  }

  for (const tc of opts.typeChanges ?? []) {
    const transformNodeId = await upsertLineageNode(admin, {
      orgId: opts.orgId,
      nodeType: "transform",
      label: `Type: ${tc.field}`,
      metadata: tc,
    });
    await recordLineageEdge(admin, {
      orgId: opts.orgId,
      fromNodeId: transformNodeId,
      toNodeId: versionNodeId,
      relationship: "type_changed",
      actorId: opts.actorId,
      metadata: tc,
    });
  }
}

export async function fetchLineageGraph(admin: AdminClient, orgId: string, datasetId: string) {
  const { data: nodes } = await admin
    .from("lineage_nodes")
    .select("*")
    .eq("org_id", orgId)
    .or(`ref_id.eq.${datasetId},ref_type.eq.dataset_version`);
  const nodeIds = (nodes ?? []).map((n) => n.id);
  if (nodeIds.length === 0) {
    const { data: datasetNode } = await admin
      .from("lineage_nodes")
      .select("*")
      .eq("org_id", orgId)
      .eq("ref_type", "dataset")
      .eq("ref_id", datasetId);
    const ids = (datasetNode ?? []).map((n) => n.id);
    if (ids.length === 0) return { nodes: [], edges: [] };
    const { data: edges } = await admin
      .from("lineage_edges")
      .select("*")
      .eq("org_id", orgId)
      .or(ids.map((id) => `from_node_id.eq.${id},to_node_id.eq.${id}`).join(","));
    return { nodes: datasetNode ?? [], edges: edges ?? [] };
  }
  const { data: edges } = await admin
    .from("lineage_edges")
    .select("*")
    .eq("org_id", orgId)
    .or(nodeIds.map((id) => `from_node_id.eq.${id},to_node_id.eq.${id}`).join(","));
  return { nodes: nodes ?? [], edges: edges ?? [] };
}
