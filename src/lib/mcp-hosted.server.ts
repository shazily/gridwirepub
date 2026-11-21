/**
 * Hosted (remote) MCP over Streamable HTTP — enabled per-org via ai_config.mcp_remote_enabled.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  checkRateLimit,
  getAdmin,
  json,
  resolvePublicOrigin,
  validateApiKey,
} from "@/lib/api-serve.server";
import { getOrgAiConfig } from "@/lib/llm-api-keys.server";

export async function handleHostedMcpRequest(request: Request): Promise<Response> {
  const admin = await getAdmin();
  const keyRes = await validateApiKey(admin, request);
  if (!keyRes.ok) {
    const msg = keyRes.reason === "missing" ? "Missing API key" : "Invalid API key";
    return json({ error: msg }, 401, { "WWW-Authenticate": 'Bearer realm="mcp"' });
  }

  const orgId = keyRes.key.org_id;
  const aiConfig = await getOrgAiConfig(orgId);
  if (!aiConfig.mcp_remote_enabled) {
    return json(
      {
        error: "Remote MCP is disabled for this workspace",
        hint: "An org admin can enable it under Admin → AI / PDF (MCP remote access).",
      },
      403,
    );
  }

  const rl = checkRateLimit(request, keyRes.key.id);
  if (!rl.ok) return rl.response;

  const origin = resolvePublicOrigin(request);
  const auth = request.headers.get("authorization") ?? "";
  const apiKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  const started = Date.now();
  try {
    // Load MCP server from sibling package (same repo).
    const { createGridwireMcpServer } = await import("../../mcp/src/server.ts");
    const mcp = createGridwireMcpServer({
      baseUrl: origin,
      apiKey,
      datasetAllowlist: null,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await mcp.connect(transport);
    const response = await transport.handleRequest(request);

    try {
      await admin.from("audit_events").insert({
        org_id: orgId,
        dataset_id: null,
        actor_id: null,
        actor_label: keyRes.key.name ? `API key:${keyRes.key.name}` : "API key",
        action: "mcp.tool_call",
        details: {
          method: request.method,
          path: "/api/mcp",
          transport: "streamable_http",
          latency_ms: Date.now() - started,
          api_key_id: keyRes.key.id,
          // Row payloads intentionally omitted.
        },
      });
    } catch {
      /* ignore */
    }

    try {
      await admin
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", keyRes.key.id);
    } catch {
      /* ignore */
    }

    return response;
  } catch (err) {
    return json(
      {
        error: "MCP request failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      500,
    );
  }
}
