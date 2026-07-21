/**
 * Authoritative in-app help content — derived from implemented product behavior.
 * Do not describe features that are UI-only stubs without labeling them clearly.
 */

export type HelpLink = { to: string; label: string };

export type HelpArticle = {
  id: string;
  title: string;
  category: string;
  /** Free-text body paragraphs */
  paragraphs: string[];
  /** Bullet points */
  bullets?: string[];
  /** Explicit "not wired / stub" callouts */
  caveats?: string[];
  links?: HelpLink[];
  keywords?: string[];
};

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "password-reset-email",
    title: "How password-reset emails are sent",
    category: "Email & authentication",
    keywords: ["forgot password", "reset", "postmark", "smtp", "recover", "noreply"],
    paragraphs: [
      "On this on-prem / marketing deployment, Forgot password does not use the SMTP fields under Admin → Authentication. It uses the platform mailer in the portal server process, configured only via deployment environment variables (.env).",
      "Flow: the sign-in page calls POST /api/public/auth/recover → the server generates a GoTrue recovery token with the service role → builds a portal link /reset-password?token_hash=…&type=recovery → sends that link with sendEmail().",
      "sendEmail() prefers Postmark HTTP when POSTMARK_API_TOKEN is set; otherwise it uses nodemailer SMTP when SMTP_HOST and a From address are set. If SKIP_EMAIL=true, no mail is sent.",
      "The reset link hostname comes from (in order): the org’s Public app URL (auth_config.public_app_url), then PUBLIC_APP_URL / SITE_URL if they are not loopback, then the browser origin the user was on when they requested the reset.",
    ],
    bullets: [
      "Required for Postmark: POSTMARK_API_TOKEN, and a From address such as EMAIL_FROM_NOREPLY (or SMTP_FROM).",
      "Optional Postmark: POSTMARK_API_URL, POSTMARK_MESSAGE_STREAM, POSTMARK_TAG, EMAIL_FROM_NOTIFICATIONS / SUPPORT / INFO / AUTH.",
      "SMTP fallback: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE, SMTP_SENDER_NAME.",
      "Public URL: PUBLIC_APP_URL and SITE_URL (and optionally Admin → Authentication → Public app URL).",
      "Availability flag: GET /api/public/config returns password_reset_available from emailDeliveryConfigured().",
    ],
    caveats: [
      "Admin → Authentication → Org email (SMTP) is saved to organizations.smtp_config but is not read by sendEmail() today. Configuring it in the UI does not send password-reset mail.",
      "Non-on-prem (cloud) sign-in uses supabase.auth.resetPasswordForEmail instead of /api/public/auth/recover; that path relies on GoTrue’s own SMTP settings, not the Admin SMTP form.",
    ],
    links: [
      { to: "/admin/authentication", label: "Authentication (Public app URL)" },
      { to: "/auth", label: "Sign-in / forgot password" },
    ],
  },
  {
    id: "authentication-email",
    title: "Admin → Authentication (all options)",
    category: "Admin console",
    keywords: ["sso", "oidc", "saml", "mfa", "auth mode", "public app url", "ad group", "smtp", "sms"],
    paragraphs: [
      "Visible to workspace owners and admins. Settings are stored on the organization (auth_config, smtp_config, sms_config, mfa_required_roles).",
    ],
    bullets: [
      "Public app URL — used when building password-reset and setup links for this org (overrides loopback .env when set to a real https URL).",
      "Auth mode — local | sso | hybrid. Controls whether the branded portal sign-in page shows password signup/forgot-password (hidden when sso-only). Default behaves as hybrid.",
      "OIDC issuer URL / OIDC client ID / SAML metadata URL — stored for IdP configuration. Full browser SSO login against GoTrue still requires operator IdP wiring beyond saving these fields.",
      "AD / IdP group → role mapping — stored as group_role_mappings; used by the SSO group-sync helper when an IdP webhook/post-auth hook calls it. Owner is never auto-assigned.",
      "Org email (SMTP) — host, port, username, from. Saved to smtp_config. Not used by the platform mailer yet (see password-reset article).",
      "SMS OTP — provider + webhook URL saved to sms_config. Not used by a live OTP sender in app code yet.",
      "MFA policy toggles (require MFA for owners / admins) — saved to mfa_required_roles. Enrollment UI for your own TOTP works via Supabase MFA; automatic enforcement of the policy on every login is not implemented as middleware yet.",
      "Enroll TOTP — works for the signed-in user (Google/Microsoft Authenticator QR).",
    ],
    links: [{ to: "/admin/authentication", label: "Open Authentication" }],
  },
  {
    id: "team-access",
    title: "Admin → Team & access",
    category: "Admin console",
    keywords: ["invite", "create user", "username", "internal", "external", "disable", "password reset"],
    paragraphs: [
      "Owners and admins manage who can use the current workspace.",
    ],
    bullets: [
      "Add local user — creates (or attaches) an email/password auth user via the service role, adds org_members with role, user_type (internal/external), identity_source=local. Optionally emails a password setup/reset link via the platform mailer. Blocked when auth mode is SSO-only.",
      "Invite links — create_org_invite RPC; share /invite/{token}. Roles for invites: contributor, member, viewer.",
      "People list — change role (via update_org_member_role), change internal/external type, filter by role/type/source, soft-disable (disabled_at), revoke (delete membership), Reset password for local users only (SSO shows “Use company login”).",
      "Disabled members no longer appear in the user’s workspace switcher (filtered in membership load).",
      "Recent API consumption — last consumption_events for the org.",
    ],
    links: [{ to: "/admin/team", label: "Open Team & access" }],
  },
  {
    id: "marketing-signup",
    title: "Marketing sign-up and sign-in (username + email + password)",
    category: "Email & authentication",
    keywords: ["marketing", "signup", "username", "demo"],
    paragraphs: [
      "On the marketing homepage (VITE_SHOW_MARKETING), CTAs link to /auth?mode=signup and /auth?mode=signin.",
      "Sign up requires username (unique on profiles.username), email, and password. Username is stored on the profile and in auth user_metadata.",
      "Sign in accepts username or email + password. Usernames are resolved to email via POST /api/public/auth/resolve-login (service role RPC), then GoTrue signInWithPassword.",
    ],
    bullets: [
      "Username rules: 3–32 characters; letters, numbers, dots, underscores, hyphens; checked with /api/public/auth/username-available.",
      "This is the same /auth page used for org portals (?org=slug); portal auth_mode can hide password signup when SSO-only.",
    ],
    links: [{ to: "/auth", label: "Open auth" }],
  },
  {
    id: "alerts-overview",
    title: "How alerts and notifications work",
    category: "Alerts & notifications",
    keywords: ["bell", "alerts", "email", "workspace", "admins", "marketing"],
    paragraphs: [
      "There is no separate “marketing-only” alert product. Marketing and org demos both use the same org-scoped tables: alert_events (feed) and alerts (admin email config). Your marketing deploy simply has one or more organizations like any other deployment.",
      "Two audiences: workspace (all members, bell / Notifications page) and admins (admin event log on Admin → Alerts).",
    ],
    bullets: [
      "In-app workspace feed — /notifications and the header bell. Events with audience=workspace (e.g. publish, baseline_drift, email_ingest_*, pdf_review, dataset_lifecycle).",
      "Admin → Alerts — configure enabled event types + a shared comma-separated recipient list stored on the alerts table. Email dispatch for admin-audience events uses the platform mailer (Postmark/SMTP .env), not org SMTP.",
      "Email ingest notifications — separate table email_ingest_notification_recipients under Admin → Email ingest (per-address success/failure flags). Not the same list as Admin → Alerts.",
      "Sender rejection emails — on ingest failure, the original sender can get a noreply email explaining the rejection (platform mailer).",
    ],
    caveats: [
      "Admin → Alerts toggles for publish / baseline_drift / email_ingest_* primarily affect configuration UI; live email dispatch for admin audience is implemented for connector_error when the worker report path runs dispatchPendingAlertEmails. suspicious_access is recorded for admins but may not always trigger that dispatcher. ingestion_error is listed in the UI but is not emitted by current app code.",
      "dispatchPendingAlertEmails currently emails the first address in the recipients list only.",
    ],
    links: [
      { to: "/notifications", label: "Notifications" },
      { to: "/admin/alerts", label: "Admin alerts" },
      { to: "/admin/email-ingest", label: "Email ingest recipients" },
    ],
  },
  {
    id: "alerts-feedback",
    title: "Admin → Alerts options",
    category: "Admin console",
    keywords: ["connector_error", "publish", "suspicious", "recipients"],
    paragraphs: [
      "Owners/admins set which operational events should email the admin team and see the recent admin-audience event log.",
    ],
    bullets: [
      "Shared recipients field — comma-separated emails applied to all event-type rows for the org.",
      "Toggles: Dataset published/updated, Schema/baseline drift, Ingestion errors, Connector failures, Suspicious API access, Email ingest succeeded/failed (admin copy).",
      "Banner on the page reminds you that email ingest has its own recipient list.",
    ],
    links: [{ to: "/admin/alerts", label: "Open Alerts" }],
  },
  {
    id: "email-ingest",
    title: "Admin → Email ingest",
    category: "Admin console",
    keywords: ["inbound", "webhook", "template", "clamav", "postmark inbound"],
    paragraphs: [
      "Lets a workspace accept spreadsheet/PDF attachments via an inbound webhook (typically Postmark Inbound or similar) after MIME parsing outside the app.",
    ],
    bullets: [
      "Enable mailbox + ingest address display.",
      "Webhook URL for your gateway (authenticated with inbound webhook secret from .env).",
      "Allowed senders allowlist.",
      "Notification recipients (success/failure per email) — platform mailer.",
      "Column templates: upload Excel/CSV template, subject pattern, target dataset, load mode; inbound attachments must match template columns.",
      "Test ingest and recent messages log.",
      "PDF attachments can enter the PDF review / template gate pipeline when configured.",
    ],
    links: [{ to: "/admin/email-ingest", label: "Open Email ingest" }],
  },
  {
    id: "admin-overview",
    title: "Admin console overview",
    category: "Admin console",
    keywords: ["owner", "admin", "sidebar"],
    paragraphs: [
      "The Admin sidebar is only for owners and admins of the currently selected workspace. Switch workspace in the main sidebar before changing settings.",
    ],
    bullets: [
      "Overview — links and counts into each admin area.",
      "Workspaces — portal URLs, branding entry points, create/switch workspaces.",
      "Organization — branding, name/slug, invite links with upload limits, delete org (owner).",
      "Security — portal IP allowlist enforce + CIDR rules.",
      "Storage — quotas, upload limits, rate limits, optional custom S3, teams.",
      "AI / PDF — org AI toggles and stored LLM API keys.",
      "API keys / API docs / Connectors / Audit / Usage — as labeled in the sidebar.",
    ],
    links: [{ to: "/admin", label: "Admin overview" }],
  },
  {
    id: "workspaces-portal",
    title: "Workspaces & public portal",
    category: "Admin console",
    keywords: ["portal", "slug", "branding", "embed"],
    paragraphs: [
      "Each organization has a public portal at /portal/{slug} with branding from the organization record. IP allowlisting (Security) can block unknown networks from the portal API and page.",
    ],
    links: [
      { to: "/admin/workspaces", label: "Workspaces" },
      { to: "/admin/organization", label: "Organization branding" },
      { to: "/admin/security", label: "Portal security" },
    ],
  },
  {
    id: "portal-security",
    title: "Portal IP allowlisting",
    category: "Admin console",
    keywords: ["cidr", "allowlist", "403"],
    paragraphs: [
      "When enforcement is on, only allowlisted IPs/CIDRs can load the public portal branding API and landing page. Add your current IP before enabling. Use Test my IP on the Security page.",
    ],
    links: [{ to: "/admin/security", label: "Security" }],
  },
  {
    id: "storage-quotas",
    title: "Storage & quotas",
    category: "Admin console",
    keywords: ["quota", "s3", "minio", "upload", "rows"],
    paragraphs: [
      "Configure org storage quota, max upload size, max rows per sheet, API rate limit per minute, and optional monthly API quota. Optional custom object-storage endpoint with Test connection. Teams and per-member quota overrides are supported on this page.",
    ],
    links: [
      { to: "/admin/storage", label: "Storage settings" },
      { to: "/storage", label: "Storage usage meter" },
    ],
  },
  {
    id: "storage-meter",
    title: "Storage usage meter",
    category: "Workspace",
    keywords: ["sidebar", "used", "quota"],
    paragraphs: [
      "Every member sees used vs allocated storage in the sidebar. Click through to Storage for detail. Quotas are set by admins under Storage & quotas.",
    ],
    links: [{ to: "/storage", label: "View storage" }],
  },
  {
    id: "ai-pdf",
    title: "Admin → AI / PDF",
    category: "Admin console",
    keywords: ["llm", "openrouter", "pdf parse", "api key"],
    paragraphs: [
      "Manage org-level PDF parse flags and LLM API keys stored encrypted at rest (FIELD_ENCRYPTION_KEY). Providers supported in the UI include OpenRouter, OpenAI, Anthropic, Gemini, Ollama, and OpenAI-compatible endpoints. Keys can be tested, rotated, revoked, and set active.",
    ],
    links: [{ to: "/admin/ai", label: "AI / PDF" }],
  },
  {
    id: "connectors",
    title: "Admin → Connectors",
    category: "Admin console",
    keywords: ["sftp", "nfs", "folder", "cron", "worker"],
    paragraphs: [
      "Define SFTP, NFS, or folder connectors: host/path/username, schedule, target dataset, enable/test/delete. SFTP passwords/keys are not stored in the portal DB config; the worker reads SFTP_SECRETS from its environment. Connector host SSRF guards block private IPs unless ALLOW_INTERNAL_CONNECTOR_HOSTS=true. Local folder/NFS paths are path-jail checked when CONNECTOR_ALLOWED_ROOT is set.",
    ],
    links: [{ to: "/admin/connectors", label: "Connectors" }],
  },
  {
    id: "api-keys-docs",
    title: "API keys and API docs",
    category: "Admin console",
    keywords: ["bearer", "etag", "rotate", "revoke"],
    paragraphs: [
      "Create scoped read API keys (raw key shown once), rotate, or revoke. Admin → API docs documents endpoints, Authorization Bearer usage, and ETag / If-None-Match polling with cURL and Postman examples.",
    ],
    links: [
      { to: "/admin/api-keys", label: "API keys" },
      { to: "/admin/api-docs", label: "API docs" },
    ],
  },
  {
    id: "audit-usage",
    title: "Audit log and usage",
    category: "Admin console",
    keywords: ["compliance", "csv", "consumption"],
    paragraphs: [
      "Audit log lists control-plane events with filters and CSV export. Usage shows recent API call volume, endpoints, errors, and connector run stats for the org.",
    ],
    links: [
      { to: "/admin/audit", label: "Audit log" },
      { to: "/admin/usage", label: "Usage" },
    ],
  },
  {
    id: "datasets-basics",
    title: "Datasets, publish, and field protection",
    category: "Workspace",
    keywords: ["csv", "excel", "pdf", "mask", "hash", "encrypt", "publish"],
    paragraphs: [
      "Create a dataset, upload CSV/Excel/PDF, configure per-field clear/mask/hash/encrypt, then publish to mint a versioned read API. PDFs use structure-first AI extraction and human review before publish when PDF ingest is enabled. Archived datasets can be restored or permanently deleted per lifecycle tools.",
    ],
    links: [{ to: "/datasets", label: "Datasets" }],
  },
];

