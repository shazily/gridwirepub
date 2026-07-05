import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { useOrg } from "@/hooks/use-org";
import { clearWelcomeCompleted } from "@/lib/welcome-tour";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  MessageSquarePlus,
  ShieldCheck,
  Sparkles,
  Settings2,
  Mail,
  Globe,
  HardDrive,
  Users,
  KeyRound,
  Bell,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/help")({
  component: HelpPage,
});

const faqs = [
  {
    q: "How do I turn a spreadsheet into an API?",
    a: "Go to Datasets → New dataset, upload a CSV or spreadsheet, review the detected columns and per-field protection (clear, mask, hash, or encrypt), then publish. Gridwire mints a secure, versioned read endpoint for that dataset.",
  },
  {
    q: "How do consumers authenticate to a dataset API?",
    a: "Each request must send a valid API token in the Authorization header (Bearer token). Datasets are private by default and are only reachable with a non-revoked token scoped to your organization. Create and rotate tokens under Admin → API keys.",
  },
  {
    q: "How does ETag / polling work?",
    a: "Every dataset response includes an ETag. Send it back on the next request via the If-None-Match header. If nothing changed you'll get a 304 Not Modified (cheap poll); if the data changed you get 200 with the new payload and a new ETag. See Admin → API docs for cURL and Postman examples.",
  },
  {
    q: "How do I invite team members to drop in data?",
    a: "Open Admin → Team & access. Owners and admins can generate secure invite links, change roles, and revoke workspace access. Recipients can sign up from the link and join as contributor, member, or viewer.",
  },
  {
    q: "Which hashing algorithms can I choose?",
    a: "Per hashed field you can select SHA-256, SHA-512, SHA3-256, SHA3-512, or keyed HMAC-SHA256/512. HMAC variants are peppered with a server-side key so they cannot be reversed with rainbow tables.",
  },
  {
    q: "Is my data encrypted?",
    a: "Yes. All traffic is served over TLS (in transit) and the database and backups are encrypted at rest. Fields marked “encrypt” are additionally sealed with AES-256-GCM before storage.",
  },
  {
    q: "Where can I see who accessed my data?",
    a: "Owners and admins can open Admin → Audit log to review every data-access event and access-control change, filter it, and export it to CSV.",
  },
  {
    q: "Where can I see storage usage?",
    a: "Every member sees a storage bar in the sidebar (like Gmail/Google Drive). Click it or open Storage for used vs quota details. Admins set limits under Admin → Storage & quotas.",
  },
  {
    q: "How does email ingest template validation work?",
    a: "Upload an Excel or CSV template under Admin → Email ingest. Its columns become the expected schema. Inbound attachments must match those columns exactly or they are rejected and logged in the audit trail. Use Test ingest to verify without an external mail gateway.",
  },
  {
    q: "Can viewers see alerts?",
    a: "Yes. Alerts moved to the main menu for all roles. Everyone sees the in-app feed; only owners and admins configure email recipients.",
  },
  {
    q: "How do I rotate or revoke an API key?",
    a: "On Admin → API keys use Rotate to atomically mint a replacement and revoke the old key, or Revoke to disable a key immediately. Both actions are recorded in the audit log.",
  },
];

