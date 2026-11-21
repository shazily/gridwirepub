/**
 * Thin HTTP client for Gridwire's public REST API.
 * Never logs API keys or row payloads.
 */

import { GridwireApiError } from "./errors.js";
import type { McpConfig } from "./config.js";

export type ListedDataset = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  access: "public" | "secure";
  status: string;
  mcp_enabled?: boolean;
  updated_at: string;
  version: { id: string; version_no: number | null; row_count: number | null };
  sheets: { name: string; slug: string }[];
  openapi: string;
  docs: string;
};

export type DatasetDetail = {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  access: string;
  status: string;
  mcp_enabled?: boolean;
  version: Record<string, unknown>;
  updated_at: string;
  openapi: string;
  docs: string;
  sheets: {
    name: string;
    slug: string;
    field_count: number;
    data_url: string;
    schema_url: string;
  }[];
};

export type SchemaResponse = {
  dataset: string;
  sheet: string;
  slug: string;
  access: string;
  field_count: number;
  fields: {
    name: string;
    type: string;
    nullable?: boolean;
    pii?: boolean;
    protection?: string;
    source_column?: string;
  }[];
};

export type RowsResponse = {
  dataset: string;
  sheet: string;
  version: string;
  total: number;
  count: number;
  limit: number;
  offset: number;
  data: Record<string, unknown>[];
};

export class GridwireClient {
  constructor(private readonly config: McpConfig) {}

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  openApiUrl(datasetId: string): string {
    return `${this.config.baseUrl}/api/v1/datasets/${datasetId}/openapi.json`;
  }

  private async request<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    const url = new URL(path.startsWith("http") ? path : `${this.config.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, v);
      }
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new GridwireApiError(
        0,
        err instanceof Error ? err.message : "Network error reaching Gridwire",
        "network",
      );
    }

    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text.slice(0, 200) };
      }
    }

    if (!res.ok) {
      const msg =
        body && typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : text.slice(0, 200) || res.statusText;
      throw new GridwireApiError(res.status, msg);
    }

    return body as T;
  }

  async listDatasets(): Promise<ListedDataset[]> {
    const res = await this.request<{ data: ListedDataset[] }>("/api/v1/datasets");
    let data = res.data ?? [];
    if (this.config.datasetAllowlist && this.config.datasetAllowlist.size > 0) {
      data = data.filter((d) => this.config.datasetAllowlist!.has(d.id));
    }
    return data;
  }

  async getDataset(datasetId: string): Promise<DatasetDetail> {
    this.assertAllowed(datasetId);
    return this.request<DatasetDetail>(`/api/v1/datasets/${datasetId}`);
  }

  async getSchema(datasetId: string, sheetSlug: string): Promise<SchemaResponse> {
    this.assertAllowed(datasetId);
    return this.request<SchemaResponse>(`/api/v1/datasets/${datasetId}/${sheetSlug}/schema`);
  }

  async queryRows(
    datasetId: string,
    sheetSlug: string,
    opts: {
      limit: number;
      offset: number;
      fields?: string[];
      filters?: Record<string, string>;
    },
  ): Promise<RowsResponse> {
    this.assertAllowed(datasetId);
    const query: Record<string, string | undefined> = {
      limit: String(opts.limit),
      offset: String(opts.offset),
      fields: opts.fields?.length ? opts.fields.join(",") : undefined,
      ...(opts.filters ?? {}),
    };
    return this.request<RowsResponse>(`/api/v1/datasets/${datasetId}/${sheetSlug}`, query);
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await fetch(`${this.config.baseUrl}/api/public/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
      return { ok: res.ok, detail: res.ok ? "portal up" : `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : "unreachable" };
    }
  }

  private assertAllowed(datasetId: string) {
    if (this.config.datasetAllowlist && this.config.datasetAllowlist.size > 0) {
      if (!this.config.datasetAllowlist.has(datasetId)) {
        throw new GridwireApiError(
          404,
          "Dataset is not in GRIDWIRE_DATASET_IDS allowlist for this MCP server",
          "not_found",
        );
      }
    }
  }
}

/** Resolve sheet name or slug to the API path slug using dataset metadata. */
export function resolveSheetSlug(
  dataset: DatasetDetail | ListedDataset,
  sheet: string,
): string {
  const needle = sheet.trim().toLowerCase();
  const sheets = dataset.sheets ?? [];
  for (const s of sheets) {
    if (s.slug.toLowerCase() === needle || s.name.toLowerCase() === needle) {
      return s.slug;
    }
  }
  // Fall through: let the API 404 with the provided value slugified lightly.
  return sheet
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
