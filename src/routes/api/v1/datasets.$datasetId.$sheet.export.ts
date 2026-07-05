import { createFileRoute } from "@tanstack/react-router";

// GET /api/v1/datasets/:datasetId/:sheet/export?format=parquet|csv
export const Route = createFileRoute("/api/v1/datasets/$datasetId/$sheet/export")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/api-serve.server");
        return preflight();
      },
      GET: async ({ request, params }) => {
        const mod = await import("@/lib/api-serve.server");
        const admin = await mod.getAdmin();
        const { datasetId, sheet } = params;
        const url = new URL(request.url);
        const format = url.searchParams.get("format") ?? "parquet";
        if (format !== "parquet" && format !== "csv") {
          return mod.json({ error: "Unsupported format. Use format=parquet or format=csv" }, 400);
        }

        const auth = await mod.authorizeDataset(admin, request, datasetId);
        if (!auth.ok) return auth.response;
        const { dataset } = auth;
        const versionId = dataset.current_version_id!;

        const { all, sheets } = await mod.loadSheetFields(admin, versionId);
        const matchedSheet = sheets.find((s) => mod.slugify(s) === sheet || s === sheet);
        if (!matchedSheet) {
          return mod.json({ error: "Sheet not found", available: sheets.map(mod.slugify) }, 404);
        }

        const sheetFields = all.filter((f) => f.sheet_name === matchedSheet && f.included);
        const { data: rows, error } = await admin
          .from("dataset_rows")
          .select("data")
          .eq("version_id", versionId)
          .eq("sheet_name", matchedSheet)
          .order("row_index", { ascending: true });
        if (error) return mod.json({ error: "Failed to read data" }, 500);

        const shaped = (rows ?? []).map((r) =>
          mod.shapeRow(r.data as Record<string, unknown>, sheetFields, null),
        );

        const baseName = mod.slugify(matchedSheet);

        if (format === "csv") {
          const { rowsToCsv } = await import("@/lib/csv-export.server");
          const csv = rowsToCsv(shaped, sheetFields);
          await mod.logConsumption(admin, {
            orgId: dataset.org_id,
            apiKeyId: auth.apiKeyId,
            datasetId,
            endpoint: `${datasetId}/${sheet}/export`,
            statusCode: 200,
            rowCount: shaped.length,
          });
          return new Response(csv, {
            status: 200,
            headers: {
              ...mod.CORS_HEADERS,
              ...auth.rateLimitHeaders,
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="${baseName}.csv"`,
              "Cache-Control": "no-store",
            },
          });
        }

        const { rowsToParquetBuffer } = await import("@/lib/parquet-export.server");
        const body = await rowsToParquetBuffer(shaped, sheetFields);

        await mod.logConsumption(admin, {
          orgId: dataset.org_id,
          apiKeyId: auth.apiKeyId,
          datasetId,
          endpoint: `${datasetId}/${sheet}/export`,
          statusCode: 200,
          rowCount: shaped.length,
        });

        return new Response(body, {
          status: 200,
          headers: {
            ...mod.CORS_HEADERS,
            ...auth.rateLimitHeaders,
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${baseName}.parquet"`,
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
