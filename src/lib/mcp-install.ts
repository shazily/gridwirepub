/**
 * Copy-paste MCP install snippets for Cursor / Claude Desktop.
 * Used by Admin → API docs and the dataset API tab.
 */

export type McpInstallOptions = {
  baseUrl: string;
  /** When set, restricts the MCP server to these dataset UUIDs. */
  datasetIds?: string[];
  /** Absolute path hint for local bun runs (optional). */
  localEntryHint?: string;
};

export function buildCursorMcpJson(opts: McpInstallOptions): string {
  const env: Record<string, string> = {
    GRIDWIRE_BASE_URL: opts.baseUrl.replace(/\/$/, ""),
    GRIDWIRE_API_KEY: "YOUR_API_KEY",
  };
  if (opts.datasetIds?.length) {
    env.GRIDWIRE_DATASET_IDS = opts.datasetIds.join(",");
  }

  const config = {
    mcpServers: {
      gridwire: {
        command: "npx",
        args: ["-y", "@gridwire/mcp-server"],
        env,
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

export function buildClaudeDesktopMcpJson(opts: McpInstallOptions): string {
  // Same shape as Cursor for Claude Desktop's claude_desktop_config.json
  return buildCursorMcpJson(opts);
}

export function buildLocalBunMcpJson(opts: McpInstallOptions & { entryPath: string }): string {
  const env: Record<string, string> = {
    GRIDWIRE_BASE_URL: opts.baseUrl.replace(/\/$/, ""),
    GRIDWIRE_API_KEY: "YOUR_API_KEY",
  };
  if (opts.datasetIds?.length) {
    env.GRIDWIRE_DATASET_IDS = opts.datasetIds.join(",");
  }
  return JSON.stringify(
    {
      mcpServers: {
        gridwire: {
          command: "bun",
          args: ["run", opts.entryPath],
          env,
        },
      },
    },
    null,
    2,
  );
}

/** Remote hosted MCP (requires org ai_config.mcp_remote_enabled). */
export function buildRemoteMcpJson(opts: McpInstallOptions): string {
  const base = opts.baseUrl.replace(/\/$/, "");
  return JSON.stringify(
    {
      mcpServers: {
        gridwire: {
          url: `${base}/api/mcp`,
          headers: {
            Authorization: "Bearer YOUR_API_KEY",
          },
        },
      },
    },
    null,
    2,
  );
}

export const MCP_DOWNLOAD_PATH = "/api/public/mcp/download";
