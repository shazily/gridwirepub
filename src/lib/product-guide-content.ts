/**
 * Product & Security Guide — content sourced from implemented code only.
 * Screenshots: public/product-guide/*.png (captured from live portal).
 * Doc version tracks narrative revisions, not git tags.
 */

export const PRODUCT_GUIDE_META = {
  title: "Gridwire — Product & Security Guide",
  subtitle: "Architecture, features, deployment, and answers for security leadership",
  version: "1.0",
  date: "2026-07-21",
  classification: "Public — suitable for prospects, IT, and InfoSec review",
  honesty:
    "Every capability below is verified against the Gridwire codebase and a live on-prem portal capture. Items that are configuration-only, partially wired, or not enforced are called out explicitly. Do not treat marketing copy elsewhere as superseding this document.",
} as const;

export type GuideShot = {
  src: string;
  alt: string;
  caption: string;
};

export type GuideSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  shots?: GuideShot[];
  /** Explicit limitations / non-claims */
  caveats?: string[];
  table?: { headers: string[]; rows: string[][] };
};

export const GUIDE_TOC: { id: string; title: string }[] = [
  { id: "executive", title: "1. Executive summary" },
  { id: "scope", title: "2. Scope and honesty" },
  { id: "architecture", title: "3. Architecture" },
  { id: "features", title: "4. Feature tour" },
  { id: "admin", title: "5. Admin control plane" },
  { id: "deploy", title: "6. Deploy, configure, test" },
  { id: "infosec", title: "7. InfoSec / CRO questionnaire" },
  { id: "change", title: "8. What can and cannot change" },
  { id: "limitations", title: "9. Known limitations" },
];

export const FEATURE_SHOTS: GuideShot[] = [
  {
    src: "/product-guide/01-home.png",
    alt: "Instance home / setup landing",
    caption: "Home — on-prem setup landing (or marketing homepage when VITE_SHOW_MARKETING=true).",
  },
  {
    src: "/product-guide/02-auth.png",
    alt: "Sign-in page",
    caption: "Sign-in — on-prem auth layout (username/email + password). Marketing builds use a different hero layout and optional Google OAuth.",
  },
  {
    src: "/product-guide/03-dashboard.png",
    alt: "Workspace dashboard",
    caption: "Dashboard — dataset counts, published APIs, API keys, and recent activity for the current workspace.",
  },
  {
    src: "/product-guide/04-datasets.png",
    alt: "Datasets list",
    caption: "Datasets — list and filter workspace datasets; entry to new upload and PDF reviews.",
  },
  {
    src: "/product-guide/05-datasets-new.png",
    alt: "New dataset wizard",
    caption: "New dataset — multi-step wizard for CSV/Excel/PDF upload, field mapping, and publish.",
  },
  {
    src: "/product-guide/27-dataset-detail.png",
    alt: "Dataset detail",
    caption: "Dataset detail — field protection (mask/hash/encrypt), preview, versions, API snippets, secure vs public.",
  },
  {
    src: "/product-guide/06-pdf-reviews.png",
    alt: "PDF reviews queue",
    caption: "PDF reviews — human gate for AI-assisted PDF table extraction drafts before publish.",
  },
  {
    src: "/product-guide/10-help.png",
    alt: "In-app help manual",
    caption: "Help — searchable manual derived from implemented behavior (includes stub callouts).",
  },
];

export const ADMIN_SHOTS: GuideShot[] = [
  {
    src: "/product-guide/12-admin.png",
    alt: "Admin overview",
    caption: "Admin overview — counts and links to every admin surface (owner/admin only).",
  },
  {
    src: "/product-guide/15-admin-team.png",
    alt: "Team and access",
    caption: "Team & access — local users, invite links, roles, disable/revoke, password reset for local accounts.",
  },
  {
    src: "/product-guide/18-admin-authentication.png",
    alt: "Authentication settings",
    caption: "Authentication — public app URL, auth mode, join-by-org-ID, OIDC/SAML fields (stored), MFA enrollment UI.",
  },
  {
    src: "/product-guide/16-admin-security.png",
    alt: "Portal IP allowlist",
    caption: "Security — portal IP allowlist enforce toggle and CIDR rules for /portal/{slug}.",
  },
  {
    src: "/product-guide/22-admin-api-keys.png",
    alt: "API keys",
    caption: "API keys — create scoped keys (hash stored, raw shown once), rotate, revoke.",
  },
  {
    src: "/product-guide/24-admin-connectors.png",
    alt: "Connectors",
    caption: "Connectors — SFTP/NFS/folder polling config; secrets live in worker env (SFTP_SECRETS), not the database.",
  },
  {
    src: "/product-guide/20-admin-email-ingest.png",
    alt: "Email ingest",
    caption: "Email ingest — inbound webhook mailbox, sender allowlist, templates, ClamAV status for inbound/PDF paths.",
  },
  {
    src: "/product-guide/25-admin-audit.png",
    alt: "Audit log",
    caption: "Audit log — filterable audit_events with CSV export (insert-oriented application logging).",
  },
  {
    src: "/product-guide/26-admin-usage.png",
    alt: "Usage analytics",
    caption: "Usage — 30-day API call chart, top endpoints, errors, rows served, connector run stats.",
  },
  {
    src: "/product-guide/23-admin-api-docs.png",
    alt: "API documentation",
    caption: "API docs — in-product documentation for Bearer auth, ETag polling, cURL/Postman examples.",
  },
];

