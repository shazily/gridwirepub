/**
 * Canonical catalog of Gridwire platform capabilities — used by marketing and /features.
 */

export type PlatformFeatureCategoryId =
  | "ingestion"
  | "apis"
  | "security"
  | "lineage"
  | "workspace";

export type PlatformFeatureCategory = {
  id: PlatformFeatureCategoryId;
  title: string;
  description: string;
};

export type PlatformFeature = {
  id: string;
  category: PlatformFeatureCategoryId;
  title: string;
  description: string;
  /** Optional bullet highlights for the features page */
  bullets?: string[];
  badge?: "new";
};

export const PLATFORM_FEATURE_CATEGORIES: PlatformFeatureCategory[] = [
  {
    id: "ingestion",
    title: "Data ingestion",
    description: "Bring spreadsheets and files into governed datasets — upload, connect, or email.",
  },
  {
    id: "apis",
    title: "APIs & contracts",
    description: "Production REST endpoints, OpenAPI docs, and machine-readable contracts per dataset.",
  },
  {
    id: "security",
    title: "Security & governance",
    description: "Protection at the field level, access control, scanning, and auditability.",
  },
  {
    id: "lineage",
    title: "Lineage & observability",
    description: "See where data came from, how it was mapped, and what changed between versions.",
  },
  {
    id: "workspace",
    title: "Workspace & operations",
    description: "Teams, portals, quotas, alerts, and day-to-day admin for your organization.",
  },
];

