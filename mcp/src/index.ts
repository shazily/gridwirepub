#!/usr/bin/env node
/**
 * Gridwire MCP server — stdio transport.
 *
 * Env:
 *   GRIDWIRE_BASE_URL   Portal origin (required)
 *   GRIDWIRE_API_KEY    Workspace API key (required)
 *   GRIDWIRE_DATASET_IDS  Optional comma-separated dataset UUID allowlist
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createGridwireMcpServer } from "./server.js";

export { createGridwireMcpServer } from "./server.js";
export { loadConfig } from "./config.js";
export { GridwireClient } from "./client.js";

async function main() {
  // Never write secrets or row payloads to stderr/stdout beyond MCP framing.
  const config = loadConfig();
  const server = createGridwireMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  // stderr only — stdout is reserved for MCP JSON-RPC.
  console.error(`[gridwire-mcp] failed to start: ${msg}`);
  process.exit(1);
});