export const ARCHITECTURE_LAYERS: { layer: string; components: string; role: string }[] = [
  {
    layer: "Edge / browser",
    components: "Portal (TanStack Start on Node), Kong gateway",
    role: "UI, public routes, API gateway to GoTrue + PostgREST + portal APIs",
  },
  {
    layer: "Identity",
    components: "Supabase GoTrue",
    role: "Email/password sessions, JWT issuance, TOTP MFA enrollment support at the auth daemon",
  },
  {
    layer: "Application",
    components: "Portal server routes under /api/v1 and /api/public",
    role: "Publish, mask at serve, ingest webhooks, worker ingest, password recover mailer, governance RPCs via PostgREST",
  },
  {
    layer: "Data plane",
    components: "PostgreSQL 15 (Supabase image), PostgREST",
    role: "Tenant tables, RLS policies, SECURITY DEFINER RPCs, dataset rows/versions",
  },
  {
    layer: "Object storage",
    components: "MinIO (S3 API)",
    role: "Raw uploads, Parquet version snapshots, logos",
  },
  {
    layer: "Workers",
    components: "gridwire-worker, ClamAV",
    role: "Scheduled connector pulls; malware scan on PDF/email/worker PDF paths",
  },
];

export const INFOSEC_QA: { q: string; a: string }[] = [
  {
    q: "Where does data reside?",
    a: "In a self-hosted deployment, relational data is in the Postgres container (or your DATABASE_URL), and files/Parquet snapshots are in MinIO or a configured S3-compatible store. The portal does not require a Gridwire SaaS backend. Cloud Supabase is only used if you point SUPABASE_URL there yourself.",
  },
  {
    q: "Is multi-tenancy enforced?",
    a: "Yes at the application data model: organizations, org_members, and RLS helpers (is_org_member / has_org_role) gate browser access. Server paths that use the service role intentionally bypass RLS and must enforce org checks in code (documented pattern in client.server.ts). There is no cross-tenant UI for switching into another org without membership.",
  },
  {
    q: "How are API consumers authenticated?",
    a: "Dataset APIs under /api/v1 require a Bearer API key for secure datasets (SHA-256 hash stored in api_keys). Public datasets can be read without a key when published as public. Keys are shown once at creation; rotation and revoke are supported in Admin → API keys.",
  },
  {
    q: "How is field-level protection applied?",
    a: "Per-column protection modes none | mask | hash | encrypt on dataset_fields. Protection is applied at ingest/publish (applyProtectionAtIngest) and again at API serve (applyMask). Encrypt uses FIELD_ENCRYPTION_KEY (AES-256-GCM). Losing that key loses decryptability of encrypted fields.",
  },
  {
    q: "Do you scan uploads for malware?",
    a: "ClamAV is integrated for PDF ingest drafts, email inbound attachments, and worker PDF ingest when CLAMAV_HOST is reachable. Direct CSV/Excel upload through the portal wizard is not ClamAV-scanned in the current code. Default CLAMAV_REQUIRED=false allows skip when ClamAV is unavailable.",
  },
  {
    q: "Is SSO production-ready out of the box?",
    a: "Admin → Authentication stores OIDC issuer, client ID, SAML metadata URL, auth_mode, and group→role mappings. The UI marks SSO as “configured” when those fields are non-empty. Full GoTrue IdP wiring is an operator responsibility; there is no one-click Azure AD login from those fields alone. Marketing builds may offer Google OAuth via Supabase. The AD group sync helper exists but is not invoked by a shipped webhook route.",
  },
  {
    q: "Is MFA mandatory for admins?",
    a: "TOTP enrollment works (Settings and Admin → Authentication). mfa_required_roles is persisted on the organization, but the portal does not currently enforce MFA at login middleware. Treat mandatory MFA as an operational gap unless you enforce it at the IdP or add enforcement.",
  },
  {
    q: "How do password resets work on-prem?",
    a: "POST /api/public/auth/recover uses the platform mailer (Postmark or SMTP from .env), not Admin → Authentication org SMTP fields. Reset links prefer Public app URL / PUBLIC_APP_URL over loopback. Org SMTP in the UI is saved but not used by sendEmail() today.",
  },
  {
    q: "What is logged for audit?",
    a: "audit_events records security-relevant actions (keys, invites, members, dataset lifecycle, API access logging paths). Admin → Audit supports filter and CSV export. This is application logging with insert-oriented writes — not a separate WORM appliance or legal hold product.",
  },
  {
    q: "Can users join orgs without invites?",
    a: "Only if an admin enables allow_join_by_org_id. Joiners become Viewer. Failures use a single generic error to reduce org discovery. Invite links remain the path for Contributor+ roles. Admin can also create local users.",
  },
  {
    q: "How are connector secrets handled?",
    a: "Connector passwords/keys are not stored in Postgres. The worker reads SFTP_SECRETS from environment. Optional CONNECTOR_ALLOWED_ROOT jails local folder paths; connector-host-guard restricts SSRF-prone hosts unless ALLOW_INTERNAL_CONNECTOR_HOSTS is set.",
  },
  {
    q: "What network exposure does a default on-prem compose have?",
    a: "By default host binds are loopback-only: portal 127.0.0.1:3020, Kong 127.0.0.1:3040, Postgres 127.0.0.1:54332. Exposing beyond loopback is an operator choice and requires TLS termination, secret rotation, and METRICS_TOKEN / INBOUND_WEBHOOK_SECRET hardening.",
  },
  {
    q: "Is the audit log tamper-proof?",
    a: "No claim of cryptographic immutability is made. Database superusers and service-role access can modify data. Treat Postgres backups, access control, and OS hardening as the integrity controls.",
  },
  {
    q: "What about supply chain / licenses?",
    a: "Gridwire is MIT-licensed open source (see repository LICENSE). Dependency licenses must be reviewed from lockfiles for your compliance program; this guide does not assert a completed SBOM attestation for every transitive package.",
  },
  {
    q: "Which admin alert emails actually fire?",
    a: "Admin → Alerts stores toggles and recipients. The most reliable automated email path today is connector_error via the worker report dispatcher. Several UI event types are configuration-only or partially wired; ingestion_error is listed but not emitted by current app code. Only the first recipient address is emailed by the current dispatcher.",
  },
];

