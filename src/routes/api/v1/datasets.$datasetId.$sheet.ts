import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";

export const Route = createFileRoute("/api/v1/datasets/$datasetId/$sheet")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/api-serve.server");
        return preflight();
      },
      HEAD: async ({ request, params }) => {
        const mod = await import("@/lib/api-serve.server");
        const admin = await mod.getAdmin();
        const auth = await mod.authorizeDataset(admin, request, params.datasetId);
        if (!auth.ok) return new Response(null, { status: auth.response.status, headers: mod.CORS_HEADERS });
        return new Response(null, {
          status: 200,
          headers: {
            ...mod.CORS_HEADERS,
            "X-Dataset-Version": auth.dataset.current_version_id ?? "",
            "Last-Modified": new Date(auth.dataset.updated_at).toUTCString(),
          },
        });
      },
      GET: async ({ request, params }) => {
        const mod = await import("@/lib/api-serve.server");
        const admin = await mod.getAdmin();
        const { datasetId, sheet } = params;

        const auth = await mod.authorizeDataset(admin, request, datasetId);
        if (!auth.ok) return auth.response;
        const { dataset } = auth;
        const versionId = dataset.current_version_id!;

        const { all, sheets } = await mod.loadSheetFields(admin, versionId);
        const matchedSheet = sheets.find((s) => mod.slugify(s) === sheet || s === sheet);
        if (!matchedSheet)
          return mod.json({ error: "Sheet not found", available: sheets.map(mod.slugify) }, 404);

        const sheetFields = all.filter((f) => f.sheet_name === matchedSheet && f.included);

        const url = new URL(request.url);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 1000);
        const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
        const select = url.searchParams.get("fields")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;

        // Equality filters on any known field
        const fieldNames = new Set(sheetFields.map((f) => f.api_name));
        const reserved = new Set(["limit", "offset", "fields"]);
        const filters: [string, string][] = [];
        url.searchParams.forEach((value, key) => {
          if (!reserved.has(key) && fieldNames.has(key)) filters.push([key, value]);
        });

        // ETag for cheap polling / caching
        const etag = `"${createHash("sha1")
          .update(`${versionId}:${matchedSheet}:${url.search}`)
          .digest("hex")
          .slice(0, 16)}"`;
        if (request.headers.get("if-none-match") === etag) {
          return new Response(null, { status: 304, headers: { ...mod.CORS_HEADERS, ETag: etag } });
        }

        const { count } = await admin
          .from("dataset_rows")
          .select("id", { count: "exact", head: true })
          .eq("version_id", versionId)
          .eq("sheet_name", matchedSheet);

        const { data: rows, error } = await admin
          .from("dataset_rows")
          .select("data")
          .eq("version_id", versionId)
          .eq("sheet_name", matchedSheet)
          .order("row_index", { ascending: true })
          .range(offset, offset + limit - 1);
        if (error) {
          await mod.logConsumption(admin, {
            orgId: dataset.org_id, apiKeyId: auth.apiKeyId, datasetId, endpoint: `${datasetId}/${sheet}`, statusCode: 500, rowCount: 0,
          });
          return mod.json({ error: "Failed to read data" }, 500);
        }

        let result = (rows ?? []).map((r) => r.data as Record<string, unknown>);
        if (filters.length > 0) {
          result = result.filter((row) =>
            filters.every(([k, v]) => String(row[k] ?? "").toLowerCase() === v.toLowerCase()),
          );
        }
        const shaped = result.map((row) => mod.shapeRow(row, sheetFields, select));

        await mod.logConsumption(admin, {
          orgId: dataset.org_id, apiKeyId: auth.apiKeyId, datasetId, endpoint: `${datasetId}/${sheet}`, statusCode: 200, rowCount: shaped.length,
        });
        await mod.logDataAccess(admin, request, {
          orgId: dataset.org_id,
          datasetId,
          apiKeyId: auth.apiKeyId,
          apiKeyLabel: auth.apiKeyLabel,
          access: dataset.api_access,
          resource: `${dataset.slug}/${mod.slugify(matchedSheet)}`,
          rowCount: shaped.length,
          statusCode: 200,
        });

        return mod.json(
          {
            dataset: dataset.id,
            sheet: matchedSheet,
            version: versionId,
            total: count ?? shaped.length,
            count: shaped.length,
            limit,
            offset,
            data: shaped,
          },
          200,
          {
            ETag: etag,
            "X-Dataset-Version": versionId,
            "X-Total-Count": String(count ?? shaped.length),
            "Last-Modified": new Date(dataset.updated_at).toUTCString(),
            ...auth.rateLimitHeaders,
          },
        );
      },
    },
  },
});