export const HELP_FAQS: { q: string; a: string; keywords?: string[] }[] = [
  {
    q: "How do we send Forgot password emails right now?",
    a: "Via the portal server’s platform mailer (Postmark HTTP if POSTMARK_API_TOKEN is set, else SMTP_* from .env). The recover API generates a token and emails a /reset-password?token_hash=… link. Admin → Authentication SMTP fields are not used for this.",
    keywords: ["password", "postmark", "forgot"],
  },
  {
    q: "Why is Admin SMTP empty / unused?",
    a: "Those fields save to organizations.smtp_config for a future org-owned mail path. Outbound app mail today only reads deployment .env (Postmark or SMTP_HOST). Password reset Help text that implied org SMTP sends OTP/alert mail overstates what is wired — alerts also use the platform mailer.",
    keywords: ["smtp", "admin", "authentication"],
  },
  {
    q: "How do alerts differ for marketing vs organizations?",
    a: "They don’t use a separate marketing alert system. Marketing is the same product with VITE_SHOW_MARKETING homepage; each demo workspace is an organization with its own alert_events, Admin → Alerts config, and Email ingest recipients.",
    keywords: ["marketing", "alerts", "org"],
  },
  {
    q: "Where do members see notifications?",
    a: "Header bell and Notifications (/notifications) for workspace-audience events. Owners/admins also use Admin → Alerts for email config and the admin-audience event log.",
    keywords: ["bell", "notifications"],
  },
  {
    q: "How do I turn a spreadsheet into an API?",
    a: "Datasets → New dataset, upload CSV/Excel/PDF, set field protection, publish. Consumers call the dataset API with a Bearer API key from Admin → API keys.",
    keywords: ["dataset", "publish"],
  },
  {
    q: "How does ETag polling work?",
    a: "Responses include ETag. Clients send If-None-Match; unchanged data returns 304. See Admin → API docs.",
    keywords: ["etag", "304"],
  },
  {
    q: "How do I invite people?",
    a: "Admin → Team & access: invite links and/or Add local user (email/password). Marketing users can also self-sign-up with username + email + password on /auth.",
    keywords: ["invite", "team"],
  },
];

export function searchHelp(query: string): {
  articles: HelpArticle[];
  faqs: typeof HELP_FAQS;
} {
  const q = query.trim().toLowerCase();
  if (!q) {
    return { articles: HELP_ARTICLES, faqs: HELP_FAQS };
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  const scoreText = (text: string) => {
    const t = text.toLowerCase();
    return tokens.reduce((s, tok) => s + (t.includes(tok) ? 1 : 0), 0);
  };
  const articles = HELP_ARTICLES.map((a) => {
    const hay = [a.title, a.category, ...a.paragraphs, ...(a.bullets ?? []), ...(a.caveats ?? []), ...(a.keywords ?? [])].join(
      " ",
    );
    return { a, score: scoreText(hay) };
  })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);

  const faqs = HELP_FAQS.map((f) => {
    const hay = [f.q, f.a, ...(f.keywords ?? [])].join(" ");
    return { f, score: scoreText(hay) };
  })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.f);

  return { articles, faqs };
}
