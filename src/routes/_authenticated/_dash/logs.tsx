import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, ShieldAlert, ScrollText, Activity, ChevronDown, ChevronRight } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canManage } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuditLogPanel } from "@/components/audit-log-panel";
import { INGEST_STATUS_LABELS } from "@/lib/ingest-email";

const logsSearchSchema = z.object({
  tab: z.enum(["email", "system", "audit"]).optional().catch("email"),
});

export const Route = createFileRoute("/_authenticated/_dash/logs")({
  validateSearch: (s: Record<string, unknown>) => logsSearchSchema.parse(s),
  component: LogsPage,
});

type MessageRow = {
  id: string;
  status: string;
  from_address: string;
  subject: string | null;
  rejection_reason: string | null;
  ingest_error: string | null;
  created_at: string;
  attachment_name: string | null;
  template_id: string | null;
  dataset_id: string | null;
  external_id: string | null;
  processed_at: string | null;
  scan_detail: string | null;
};

type AlertRow = {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  event_type: string;
  created_at: string;
};

function isSuccessStatus(status: string): boolean {
  return status === "ingested" || status === "accepted_pending_ingest" || status === "pending_pdf_review";
}

function isFailureStatus(status: string): boolean {
  return status.startsWith("rejected") || status === "quarantined" || status === "ingest_failed";
}

function detailText(m: MessageRow): string | null {
  return m.ingest_error?.trim() || m.rejection_reason?.trim() || null;
}

