import { type ReactNode, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  PauseCircle,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Info,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canManage } from "@/hooks/use-org";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function isSuccessStatus(status: string): boolean {
  return status === "ingested" || status === "accepted_pending_ingest" || status === "pending_pdf_review";
}

function isFailureStatus(status: string): boolean {
  return status.startsWith("rejected") || status === "quarantined" || status === "ingest_failed";
}

type AlertRow = {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  event_type: string;
  created_at: string;
};

type StatCardProps = {
  to: string;
  search?: Record<string, unknown>;
  label: string;
  value: string | number;
  icon?: ReactNode;
  hint?: string;
};

function StatLinkCard({ to, search, label, value, icon, hint }: StatCardProps) {
  return (
    <Link
      to={to}
      search={search}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-accent/30">
        <CardContent className="flex items-center gap-3 p-4">
          {icon}
          <div className="min-w-0">
            <div className="text-2xl font-bold tabular-nums leading-none">{value}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
            {hint ? <div className="mt-0.5 text-[10px] text-primary/80 opacity-0 group-hover:opacity-100">{hint}</div> : null}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * Dashboard / admin summary: live counts (clickable) + compact ops alerts.
 * Full activity lists live under Logs.
 */
export function EmailIngestOpsPanel() {
  const { currentOrg, role } = useOrg();
  const orgId = currentOrg?.id;
  const manage = canManage(role);
  const todayIso = startOfTodayIso();
  const [selectedAlert, setSelectedAlert] = useState<AlertRow | null>(null);

  const mailbox = useQuery({
    queryKey: ["dash-email-mailbox", orgId],
    enabled: !!orgId && manage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_ingest_mailboxes")
        .select("inbound_address, enabled")
        .eq("org_id", orgId!)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return data;
    },
    refetchInterval: 30_000,
  });

  const todayMessages = useQuery({
    queryKey: ["dash-email-messages-today", orgId, todayIso],
    enabled: !!orgId && manage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_ingest_messages")
        .select("id, status")
        .eq("org_id", orgId!)
        .gte("created_at", todayIso)
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 20_000,
  });

  const datasetsToday = useQuery({
    queryKey: ["dash-datasets-touched-today", orgId, todayIso],
    enabled: !!orgId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("datasets")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId!)
        .gte("updated_at", todayIso);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });

  const opsAlerts = useQuery({
    queryKey: ["dash-ops-alerts-summary", orgId],
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
        .limit(5);
      if (error) throw error;
      return (data ?? []) as AlertRow[];
    },
    refetchInterval: 20_000,
  });

  const rows = todayMessages.data ?? [];
  const todayTotal = rows.length;
  const todayOk = rows.filter((r) => isSuccessStatus(r.status)).length;
  const todayFail = rows.filter((r) => isFailureStatus(r.status)).length;
  const ingestActive = mailbox.data?.enabled === true;

  const sevIcon = (severity: string) => {
    if (severity === "error") return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
    if (severity === "warning") return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />;
    return <Info className="h-4 w-4 shrink-0 text-emerald-500" />;
  };

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Email ingest &amp; ops</h2>
          <p className="text-sm text-muted-foreground">
            Live counts — click any card for details. Full history is under Logs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/logs" search={{ tab: manage ? "email" : "system" }}>
              Open logs
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
          {manage ? (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/admin/email-ingest">Ingest settings</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {manage ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatLinkCard
            to="/admin/email-ingest"
            label="Email ingest"
            value={ingestActive ? "Active" : "Paused"}
            hint="Configure mailbox"
            icon={
              ingestActive ? (
                <PlayCircle className="h-8 w-8 text-emerald-600" aria-hidden />
              ) : (
                <PauseCircle className="h-8 w-8 text-muted-foreground" aria-hidden />
              )
            }
          />
          <StatLinkCard
            to="/logs"
            search={{ tab: "email" }}
            label="Emails today"
            value={todayTotal}
            hint="View ingest log"
          />
          <StatLinkCard
            to="/logs"
            search={{ tab: "email" }}
            label="Succeeded today"
            value={todayOk}
            hint="View email log"
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />}
          />
          <StatLinkCard
            to="/logs"
            search={{ tab: "email" }}
            label="Failed today"
            value={todayFail}
            hint="View email log"
            icon={<AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />}
          />
          <StatLinkCard
            to="/datasets"
            label="Datasets updated today"
            value={datasetsToday.data ?? 0}
            hint="Open datasets"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatLinkCard
            to="/datasets"
            label="Datasets updated today"
            value={datasetsToday.data ?? 0}
            hint="Open datasets"
          />
          <StatLinkCard
            to="/logs"
            search={{ tab: "system" }}
            label="Ops alerts"
            value={(opsAlerts.data ?? []).length}
            hint="Open system logs"
          />
        </div>
      )}

      {manage && mailbox.data?.inbound_address ? (
        <p className="text-xs text-muted-foreground">
          Primary inbox: <code className="text-foreground">{mailbox.data.inbound_address}</code>
          {!ingestActive ? " · ingest is paused — inbound mail will be rejected." : null}
        </p>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ops alerts</CardTitle>
          <CardDescription>
            Summary only — click an alert for a short detail view, or open Logs for the full trail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(opsAlerts.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No operational alerts yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(opsAlerts.data ?? []).map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 py-2.5 text-left transition-colors hover:bg-muted/40"
                    onClick={() => setSelectedAlert(a)}
                  >
                    {sevIcon(a.severity)}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{a.title}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(a.created_at).toLocaleString()}
                        {" · "}
                        {a.event_type.replace(/_/g, " ")}
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      Details
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <Button variant="outline" size="sm" asChild>
              <Link to="/logs" search={{ tab: "system" }}>
                Full system &amp; ops log
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={selectedAlert !== null} onOpenChange={(open) => !open && setSelectedAlert(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedAlert?.title ?? "Alert"}</DialogTitle>
            <DialogDescription>
              {selectedAlert
                ? `${selectedAlert.event_type.replace(/_/g, " ")} · ${new Date(selectedAlert.created_at).toLocaleString()}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {selectedAlert?.body ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs">
              {selectedAlert.body}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">No additional detail on this alert.</p>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => setSelectedAlert(null)}>
              Close
            </Button>
            <Button type="button" asChild>
              <Link
                to="/logs"
                search={{
                  tab:
                    selectedAlert?.event_type.startsWith("email_ingest") && manage
                      ? "email"
                      : selectedAlert?.event_type.includes("api") ||
                          selectedAlert?.event_type === "suspicious_access"
                        ? "system"
                        : manage
                          ? "audit"
                          : "system",
                }}
                onClick={() => setSelectedAlert(null)}
              >
                Open in Logs
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
