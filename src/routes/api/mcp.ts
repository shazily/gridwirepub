import { createFileRoute } from "@tanstack/react-router";

/**
 * Hosted MCP endpoint (Streamable HTTP, stateless JSON).
 * Requires Bearer API key + organizations.ai_config.mcp_remote_enabled = true.
 *
 * Cursor / Claude remote config:
 *   { "url": "https://portal/api/mcp", "headers": { "Authorization": "Bearer …" } }
 */
export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { preflight } = await import("@/lib/api-serve.server");
        return preflight();
      },
      GET: async ({ request }) => {
        const { handleHostedMcpRequest } = await import("@/lib/mcp-hosted.server");
        return handleHostedMcpRequest(request);
      },
      POST: async ({ request }) => {
        const { handleHostedMcpRequest } = await import("@/lib/mcp-hosted.server");
        return handleHostedMcpRequest(request);
      },
      DELETE: async ({ request }) => {
        const { handleHostedMcpRequest } = await import("@/lib/mcp-hosted.server");
        return handleHostedMcpRequest(request);
      },
    },
  },
});
