import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useOrg, canManage } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { getPlatformHealthFn } from "@/lib/api-endpoint-probe.functions";
import type { PlatformHealthReport } from "@/lib/api-endpoint-probe.server";
import { toUserFacingMessage } from "@/lib/user-facing-error";
import {
  Activity,
  CircleCheck,
  CircleAlert,
  CircleX,
  HeartPulse,
  Loader2,
  ShieldAlert,
  BookOpen,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/admin/health")({
  component: AdminPlatformHealth,
});

function statusBadge(overall: PlatformHealthReport["overall"]) {
  switch (overall) {
    case "healthy":
      return <Badge className="bg-success/20 text-success">Healthy</Badge>;
    case "degraded":
      return <Badge className="bg-warning/20 text-warning">Degraded</Badge>;
    case "down":
      return <Badge className="bg-destructive/20 text-destructive">Down / failing</Badge>;
    default: {
      const _exhaustive: never = overall;
      return _exhaustive;
    }
  }
}

function checkIcon(status: PlatformHealthReport["checks"][number]["status"]) {
  switch (status) {
    case "ok":
      return <CircleCheck className="h-4 w-4 text-success" />;
    case "warn":
      return <CircleAlert className="h-4 w-4 text-warning" />;
    case "fail":
      return <CircleX className="h-4 w-4 text-destructive" />;
    case "skipped":
      return <Activity className="h-4 w-4 text-muted-foreground" />;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function AdminPlatformHealth() {
  const { currentOrg, role } = useOrg();
  const manage = canManage(role);
  const orgId = currentOrg?.id;
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<PlatformHealthReport | null>(null);

  const runCheck = async () => {
    if (!orgId) {
      toast.error("Select a workspace first");
      return;
    }
    setRunning(true);
    try {
      const next = await getPlatformHealthFn({ data: { orgId } });
      setReport(next);
      if (next.overall === "healthy") toast.success("Platform health checks passed");
      else if (next.overall === "degraded") toast.message("Platform is degraded — review warnings");
      else toast.error("One or more platform checks failed");
    } catch (err) {
      toast.error(toUserFacingMessage(err, "Platform health check failed"));
    } finally {
      setRunning(false);
    }
  };

  if (!manage) {
    return (
      <AdminShell>
        <div>
          <PageHeader title="Platform health" />
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <ShieldAlert className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Owner or admin access required.</p>
            </CardContent>
          </Card>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div>
        <PageHeader
          title="Platform health"
          description="Run a live check of portal liveness, readiness, database, storage, and security bootstrap."
          action={
            <Button onClick={() => void runCheck()} disabled={running || !orgId}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <HeartPulse className="h-4 w-4" />}
              Run health check
            </Button>
          }
        />

        <div className="mt-4 grid gap-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-base">Overall status</CardTitle>
                <CardDescription>
                  Uses the same probes as{" "}
                  <code className="font-mono text-xs">/api/public/health</code> and{" "}
                  <code className="font-mono text-xs">/api/public/ready</code>, plus storage and ClamAV.
                </CardDescription>
              </div>
              {report ? statusBadge(report.overall) : <Badge variant="outline">Not run yet</Badge>}
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {report ? (
                <p>
                  Checked at {new Date(report.checked_at).toLocaleString()}. Open a dataset → API tab to
                  test individual published endpoints.
                </p>
              ) : (
                <p>Click “Run health check” to verify this deployment is serving traffic safely.</p>
              )}
            </CardContent>
          </Card>

          {report && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Checks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {report.checks.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3"
                  >
                    <div className="mt-0.5">{checkIcon(c.status)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{c.label}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {c.status}
                        </Badge>
                        {c.latency_ms != null && (
                          <span className="text-[11px] text-muted-foreground">{c.latency_ms} ms</span>
                        )}
                      </div>
                      {c.detail && (
                        <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">
                          {c.detail}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Related tools</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/admin/api-docs">
                  <BookOpen className="h-4 w-4" /> API docs
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href="/api/public/ready" target="_blank" rel="noreferrer">
                  Open /api/public/ready
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href="/api/public/health" target="_blank" rel="noreferrer">
                  Open /api/public/health
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminShell>
  );
}