function LogsPage() {
  const { currentOrg, role } = useOrg();
  const orgId = currentOrg?.id;
  const manage = canManage(role);
  const navigate = Route.useNavigate();
  const { tab: tabParam } = Route.useSearch();
  const tab = tabParam ?? (manage ? "email" : "system");
  const safeTab =
    !manage && tab === "email" ? "system" : !manage && tab === "audit" ? "system" : tab;
  const [emailSearch, setEmailSearch] = useState("");
  const [emailFilter, setEmailFilter] = useState<"all" | "ok" | "fail">("all");
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);

  const emailMessages = useQuery({
    queryKey: ["logs-email-messages", orgId],
    enabled: !!orgId && manage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_ingest_messages")
        .select(
          "id, status, from_address, subject, rejection_reason, ingest_error, created_at, attachment_name, template_id, dataset_id, external_id, processed_at, scan_detail",
        )
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as MessageRow[];
    },
  });

  const templates = useQuery({
    queryKey: ["logs-email-templates", orgId],
    enabled: !!orgId && manage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_ingest_templates")
        .select("id, name, target_dataset_id, template_file_name")
        .eq("org_id", orgId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const datasets = useQuery({
    queryKey: ["logs-datasets-names", orgId],
    enabled: !!orgId && manage,
    queryFn: async () => {
      const { data, error } = await supabase.from("datasets").select("id, name").eq("org_id", orgId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const systemAlerts = useQuery({
    queryKey: ["logs-system-alerts", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_events")
        .select("id, title, body, severity, event_type, created_at")
        .eq("org_id", orgId!)
        .in("event_type", [
          "email_ingest_success",
          "email_ingest_failure",
          "suspicious_access",
          "api_rate_limit",
          "ingestion_error",
          "connector_failure",
        ])
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as AlertRow[];
    },
  });

  const templateName = useMemo(() => {
    const map = new Map((templates.data ?? []).map((t) => [t.id, t]));
    return (id: string | null) => (id ? map.get(id) : undefined);
  }, [templates.data]);

  const datasetName = useMemo(() => {
    const map = new Map((datasets.data ?? []).map((d) => [d.id, d.name]));
    return (id: string | null) => (id ? map.get(id) : undefined);
  }, [datasets.data]);

  const filteredEmail = useMemo(() => {
    let list = emailMessages.data ?? [];
    if (emailFilter === "ok") list = list.filter((m) => isSuccessStatus(m.status));
    if (emailFilter === "fail") list = list.filter((m) => isFailureStatus(m.status));
    const q = emailSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => {
      const detail = detailText(m) ?? "";
      const tmpl = templateName(m.template_id)?.name ?? "";
      return (
        m.from_address.toLowerCase().includes(q) ||
        (m.subject ?? "").toLowerCase().includes(q) ||
        (m.attachment_name ?? "").toLowerCase().includes(q) ||
        detail.toLowerCase().includes(q) ||
        tmpl.toLowerCase().includes(q) ||
        m.status.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
      );
    });
  }, [emailMessages.data, emailFilter, emailSearch, templateName]);

  function setTab(next: "email" | "system" | "audit") {
    void navigate({ search: { tab: next }, replace: true });
  }

  return (
    <div>
      <PageHeader
        title="Logs"
        description="Full email ingest history, operational alerts with bodies, and the audit trail."
        backTo="/dashboard"
        backLabel="Dashboard"
        crumbs={[{ label: "Logs" }]}
      />

      <Tabs value={safeTab} onValueChange={(v) => setTab(v as "email" | "system" | "audit")}>
        <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1">
          {manage ? (
            <TabsTrigger value="email" className="gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              Email ingest
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="system" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            System &amp; ops
          </TabsTrigger>
          {manage ? (
            <TabsTrigger value="audit" className="gap-1.5">
              <ScrollText className="h-3.5 w-3.5" />
              Audit
            </TabsTrigger>
          ) : null}
        </TabsList>

        {manage ? (
          <TabsContent value="email" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search from, subject, file, reason, template…"
                value={emailSearch}
                onChange={(e) => setEmailSearch(e.target.value)}
                className="max-w-sm"
              />
              <div className="flex gap-1">
                {(
                  [
                    ["all", "All"],
                    ["ok", "Succeeded"],
                    ["fail", "Failed"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setEmailFilter(id)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      emailFilter === id
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-accent/40"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="ml-auto text-xs text-muted-foreground">
                {filteredEmail.length} message{filteredEmail.length === 1 ? "" : "s"}
              </span>
              <Button variant="outline" size="sm" asChild>
                <Link to="/admin/email-ingest">Ingest settings</Link>
              </Button>
            </div>

            {emailMessages.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : filteredEmail.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  No email ingest messages match this filter.
                </CardContent>
              </Card>
            ) : (
              <ul className="space-y-2">
                {filteredEmail.map((m) => {
                  const open = expandedEmail === m.id;
                  const detail = detailText(m);
                  const tmpl = templateName(m.template_id);
                  const ds = datasetName(m.dataset_id);
                  return (
                    <li key={m.id}>
                      <Card>
                        <CardContent className="p-0">
                          <button
                            type="button"
                            className="flex w-full items-start gap-3 p-4 text-left"
                            onClick={() => setExpandedEmail(open ? null : m.id)}
                          >
                            {open ? (
                              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">
                                  {m.subject?.trim() || "(no subject)"}
                                </span>
                                <Badge
                                  variant={
                                    isSuccessStatus(m.status)
                                      ? "default"
                                      : isFailureStatus(m.status)
                                        ? "destructive"
                                        : "secondary"
                                  }
                                >
                                  {INGEST_STATUS_LABELS[m.status] ?? m.status}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {m.from_address}
                                {m.attachment_name ? ` · ${m.attachment_name}` : ""}
                                {" · "}
                                {new Date(m.created_at).toLocaleString()}
                                {tmpl ? ` · template “${tmpl.name}”` : ""}
                              </div>
                              {!open && detail ? (
                                <p className="line-clamp-2 text-xs text-destructive">{detail}</p>
                              ) : null}
                            </div>
                          </button>
                          {open ? (
                            <div className="space-y-3 border-t border-border bg-muted/20 px-4 py-3 text-sm">
                              <dl className="grid gap-2 sm:grid-cols-2">
                                <div>
                                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Status
                                  </dt>
                                  <dd>{INGEST_STATUS_LABELS[m.status] ?? m.status}</dd>
                                </div>
                                <div>
                                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Message id
                                  </dt>
                                  <dd className="break-all font-mono text-xs">{m.id}</dd>
                                </div>
                                <div>
                                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    From
                                  </dt>
                                  <dd>{m.from_address}</dd>
                                </div>
                                <div>
                                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Attachment
                                  </dt>
                                  <dd>{m.attachment_name ?? "—"}</dd>
                                </div>
                                <div>
                                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Template
                                  </dt>
                                  <dd>
                                    {tmpl
                                      ? `${tmpl.name}${tmpl.template_file_name ? ` (${tmpl.template_file_name})` : ""}`
                                      : m.template_id ?? "—"}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Dataset
                                  </dt>
                                  <dd>
                                    {ds ? (
                                      <Link
                                        to="/datasets/$datasetId"
                                        params={{ datasetId: m.dataset_id! }}
                                        className="text-primary hover:underline"
                                      >
                                        {ds}
                                      </Link>
                                    ) : (
                                      "—"
                                    )}
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    External id
                                  </dt>
                                  <dd className="break-all font-mono text-xs">{m.external_id ?? "—"}</dd>
                                </div>
                                <div>
                                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Processed
                                  </dt>
                                  <dd>
                                    {m.processed_at
                                      ? new Date(m.processed_at).toLocaleString()
                                      : "—"}
                                  </dd>
                                </div>
                              </dl>
                              {m.scan_detail ? (
                                <div>
                                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Scan
                                  </div>
                                  <p className="mt-1 text-xs text-muted-foreground">{m.scan_detail}</p>
                                </div>
                              ) : null}
                              {detail ? (
                                <div>
                                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Full reason
                                  </div>
                                  <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-xs text-destructive">
                                    {detail}
                                  </pre>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>
        ) : null}

        <TabsContent value="system" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Operational alerts with full bodies. Configure recipients in{" "}
            {manage ? (
              <Link to="/admin/alerts" className="text-primary hover:underline">
                Admin → Alerts
              </Link>
            ) : (
              "Admin → Alerts"
            )}
            .
          </p>
          {(systemAlerts.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No system or ops alerts yet.
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2">
              {(systemAlerts.data ?? []).map((a) => {
                const open = expandedAlert === a.id;
                return (
                  <li key={a.id}>
                    <Card>
                      <CardContent className="p-0">
                        <button
                          type="button"
                          className="flex w-full items-start gap-3 p-4 text-left"
                          onClick={() => setExpandedAlert(open ? null : a.id)}
                        >
                          {open ? (
                            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{a.title}</span>
                              <Badge
                                variant={a.severity === "error" ? "destructive" : "secondary"}
                                className="text-[10px]"
                              >
                                {a.event_type.replace(/_/g, " ")}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              {new Date(a.created_at).toLocaleString()}
                            </p>
                            {!open && a.body ? (
                              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.body}</p>
                            ) : null}
                          </div>
                        </button>
                        {open && a.body ? (
                          <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-border bg-muted/20 px-4 py-3 text-xs">
                            {a.body}
                          </pre>
                        ) : null}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        {manage ? (
          <TabsContent value="audit">
            <AuditLogPanel />
          </TabsContent>
        ) : (
          <TabsContent value="audit">
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                <ShieldAlert className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Audit log is available to workspace owners and admins.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