export const PLATFORM_FEATURES: PlatformFeature[] = [
  {
    id: "parse-spreadsheets",
    category: "ingestion",
    title: "Multi-tab Excel & CSV parsing",
    description:
      "Upload workbooks with multiple sheets. Headers are normalized to API-safe names; formulas are read as computed values.",
    bullets: ["XLSX, XLS, and CSV", "Per-sheet column detection", "Row limits configurable per org"],
  },
  {
    id: "macro-detection",
    category: "ingestion",
    title: "Macro detection (safe ignore)",
    description: "VBA macros are detected and never executed — only cell data is ingested.",
  },
  {
    id: "email-ingest",
    category: "ingestion",
    title: "Governed email ingest",
    description:
      "Dedicated ingest address per workspace. Allowlisted senders, column templates, malware scan, and full audit trail before data is imported.",
    bullets: [
      "Inbound webhook from any mail gateway",
      "Template schema match (reject on drift)",
      "Test ingest panel without external mail",
    ],
    badge: "new",
  },
  {
    id: "connectors",
    category: "ingestion",
    title: "File connectors",
    description:
      "Companion worker pulls from SFTP, NFS/Samba network shares, or watched folders on a schedule.",
    bullets: ["Circuit-breaker health in admin", "Maps pulled files into dataset versions"],
  },
  {
    id: "incremental-load",
    category: "ingestion",
    title: "Incremental loads",
    description: "Merge new rows by configured key fields instead of full replace on every publish.",
  },
  {
    id: "versioning-diffs",
    category: "ingestion",
    title: "Versioning & schema diffs",
    description:
      "Every publish is a version. Compare column adds, removals, and type changes against the previous baseline.",
  },
  {
    id: "instant-rest-api",
    category: "apis",
    title: "Instant REST API",
    description: "Each published dataset gets versioned read endpoints — rows, schema, and metadata.",
    bullets: ["Filter by field equality", "limit, offset, and field projection"],
  },
  {
    id: "etag-polling",
    category: "apis",
    title: "ETag polling",
    description:
      "Responses include ETag and X-Dataset-Version. Send If-None-Match to poll cheaply — 304 when nothing changed.",
  },
  {
    id: "openapi-swagger",
    category: "apis",
    title: "OpenAPI 3 & Swagger UI",
    description: "Auto-generated OpenAPI spec and interactive docs for every dataset.",
  },
  {
    id: "data-contracts",
    category: "apis",
    title: "ODCS data contracts",
    description: "Published datasets expose contract.json and contract.yaml for downstream governance tools.",
  },
  {
    id: "export-formats",
    category: "apis",
    title: "Bulk export",
    description: "Download dataset snapshots as CSV, JSON, or Parquet from the export endpoint.",
  },
  {
    id: "public-secure-toggle",
    category: "apis",
    title: "Public or secure access",
    description: "Per-dataset toggle: open read access or API-key-only secure mode.",
  },
  {
    id: "field-protection",
    category: "security",
    title: "Mask, hash & encrypt fields",
    description:
      "Per-column protection — clear, mask, hash (SHA-256/512, SHA3, HMAC), or AES-256-GCM encrypt — enforced on every API response.",
  },
  {
    id: "pii-detection",
    category: "security",
    title: "PII auto-detection",
    description: "Upload flow suggests sensitive columns from header names and sample values.",
  },
  {
    id: "api-keys",
    category: "security",
    title: "Scoped API keys",
    description: "Create, rotate, and revoke keys. Usage is tied to your organization with audit events.",
  },
  {
    id: "audit-log",
    category: "security",
    title: "Audit log",
    description: "Owners and admins review data access, publishes, key changes, and ingest outcomes — exportable to CSV.",
  },
  {
    id: "clamav",
    category: "security",
    title: "ClamAV malware scanning",
    description: "Email ingest attachments are scanned before parsing when ClamAV is enabled in your deployment.",
  },
  {
    id: "portal-ip-allowlist",
    category: "security",
    title: "Portal IP allowlisting",
    description: "Restrict public portal pages by IP or CIDR before visitors reach your branded workspace landing.",
  },
  {
    id: "multi-tenant",
    category: "security",
    title: "Multi-tenant isolation",
    description: "Organizations with row-level isolation. Members belong to workspaces with owner, admin, member, and viewer roles.",
  },
  {
    id: "lineage-graph",
    category: "lineage",
    title: "Interactive lineage graph",
    description:
      "Visual graph on every dataset showing source files, field mappings, versions, and how data flowed into the API.",
    bullets: ["React Flow graph in the dataset UI", "Updates automatically on each publish"],
    badge: "new",
  },
  {
    id: "lineage-api",
    category: "lineage",
    title: "Lineage API (lineage.json)",
    description:
      "Machine-readable lineage graph at GET /api/v1/datasets/{id}/lineage.json for catalogs, stewards, and compliance tooling.",
    bullets: ["Nodes: source, field, dataset, version, connector", "Edges: mapped_to, published_as, derived_from, ingested_from"],
  },
  {
    id: "lineage-provenance",
    category: "lineage",
    title: "Upload & connector provenance",
    description: "Lineage records who published, which file or connector produced the version, and field rename/type changes.",
  },
  {
    id: "lineage-email",
    category: "lineage",
    title: "Email ingest in lineage",
    description: "Messages accepted via email ingest appear in the graph as ingested_from edges into dataset versions.",
  },
  {
    id: "schema-drift-lineage",
    category: "lineage",
    title: "Schema drift on the graph",
    description: "Type changes and new columns are captured as lineage edges so stewards can see what shifted between versions.",
  },
  {
    id: "workspaces-portal",
    category: "workspace",
    title: "Branded public portal",
    description: "Each workspace has /portal/{slug} — share a branded landing page and dataset catalog with your audience.",
  },
  {
    id: "team-access",
    category: "workspace",
    title: "Team & invites",
    description: "Invite links, role changes, and workspace switching for users in multiple organizations.",
  },
  {
    id: "storage-meter",
    category: "workspace",
    title: "Storage usage meter",
    description: "Gmail-style quota bar in the sidebar for every member; admins set caps and custom object storage backends.",
  },
  {
    id: "alerts",
    category: "workspace",
    title: "Alerts & notifications",
    description: "In-app feed for publishes, schema drift, connector failures, and ingest rejections — optional email delivery.",
  },
  {
    id: "feedback",
    category: "workspace",
    title: "Member feedback",
    description: "Any workspace member can submit bugs, ideas, or questions; admins review on the feedback console.",
  },
  {
    id: "help-manual",
    category: "workspace",
    title: "Help manual & contextual tips",
    description: "? icons on complex admin screens link to detailed guidance and FAQs after sign-in.",
  },
  {
    id: "usage-analytics",
    category: "workspace",
    title: "Usage analytics",
    description: "Admins see API consumption, storage trends, and workspace activity under Admin → Usage.",
  },
  {
    id: "sso-ready",
    category: "workspace",
    title: "SSO-ready authentication",
    description: "Configure OIDC or SAML for enterprise sign-in alongside local accounts and invite flows.",
  },
];

/** Curated subset for the marketing homepage hero slideshow (key platform capabilities) */
export const MARKETING_SLIDESHOW_FEATURE_IDS: string[] = [
  "parse-spreadsheets",
  "versioning-diffs",
  "field-protection",
  "api-keys",
  "openapi-swagger",
  "connectors",
  "multi-tenant",
  "alerts",
];

export type FeatureSpotlightStep = {
  step: string;
  title: string;
  desc: string;
};

