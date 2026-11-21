import { createFileRoute } from "@tanstack/react-router";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * GET /api/public/mcp/download
 * Serves the packaged @gridwire/mcp-server zip for end users.
 * Run `bun run scripts/pack-mcp.mjs` (or `bun run mcp:pack`) to refresh the artifact.
 *
 * Nitro production serves static assets from `.output/public`; local/dev uses `public/`.
 */
async function resolveMcpZipPath(): Promise<string | null> {
  const candidates = [
    join(process.cwd(), "public", "downloads", "gridwire-mcp-server.zip"),
    join(process.cwd(), ".output", "public", "downloads", "gridwire-mcp-server.zip"),
    join(process.cwd(), "downloads", "gridwire-mcp-server.zip"),
  ];
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch {
      /* try next */
    }
  }
  return null;
}

export const Route = createFileRoute("/api/public/mcp/download")({
  server: {
    handlers: {
      GET: async () => {
        const zipPath = await resolveMcpZipPath();
        if (!zipPath) {
          return new Response(
            JSON.stringify({
              error: "MCP package not built yet",
              hint: "Run: bun run mcp:pack  (or bun run scripts/pack-mcp.mjs)",
              docs: "/mcp/README.md",
              source: "https://github.com/shazily/gridwire/tree/main/mcp",
            }),
            {
              status: 503,
              headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            },
          );
        }
        try {
          const bytes = await readFile(zipPath);
          return new Response(bytes, {
            status: 200,
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": 'attachment; filename="gridwire-mcp-server.zip"',
              "Cache-Control": "public, max-age=300",
              "Content-Length": String(bytes.byteLength),
            },
          });
        } catch {
          return new Response(
            JSON.stringify({
              error: "MCP package unreadable",
              hint: "Run: bun run mcp:pack",
            }),
            {
              status: 503,
              headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
            },
          );
        }
      },
    },
  },
});