const adminSections = [
  {
    id: "admin-overview",
    icon: Settings2,
    title: "Admin console overview",
    body: [
      "The Admin menu in the sidebar is visible only to workspace owners and admins.",
      "Use it to manage people, security, storage, authentication, and integrations for the currently selected workspace.",
      "Your account can belong to multiple workspaces — switch workspace from the sidebar before changing settings.",
    ],
    links: [{ to: "/admin", label: "Open admin overview" }],
  },
  {
    id: "workspaces-portal",
    icon: Globe,
    title: "Workspaces & public portal links",
    body: [
      "Each workspace has a public portal URL: /portal/{slug}. Share this link so visitors see your branded landing page.",
      "The portal slug can differ from the internal workspace name. Regenerate the slug if a link was leaked — old aliases can be kept for redirects.",
      "Copy the portal URL or embed snippet from Admin → Your workspaces.",
    ],
    links: [{ to: "/admin/workspaces", label: "Manage workspaces" }],
  },
  {
    id: "portal-security",
    icon: ShieldCheck,
    title: "Portal IP allowlisting",
    body: [
      "Restrict who can load your public portal by IP or CIDR (e.g. 203.0.113.0/24 or a single office IP).",
      "When enforcement is ON, requests from unknown IPs receive 403 on the portal API and landing page.",
      "Always add your current IP before enabling enforcement. Private ranges (10.x, 192.168.x) and loopback are seeded by default for local testing.",
      "Use “Test my IP” on the Security page to confirm you are allowlisted.",
    ],
    links: [{ to: "/admin/security", label: "Portal security settings" }],
  },
  {
    id: "authentication-email",
    icon: KeyRound,
    title: "Authentication & email (Postmark / SMTP)",
    body: [
      "Platform password reset uses the Postmark HTTP API (noreply@your-domain) — not GoTrue SMTP — because SMTP from Docker often times out to Postmark.",
      "Set POSTMARK_API_TOKEN and EMAIL_FROM_* variables in your deployment .env. Verified sender domains are required in Postmark.",
      "Org-level SMTP under Admin → Authentication is for OTP alerts and custom mail from your own server — separate from platform auth email.",
      "To test password reset: use Forgot password on the sign-in page; check Postmark Activity for delivery. Invite emails use the notifications sender.",
      "SSO: configure OIDC issuer + client ID or SAML metadata URL, then test with a non-owner account before enforcing MFA.",
    ],
    links: [{ to: "/admin/authentication", label: "Authentication settings" }],
  },
  {
    id: "storage-quotas",
    icon: HardDrive,
    title: "Storage & quotas",
    body: [
      "Set org-wide storage cap, max upload size, and max rows per sheet. These apply to all new dataset uploads.",
      "Optional custom S3/Minio endpoint lets you store blobs in your own bucket — use Test connection before saving.",
      "Allocate per-team or per-member quotas so one team cannot consume the entire org allowance.",
    ],
    links: [{ to: "/admin/storage", label: "Storage settings" }],
  },
  {
    id: "email-ingest",
    icon: Mail,
    title: "Email ingest (Excel by email)",
    body: [
      "Each workspace has a dedicated ingest email (e.g. reports@ingest.yourdomain.com). Configure it under Admin → Email ingest and route it through your inbound mail gateway or forward from corporate mail.",
      "Gridwire does not host a mailbox UI — mail arrives via webhook POST to /api/public/inbound/webhook after your gateway parses MIME. This keeps viruses and raw mail outside the app until attachments are extracted.",
      "Upload an Excel or CSV template. Column headers become the expected schema. Attachments must match exactly (no extra or missing columns) or they are rejected with a reason.",
      "Processing order: log received → allowlist sender → match template → require Excel/CSV attachment → ClamAV malware scan → parse file → validate columns → import to dataset.",
      "Every outcome is stored in email_ingest_messages and the audit log: rejected_no_mailbox, rejected_sender, rejected_template, rejected_no_attachment, rejected_parse_error, rejected_schema_mismatch, quarantined, ingested, ingest_failed.",
      "Configure your inbound gateway webhook or forward from corporate mail to your workspace ingest address. Setup steps appear in Admin → Email ingest.",
      "Templates can target an existing dataset or create a new one on first successful import.",
    ],
    links: [{ to: "/admin/email-ingest", label: "Email ingest settings" }],
  },
  {
    id: "storage-meter",
    icon: HardDrive,
    title: "Storage usage meter",
    body: [
      "Every workspace member sees a Gmail-style storage bar in the sidebar showing used vs allocated space.",
      "Click the bar or open Storage in the menu for a detailed breakdown.",
      "Owners and admins configure quotas and backend storage under Admin → Storage & quotas.",
    ],
    links: [{ to: "/storage", label: "View storage usage" }],
  },
  {
    id: "alerts-feedback",
    icon: Bell,
    title: "Alerts & feedback (all members)",
    body: [
      "Alerts in the main menu shows the workspace notification feed for everyone. Owners and admins configure which events send email.",
      "Feedback lets any member submit bugs, ideas, or support questions. Admins review submissions on the Team feedback tab.",
    ],
    links: [
      { to: "/notifications", label: "Notifications" },
      { to: "/app-feedback", label: "Feedback" },
    ],
  },
  {
    id: "team-access",
    icon: Users,
    title: "Team, API keys & audit",
    body: [
      "Team & access: invite links expire; revoke access immediately by removing the member.",
      "API keys: scope to read; rotate on schedule; never commit keys to source control.",
      "Audit log: export CSV for compliance; filter by actor or event type.",
      "Connectors & alerts: configure automated pulls and who gets notified on failure.",
    ],
    links: [
      { to: "/admin/team", label: "Team & access" },
      { to: "/admin/api-keys", label: "API keys" },
      { to: "/admin/audit", label: "Audit log" },
    ],
  },
];

function HelpPage() {
  const navigate = useNavigate();
  const { currentOrg } = useOrg();

  const replayWelcomeTour = () => {
    if (currentOrg?.id) clearWelcomeCompleted(currentOrg.id);
    void navigate({ to: "/dashboard" });
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Help & manual"
        description="FAQ, admin guides, and links to documentation."
        backTo="/dashboard"
        backLabel="Dashboard"
        crumbs={[{ label: "Help" }]}
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Platform tour</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-3">
              Guided overlay for workspace owners: account vs workspaces, admin console, and authentication layers.
            </CardDescription>
            <Button size="sm" variant="outline" type="button" onClick={replayWelcomeTour}>
              Replay welcome tour
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">API documentation</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-3">
              Endpoints, auth, ETag polling, cURL and Postman collection.
            </CardDescription>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/api-docs">Open API Docs</Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="sm:col-span-2">
          <CardHeader className="flex flex-row items-center gap-2">
            <MessageSquarePlus className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Need something else?</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-3">
              Send us feedback, a bug report, or a feature request.
            </CardDescription>
            <Button asChild size="sm" variant="outline">
              <Link to="/app-feedback">Send feedback</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-8" id="admin-manual">
        <CardHeader>
          <CardTitle className="text-base">Admin manual</CardTitle>
          <CardDescription>
            Step-by-step guidance for complex settings. Look for the ? icon on admin pages for the same tips inline.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {adminSections.map((section) => {
            const Icon = section.icon;
            return (
              <section key={section.id} id={section.id} className="scroll-mt-24">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Icon className="h-4 w-4 text-primary" />
                  {section.title}
                </h3>
                <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {section.body.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  {section.links.map((l) => (
                    <Button key={l.to} asChild size="sm" variant="outline">
                      <Link to={l.to}>{l.label}</Link>
                    </Button>
                  ))}
                </div>
              </section>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Frequently asked questions</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((f, i) => (
              <AccordionItem key={i} value={`item-${i}`}>
                <AccordionTrigger className="text-left text-sm">{f.q}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
