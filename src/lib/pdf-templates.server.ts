/**
 * Saved PDF structure templates for recurring SFTP / folder / upload patterns.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  fileNameMatchesPdfPattern,
  normalizeStructureSnapshot,
  type PdfStructureSnapshot,
} from "@/lib/pdf-structure";

export type PdfIngestTemplateRow = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  file_name_pattern: string;
  structure_snapshot: PdfStructureSnapshot;
  target_dataset_id: string | null;
  connector_id: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function createPdfIngestTemplate(opts: {
  orgId: string;
  name: string;
  description?: string | null;
  fileNamePattern?: string;
  structure: PdfStructureSnapshot;
  targetDatasetId?: string | null;
  connectorId?: string | null;
  createdBy?: string | null;
}): Promise<PdfIngestTemplateRow> {
  const structure = normalizeStructureSnapshot(opts.structure);
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("pdf_ingest_templates" as never)
    .insert({
      org_id: opts.orgId,
      name: opts.name.trim().slice(0, 200),
      description: opts.description?.trim() || null,
      file_name_pattern: (opts.fileNamePattern ?? "*.pdf").trim() || "*.pdf",
      structure_snapshot: structure as unknown as Json,
      target_dataset_id: opts.targetDatasetId ?? null,
      connector_id: opts.connectorId ?? null,
      active: true,
      created_by: opts.createdBy ?? null,
      updated_at: now,
    } as never)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as PdfIngestTemplateRow;
}

export async function listPdfIngestTemplates(orgId: string): Promise<PdfIngestTemplateRow[]> {
  const { data, error } = await supabaseAdmin
    .from("pdf_ingest_templates" as never)
    .select("*")
    .eq("org_id", orgId)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data as unknown as PdfIngestTemplateRow[]) ?? [];
}

export async function getPdfIngestTemplate(
  templateId: string,
  orgId: string,
): Promise<PdfIngestTemplateRow | null> {
  const { data, error } = await supabaseAdmin
    .from("pdf_ingest_templates" as never)
    .select("*")
    .eq("id", templateId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as PdfIngestTemplateRow) ?? null;
}

/** Prefer connector-linked templates, then filename pattern match. */
export async function findMatchingPdfTemplate(opts: {
  orgId: string;
  fileName: string;
  connectorId?: string | null;
}): Promise<PdfIngestTemplateRow | null> {
  const templates = await listPdfIngestTemplates(opts.orgId);
  if (opts.connectorId) {
    const linked = templates.find((t) => t.connector_id === opts.connectorId);
    if (linked) return linked;
  }
  return (
    templates.find((t) => fileNameMatchesPdfPattern(opts.fileName, t.file_name_pattern)) ?? null
  );
}