export type FeatureSpotlight = {
  id: "lineage" | "email-ingest";
  title: string;
  description: string;
  steps: FeatureSpotlightStep[];
  footerNote: string;
  categoryAnchor: string;
  categoryLinkLabel: string;
};

/** Deep-dive sections on /features (not the marketing homepage) */
export const FEATURE_SPOTLIGHTS: FeatureSpotlight[] = [
  {
    id: "lineage",
    title: "Data lineage you can see — and machines can read",
    description:
      "Stewards and engineers need to know where data came from and what changed before it hit the API. Every published dataset includes an interactive lineage graph plus a lineage.json endpoint for catalogs and compliance tooling.",
    steps: [
      {
        step: "1",
        title: "Capture source",
        desc: "Uploads, connector pulls, and accepted email ingest are recorded as source nodes with actor and file metadata.",
      },
      {
        step: "2",
        title: "Map fields",
        desc: "Original spreadsheet columns link to API field names — including type changes between versions.",
      },
      {
        step: "3",
        title: "Explore graph",
        desc: "Open the Lineage tab on any dataset for a visual graph of sources → fields → versions → API.",
      },
      {
        step: "4",
        title: "Integrate",
        desc: "Pull the same graph as JSON from GET /api/v1/datasets/{id}/lineage.json for stewards and downstream tools.",
      },
    ],
    footerNote: "Lineage is built automatically on publish — no extra configuration.",
    categoryAnchor: "lineage",
    categoryLinkLabel: "All lineage features",
  },
  {
    id: "email-ingest",
    title: "Email ingest with governance — for orgs where mail is not your data platform",
    description:
      "Critical Excel files are still emailed between teams and often never reach a secured data environment. Gridwire gives each workspace a dedicated ingest address, allowlisted senders, uploaded column templates, attachment scanning, and a full audit trail for every received, rejected, quarantined, or accepted message.",
    steps: [
      {
        step: "1",
        title: "Configure address",
        desc: "Set a dedicated ingest address per workspace (e.g. reports@ingest.yourdomain.com). Route via your mail gateway or forward from corporate mail.",
      },
      {
        step: "2",
        title: "Allowlist & template",
        desc: "Only approved senders. Upload the Excel template so attachments must match expected columns.",
      },
      {
        step: "3",
        title: "Scan & validate",
        desc: "Attachments scanned (ClamAV when enabled), parsed, and rejected instantly if the schema does not match.",
      },
      {
        step: "4",
        title: "Import & audit",
        desc: "Valid files publish as a new dataset version automatically. Every outcome is logged with a link to the dataset.",
      },
    ],
    footerNote:
      "Use forwarding or journaling from your organization mail server, or any inbound gateway that POSTs parsed JSON to Gridwire. Gridwire does not host a mailbox UI — it receives webhooks and processes attachments in isolation.",
    categoryAnchor: "ingestion",
    categoryLinkLabel: "Ingestion features",
  },
];

export const MARKETING_WHATS_NEW: { title: string; desc: string; featureId?: string }[] = [
  {
    title: "Interactive data lineage",
    desc: "Every dataset includes a lineage graph and lineage.json API — trace uploads, field mappings, connectors, and email ingest through to published versions.",
    featureId: "lineage-graph",
  },
  {
    title: "Governed email ingest pipeline",
    desc: "Stop losing spreadsheets in inboxes. Teams email Excel to a workspace ingest address — Gridwire validates templates, scans attachments, and logs every outcome.",
    featureId: "email-ingest",
  },
  {
    title: "Dedicated workspace ingest address",
    desc: "Configure a reports@ingest.yourdomain.com address per workspace. Only allowlisted senders and matching column templates are accepted.",
  },
  {
    title: "Storage usage meter",
    desc: "Gmail-style sidebar bar shows how much of your workspace quota is used — visible to every member, not just admins.",
    featureId: "storage-meter",
  },
  {
    title: "Portal IP allowlisting",
    desc: "Restrict public portal access by IP or CIDR. Regenerate portal links without breaking old URLs via slug aliases.",
    featureId: "portal-ip-allowlist",
  },
  {
    title: "Help manual & contextual tips",
    desc: "Full admin guide with ? icons on complex settings — authentication, outbound email, storage, security, and email ingest.",
    featureId: "help-manual",
  },
];

export function getFeatureById(id: string): PlatformFeature | undefined {
  return PLATFORM_FEATURES.find((f) => f.id === id);
}

export function getFeaturesByCategory(categoryId: PlatformFeatureCategoryId): PlatformFeature[] {
  return PLATFORM_FEATURES.filter((f) => f.category === categoryId);
}
