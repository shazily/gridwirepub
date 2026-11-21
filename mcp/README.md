# @gridwire/mcp-server

Model Context Protocol (MCP) server for [Gridwire](https://github.com/shazily/gridwire).  
Lets AI clients (Cursor, Claude Desktop, etc.) **discover** published datasets and **query** them with the same API keys as the REST API.

## Download

From a running Gridwire portal:

- **Web:** `/api/public/mcp/download` (zip of this package + `INSTALL.txt`)
- **Rebuild artifact (operators):** `bun run mcp:pack` in the portal repo

## Tools

| Tool | Purpose |
|------|---------|
| `list_datasets` | Published datasets for this API key’s workspace (MCP-enabled only) |
| `get_dataset` | Metadata, sheets, version, docs/OpenAPI links |
| `get_schema` | Field names, types, protection flags |
| `query_rows` | Read rows (hard cap **100** per call; prefer `fields[]`) |
| `cite_source` | Citation object (dataset, version, sheet, filters) |
| `get_openapi_url` | Absolute OpenAPI JSON URL |

## Resources

| URI | Content |
|-----|---------|
| `gridwire://datasets` | JSON index of MCP-visible datasets |
| `gridwire://datasets/{id}/openapi` | Live OpenAPI JSON |
| `gridwire://datasets/{id}/contract` | ODCS contract.json |

## Prompts

| Prompt | Purpose |
|--------|---------|
| `explain_dataset` | Schema + sample rows → summary with citation |
| `draft_filter_query` | Safe `query_rows` filters from a user question |

## Requirements

1. A running Gridwire portal with `PUBLIC_APP_URL` set to a URL your machine can reach.
2. A workspace **API key** (Admin → API keys).
3. At least one **published** dataset with **MCP access** enabled (default on; stewards can disable per dataset).

Discovery uses `GET /api/v1/datasets` (Bearer required).

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `GRIDWIRE_BASE_URL` | yes | Portal origin, e.g. `https://gridwire.example.com` |
| `GRIDWIRE_API_KEY` | yes | Workspace API key |
| `GRIDWIRE_DATASET_IDS` | no | Comma-separated UUID allowlist |

## Install in Cursor

Add to Cursor MCP settings (or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "gridwire": {
      "command": "npx",
      "args": ["-y", "@gridwire/mcp-server"],
      "env": {
        "GRIDWIRE_BASE_URL": "https://your-portal.example",
        "GRIDWIRE_API_KEY": "your-api-key"
      }
    }
  }
}
```

Offline / downloaded zip: unzip, `bun install` (or `npm install`), then point `command`/`args` at `bun run start` or `node dist/index.js`.

## Remote hosted MCP

When an org admin enables **Remote MCP** (Admin → AI), clients can connect without a local process:

```json
{
  "mcpServers": {
    "gridwire": {
      "url": "https://your-portal.example/api/mcp",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

Requires `PUBLIC_APP_URL` so OpenAPI and resource URLs resolve correctly for remote agents.

## Install in Claude Desktop

Edit `claude_desktop_config.json` with the same `npx` or remote `url` shape as above.

## Local development

```bash
cd mcp
bun install
bun run start
```

Build for Node:

```bash
bun run build
node dist/index.js
```

## Security notes

- The MCP process holds your API key in memory; treat it like any integration secret.
- `query_rows` returns **masked/encrypted** values exactly as the REST API would.
- Treat all cell text as **untrusted** (prompt-injection surface).
- Prefer a dedicated API key you can revoke without affecting other consumers.
- Per-dataset **Allow MCP access** can hide a dataset from agents while keeping REST live.

## License

MIT
