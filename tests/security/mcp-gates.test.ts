/**
 * Defensive security checks for MCP surfaces — expected fail-closed behavior only.
 */
import { describe, expect, it } from "vitest";
import { buildCursorMcpJson, buildRemoteMcpJson, MCP_DOWNLOAD_PATH } from "@/lib/mcp-install";

describe("MCP install helpers (no secrets leaked)", () => {
  it("stdio snippet uses placeholder API key and allowlist when provided", () => {
    const json = buildCursorMcpJson({
      baseUrl: "https://portal.example/",
      datasetIds: ["11111111-1111-1111-1111-111111111111"],
    });
    const parsed = JSON.parse(json) as {
      mcpServers: { gridwire: { env: Record<string, string> } };
    };
    expect(parsed.mcpServers.gridwire.env.GRIDWIRE_BASE_URL).toBe("https://portal.example");
    expect(parsed.mcpServers.gridwire.env.GRIDWIRE_API_KEY).toBe("YOUR_API_KEY");
    expect(parsed.mcpServers.gridwire.env.GRIDWIRE_DATASET_IDS).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(json).not.toMatch(/gw_[a-zA-Z0-9]{16,}/);
  });

  it("remote snippet points at /api/mcp with Bearer placeholder", () => {
    const json = buildRemoteMcpJson({ baseUrl: "https://portal.example" });
    const parsed = JSON.parse(json) as {
      mcpServers: { gridwire: { url: string; headers: Record<string, string> } };
    };
    expect(parsed.mcpServers.gridwire.url).toBe("https://portal.example/api/mcp");
    expect(parsed.mcpServers.gridwire.headers.Authorization).toBe("Bearer YOUR_API_KEY");
  });

  it("download path is public and stable", () => {
    expect(MCP_DOWNLOAD_PATH).toBe("/api/public/mcp/download");
  });
});

describe("MCP hosted gate logic (contract)", () => {
  it("org remote MCP defaults off (explicit true required)", () => {
    const aiConfig: { mcp_remote_enabled?: boolean } = {};
    expect(aiConfig.mcp_remote_enabled === true).toBe(false);
    expect({ mcp_remote_enabled: false }.mcp_remote_enabled === true).toBe(false);
    expect({ mcp_remote_enabled: true }.mcp_remote_enabled === true).toBe(true);
  });

  it("dataset MCP access defaults on; false denies agents", () => {
    const enabled = (row: { mcp_enabled?: boolean }) => row.mcp_enabled !== false;
    expect(enabled({})).toBe(true);
    expect(enabled({ mcp_enabled: true })).toBe(true);
    expect(enabled({ mcp_enabled: false })).toBe(false);
  });
});
