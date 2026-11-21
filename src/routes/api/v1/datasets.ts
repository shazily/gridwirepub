import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/v1/datasets
 * Discovery for API-key holders (MCP, agents, integrations).
 * Requires Bearer API key. Returns published datasets in the key's org only.
 */
export const Route = createFileRoute("/api/v1/datasets")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/api-serve.server");
        return preflight();
      },
      GET: async ({ request }) => {
        const mod = await import("@/lib/api-serve.server");
        const admin = await mod.getAdmin();

        const keyRes = await mod.validateApiKey(admin, request);
        if (!keyRes.ok) {
          const msg = keyRes.reason === "missing" ? "Missing API key" : "Invalid API key";
          return mod.json({ error: msg }, 401, { "WWW-Authenticate": 'Bearer realm="dataset"' });
        }

        const orgId = keyRes.key.org_id;
        const rl = mod.checkRateLimit(request, keyRes.key.id);
        if (!rl.ok) return rl.response;

        const { data: rows, error } = await admin
          .from("datasets")
          .select(
            "id, name, description, slug, api_access, status, current_version_id, updated_at, mcp_enabled",
          )
          .eq("org_id", orgId)
          .eq("status", "published")
          .not("current_version_id", "is", null)
          .order("updated_at", { ascending: false })
          .limit(500);

        if (error) {
          return mod.json({ error: "Failed to list datasets" }, 500);
        }

        const datasets = rows ?? [];
        const versionIds = [
          ...new Set(datasets.map((d) => d.current_version_id).filter((id): id is string => Boolean(id))),
        ];

        const sheetsByVersion = new Map<string, string[]>();
        const versionMeta = new Map<string, { version_no: number; row_count: number | null }>();

        if (versionIds.length > 0) {
          const [{ data: fields }, { data: versions }] = await Promise.all([
            admin
              .from("dataset_fields")
              .select("version_id, sheet_name")
              .in("version_id", versionIds)
              .eq("included", true),
            admin
              .from("dataset_versions")
              .select("id, version_no, row_count")
              .in("id", versionIds),
          ]);

          for (const f of fields ?? []) {
            const list = sheetsByVersion.get(f.version_id) ?? [];
            if (!list.includes(f.sheet_name)) list.push(f.sheet_name);
            sheetsByVersion.set(f.version_id, list);
          }
          for (const v of versions ?? []) {
            versionMeta.set(v.id, { version_no: v.version_no, row_count: v.row_count });
          }
        }

        // Best-effort last_used touch (same pattern as data routes).
        try {
          await admin
            .from("api_keys")
            .update({ last_used_at: new Date().toISOString() })
            .eq("id", keyRes.key.id);
        } catch {
          /* ignore */
        }

        const origin = mod.resolvePublicOrigin(request);
        const data = datasets.map((d) => {
          const vid = d.current_version_id!;
          const meta = versionMeta.get(vid);
          const sheets = sheetsByVersion.get(vid) ?? [];
          return {
            id: d.id,
            name: d.name,
            description: d.description,
            slug: d.slug,
            access: d.api_access,
            status: d.status,
            mcp_enabled: (d as { mcp_enabled?: boolean }).mcp_enabled !== false,
            updated_at: d.updated_at,
            version: {
              id: vid,
              version_no: meta?.version_no ?? null,
              row_count: meta?.row_count ?? null,
            },
            sheets: sheets.map((name) => ({
              name,
              slug: mod.slugify(name),
            })),
            openapi: `${origin}/api/v1/datasets/${d.id}/openapi.json`,
            docs: `${origin}/docs/${d.id}`,
          };
        });

        return mod.json(
          {
            org_id: orgId,
            count: data.length,
            data,
          },
          200,
          rl.headers,
        );
      },
    },
  },
});