export const CHANGE_CONTROL: { can: string; cannot: string }[] = [
  {
    can: "Org branding, portal slug (with aliases), quotas, IP allowlist, API keys, invites, member roles, dataset publish/archive, field protection modes, connector schedules (non-secret config), LLM API keys when FIELD_ENCRYPTION_KEY is set, join-by-org toggle",
    cannot: "Bypass RLS from the browser JWT; read another org’s data without membership; recover encrypt-mode field plaintext without FIELD_ENCRYPTION_KEY; auto-enforce MFA from UI toggles alone; send mail via org SMTP fields (platform .env only); store SFTP passwords in the database",
  },
];

export const DEPLOY_STEPS: { title: string; body: string }[] = [
  {
    title: "Bootstrap",
    body: "Run scripts/deploy.ps1 bootstrap (Windows) or scripts/bootstrap-onprem.sh — generates .env with JWT keys, Postgres password, MinIO creds, FIELD_ENCRYPTION_KEY, WORKER_INGEST_TOKEN.",
  },
  {
    title: "Bring stack up",
    body: "scripts/deploy.ps1 up (GRIDWIRE_DEPLOYMENT=onprem) starts db → auth → rest → kong, applies supabase/migrations via apply-migrations, builds portal + worker, runs smoke tests.",
  },
  {
    title: "Verify",
    body: "GET /api/public/health and /api/public/ready on the portal; smoke-test.ps1; open http://127.0.0.1:3020. Create first workspace as owner, or join via UUID when allow_join_by_org_id is enabled.",
  },
  {
    title: "Configure",
    body: "Set PUBLIC_APP_URL to the browser-reachable HTTPS URL. Configure Postmark or SMTP for password reset. Optionally set CLAMAV_REQUIRED=true, INBOUND_WEBHOOK_SECRET, METRICS_TOKEN, SFTP_SECRETS, CONNECTOR_ALLOWED_ROOT.",
  },
  {
    title: "Admin control",
    body: "Use Admin console: Team, Authentication, Security (IP allowlist), Storage quotas, API keys, Connectors, Audit, Usage. Prefer invite links for privileged roles; enable join-by-org only when Viewer self-join is acceptable.",
  },
  {
    title: "Test data plane",
    body: "Upload a CSV via Datasets → New, publish, create an API key, call /api/v1/datasets/{id}/{sheet} with Authorization: Bearer <key>. Confirm ETag/If-None-Match 304 behavior from Admin → API docs guidance.",
  },
];

export const LIMITATIONS: string[] = [
  "SSO fields in Admin are configuration storage; live IdP login requires operator GoTrue/IdP wiring (except optional Google OAuth on marketing builds).",
  "AD/IdP group→role sync helper is not hooked to a production webhook route in-tree.",
  "Org SMTP and SMS settings are persisted but not used by the platform mailer or an OTP sender.",
  "mfa_required_roles is not enforced by portal login middleware.",
  "ClamAV does not scan portal CSV/Excel uploads — PDF/email/worker PDF paths only.",
  "Admin alert email dispatch is incomplete for several event types; first recipient only.",
  "Public Swagger UI at /docs/{datasetId} loads Swagger from unpkg CDN (needs outbound network unless you replace that).",
  "IPv6 portal allowlisting is limited compared to IPv4 CIDR support.",
];
