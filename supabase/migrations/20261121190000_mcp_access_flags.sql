-- MCP governance: per-dataset AI/MCP visibility + org remote MCP toggle (via ai_config).

ALTER TABLE public.datasets
  ADD COLUMN IF NOT EXISTS mcp_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.datasets.mcp_enabled IS
  'When false, dataset is hidden from MCP list/query tools (REST API still works). Steward AI-access policy.';

-- Org remote MCP is stored on organizations.ai_config.mcp_remote_enabled (boolean, default false).
-- No schema change required for JSON config.
