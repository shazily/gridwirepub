import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canManage } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Rows3, Cable, CircleAlert, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/admin/usage")({
  component: UsageAnalytics,
});

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function UsageAnalytics() {
  const { currentOrg, role } = useOrg();
  const orgId = currentOrg?.id;
  const manage = canManage(role);

  const usage = useQuery({
    queryKey: ["admin-usage", orgId],
    enabled: !!orgId && manage,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 864e5);
      const sinceIso = since.toISOString();
      const [eventsRes, runsRes] = await Promise.all([
        supabase
          .from("consumption_events")
          .select("created_at, endpoint, row_count, status_code")
          .eq("org_id", orgId!)
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: true })
          .limit(5000),
        supabase
          .from("connector_runs")
          .select("status, files_found, files_ingested, created_at")
          .eq("org_id", orgId!)
          .gte("created_at", sinceIso)
          .limit(5000),
      ]);
      if (eventsRes.error) throw eventsRes.error;
      if (runsRes.error) throw runsRes.error;
      const events = eventsRes.data ?? [];
      const runs = runsRes.data ?? [];

      const byDay = new Map<string, number>();
      for (let i = 29; i >= 0; i--) byDay.set(dayKey(new Date(Date.now() - i * 864e5)), 0);
      for (const e of events) {
        const k = dayKey(new Date(e.created_at));
        if (byDay.has(k)) byDay.set(k, (byDay.get(k) ?? 0) + 1);
      }
      const daily = Array.from(byDay.entries()).map(([d, calls]) => ({
        day: d.slice(5),
        calls,
      }));

      const byEndpoint = new Map<string, number>();
      for (const e of events) byEndpoint.set(e.endpoint, (byEndpoint.get(e.endpoint) ?? 0) + 1);
      const topEndpoints = Array.from(byEndpoint.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([endpoint, count]) => ({ endpoint, count }));

      const errorCalls = events.filter((e) => (e.status_code ?? 0) >= 400).length;
      const rowsServed = events.reduce((sum, e) => sum + (e.row_count ?? 0), 0);

      const runOk = runs.filter((r) => r.status === "success").length;
      const runFail = runs.filter((r) => r.status === "error" || r.status === "failed").length;
      const filesIngested = runs.reduce((sum, r) => sum + (r.files_ingested ?? 0), 0);

      return {
        totalCalls: events.length,
        errorCalls,
        rowsServed,
        daily,
        topEndpoints,
        runs: runs.length,
        runOk,
        runFail,
        filesIngested,
      };
    },
  });

  const d = usage.data;

  const cards = useMemo(
    () => [
      { label: "API calls (30d)", value: d?.totalCalls ?? 0, icon: Activity },
      { label: "Rows served", value: d?.rowsServed ?? 0, icon: Rows3 },
      { label: "Errors (4xx/5xx)", value: d?.errorCalls ?? 0, icon: CircleAlert },
      { label: "Connector runs", value: d?.runs ?? 0, icon: Cable },
    ],
    [d],
  );

  if (!manage) {
    return (
    <AdminShell>
      <div>
        <PageHeader title="Usage & analytics" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              You need owner or admin access to view usage analytics.
            </p>
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
        title="Usage & analytics"
        description="API consumption and connector activity over the last 30 days."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold tabular-nums">{c.value.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">{c.label}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">API calls per day</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d?.daily ?? []} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    interval={4}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--muted)" }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="calls" fill="var(--primary)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top endpoints</CardTitle>
          </CardHeader>
          <CardContent>
            {d && d.topEndpoints.length > 0 ? (
              <div className="space-y-2">
                {d.topEndpoints.map((e) => (
                  <div key={e.endpoint} className="flex items-center justify-between gap-2">
                    <code className="truncate font-mono text-xs text-muted-foreground">
                      {e.endpoint}
                    </code>
                    <span className="text-sm font-medium tabular-nums">{e.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No API calls yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Connector activity</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-6">
          <div>
            <div className="text-2xl font-bold tabular-nums">{d?.filesIngested ?? 0}</div>
            <div className="text-xs text-muted-foreground">Files ingested</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-success/20 text-success">{d?.runOk ?? 0} succeeded</Badge>
            <Badge variant="destructive">{d?.runFail ?? 0} failed</Badge>
          </div>
        </CardContent>
      </Card>
      </div>
    </AdminShell>
  );
}
