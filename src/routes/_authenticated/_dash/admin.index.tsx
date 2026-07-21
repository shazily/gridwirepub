import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canManage } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent } from "@/components/ui/card";
import { EmailIngestOpsPanel } from "@/components/email-ingest-ops-panel";
import {
  Users,
  ScrollText,
  MessageSquarePlus,
  BarChart3,
  Building2,
  KeyRound,
  Cable,
  Bell,
  ShieldAlert,
  ArrowRight,
  HardDrive,
  BookOpen,
  BrainCircuit,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/admin/")({
  component: AdminHome,
});

type AdminLink = {
  to: string;
  label: string;
  description: string;
  icon: typeof Users;
  stat?: number;
  statLabel?: string;
  search?: Record<string, unknown>;
};

function AdminHome() {
  const { currentOrg, role, orgs } = useOrg();
  const orgId = currentOrg?.id;
  const manage = canManage(role);

  const stats = useQuery({
    queryKey: ["admin-stats", orgId],
    enabled: !!orgId && manage,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();
      const [members, invites, feedback, calls, ingestToday, ingestFailToday] = await Promise.all([
        supabase.from("org_members").select("user_id", { count: "exact", head: true }).eq("org_id", orgId!),
        supabase
          .from("org_invites")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId!)
          .is("revoked_at", null),
        supabase.from("feedback").select("id", { count: "exact", head: true }).eq("org_id", orgId!),
        supabase
          .from("consumption_events")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId!)
          .gte("created_at", since),
        supabase
          .from("email_ingest_messages")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId!)
          .gte("created_at", todayIso),
        supabase
          .from("email_ingest_messages")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId!)
          .gte("created_at", todayIso)
          .or("status.like.rejected%,status.eq.quarantined,status.eq.ingest_failed"),
      ]);
      return {
        members: members.count ?? 0,
        invites: invites.count ?? 0,
        feedback: feedback.count ?? 0,
        calls: calls.count ?? 0,
        ingestToday: ingestToday.count ?? 0,
        ingestFailToday: ingestFailToday.count ?? 0,
      };
    },
  });

  if (!manage) {
    return (
    <AdminShell>
      <div>
        <PageHeader title="Admin" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              You need owner or admin access to view the admin console.
            </p>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
    );
  }

  const links: AdminLink[] = [
    { to: "/admin/team", label: "Team & access", description: "Invite people, assign roles, and remove access.", icon: Users, stat: stats.data?.members },
    { to: "/admin/workspaces", label: "Your workspaces", description: `Portal links and switching. ${orgs.length} on this account.`, icon: Building2, stat: orgs.length, statLabel: "on your account" },
    { to: "/admin/security", label: "Security", description: "Portal IP allowlist and access control.", icon: ShieldAlert },
    { to: "/admin/storage", label: "Storage & quotas", description: "Object storage, upload limits, and team space allocation.", icon: HardDrive },
    { to: "/admin/authentication", label: "Authentication", description: "SSO, MFA policy, org SMTP and SMS for OTP.", icon: KeyRound },
    { to: "/admin/ai", label: "AI / PDF", description: "LLM provider keys and PDF table parser settings.", icon: BrainCircuit },
    {
      to: "/admin/email-ingest",
      label: "Email ingest",
      description: "Allowlisted senders email Excel files for ingestion.",
      icon: MessageSquarePlus,
      stat: stats.data?.ingestToday,
      statLabel: stats.data?.ingestFailToday
        ? `${stats.data.ingestFailToday} failed today`
        : "received today",
    },
    { to: "/admin/organization", label: "Organization", description: "Portal branding, workspace name, and invite links.", icon: Building2, stat: stats.data?.invites, statLabel: "active invites" },
    { to: "/admin/usage", label: "Usage & analytics", description: "API consumption and connector activity for your org.", icon: BarChart3, stat: stats.data?.calls },
    { to: "/app-feedback", label: "Feedback", description: "Submit feedback or review messages from your team.", icon: MessageSquarePlus, stat: stats.data?.feedback },
    { to: "/admin/alerts", label: "Alerts", description: "Configure admin email alerts for operational events.", icon: Bell },
    { to: "/logs", label: "Logs", description: "Email ingest history, system ops alerts, and the audit trail.", icon: ScrollText, stat: stats.data?.ingestToday, statLabel: "emails today" },
    { to: "/admin/api-keys", label: "API keys", description: "Create, rotate, and revoke dataset API tokens.", icon: KeyRound },
    { to: "/admin/connectors", label: "Connectors", description: "Manage automated ingestion sources.", icon: Cable },
    { to: "/admin/api-docs", label: "API docs", description: "OpenAPI reference and integration examples.", icon: BookOpen },
  ];

  return (
    <AdminShell>
    <div>
      <PageHeader
        title="Admin console"
        description="Everything you need to run this workspace, in one place."
      />
      <EmailIngestOpsPanel />
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => {
          const Icon = l.icon;
          return (
            <Link key={`${l.to}-${l.label}`} to={l.to} search={l.search} className="group">
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    {typeof l.stat === "number" && (
                      <div className="text-right">
                        <span className="text-2xl font-bold tabular-nums">{l.stat}</span>
                        {l.statLabel && (
                          <div className="text-[10px] font-normal text-muted-foreground">{l.statLabel}</div>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-1 font-semibold">
                      {l.label}
                      <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{l.description}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
      </div>
    </AdminShell>
  );
}
