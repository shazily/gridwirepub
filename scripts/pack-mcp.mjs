#!/usr/bin/env bun
/**
 * Pack @gridwire/mcp-server for end-user download (no node_modules).
 * Output: public/downloads/gridwire-mcp-server.zip
 */
import { $ } from "bun";
import { mkdirSync, existsSync, writeFileSync, rmSync, cpSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dir, "..");
const mcpDir = join(root, "mcp");
const outDir = join(root, "public", "downloads");
const staging = join(outDir, "_mcp-staging");
const zipPath = join(outDir, "gridwire-mcp-server.zip");

mkdirSync(outDir, { recursive: true });
if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

console.log("Building MCP package…");
await $`bun run build`.cwd(mcpDir);

const files = ["package.json", "README.md", "tsconfig.json"];
for (const f of files) {
  cpSync(join(mcpDir, f), join(staging, f));
}
cpSync(join(mcpDir, "dist"), join(staging, "dist"), { recursive: true });
cpSync(join(mcpDir, "src"), join(staging, "src"), { recursive: true });

writeFileSync(
  join(staging, "INSTALL.txt"),
  `Gridwire MCP server — offline / downloadable install
=====================================================

1. Unzip this archive.
2. Install dependencies:
     bun install
   or:
     npm install
3. Run:
     bun run start
   or after build:
     node dist/index.js

Required environment:
  GRIDWIRE_BASE_URL=https://your-portal.example
  GRIDWIRE_API_KEY=your-workspace-api-key

Optional:
  GRIDWIRE_DATASET_IDS=uuid,uuid

Cursor mcp.json example is in README.md.
Remote hosted MCP (when enabled by your org admin):
  POST/GET https://your-portal.example/api/mcp
  Authorization: Bearer YOUR_API_KEY

Docs: https://github.com/shazily/gridwire (folder: mcp/)
`,
);

if (existsSync(zipPath)) rmSync(zipPath, { force: true });

const isWin = process.platform === "win32";
if (isWin) {
  // Quote paths so spaces (e.g. "Excel2API Hub") survive PowerShell parsing.
  const ps = `Compress-Archive -Path (Join-Path -Path '${staging.replace(/'/g, "''")}' -ChildPath '*') -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", ps],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`Compress-Archive failed with exit ${result.status}`);
  }
} else {
  await $`zip -r ${zipPath} .`.cwd(staging);
}

rmSync(staging, { recursive: true, force: true });

if (!existsSync(zipPath)) {
  throw new Error(`Failed to create zip at ${zipPath}`);
}
const size = statSync(zipPath).size;
console.log(`Wrote ${zipPath} (${size} bytes)`);
