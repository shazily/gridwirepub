import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canManage } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmailIngestOpsPanel } from "@/components/email-ingest-ops-panel";
import { Database, KeyRound, Rows3, Activity, Plus, Globe, Lock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { currentOrg, role } = useOrg();
  const orgId = currentOrg?.id;
  const manage = canManage(role);

  const stats = useQuery({
    queryKey: ["dashboard-stats", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [datasets, publishedRows, keys, events] = await Promise.all([
        supabase.from("datasets").select("id", { count: "exact", head: true }).eq("org_id", orgId!),
        supabase
          .from("datasets")
          .select("id, api_access")
          .eq("org_id", orgId!)
          .eq("status", "published"),
        supabase
          .from("api_keys")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId!)
          .is("revoked_at", null),
        supabase.from("consumption_events").select("id", { count: "exact", head: true }).eq("org_id", orgId!),
      ]);
      const published = publishedRows.data ?? [];
      return {
        datasets: datasets.count ?? 0,
        published: published.length,
        publicApis: published.filter((d) => d.api_access === "public").length,
        secureApis: published.filter((d) => d.api_access !== "public").length,
        keys: keys.count ?? 0,
        events: events.count ?? 0,
      };
    },
  });

  const recent = useQuery({
    queryKey: ["recent-datasets", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("datasets")
        .select("id, name, status, source_type, updated_at, api_access")
        .eq("org_id", orgId!)
        .order("updated_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div>
      <PageHeader
        title={`Welcome${currentOrg ? ` to ${currentOrg.name}` : ""}`}
        description="Your spreadsheet-to-API workspace at a glance."
        action={
          <Button asChild>
            <Link to="/datasets/new">
              <Plus className="h-4 w-4" /> New dataset
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Link
          to="/datasets"
          className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-accent/30">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stats.data?.datasets ?? 0}</div>
                <div className="text-xs text-muted-foreground">Datasets</div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link
          to="/datasets"
          search={{ status: "published" }}
          className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-accent/30">
            <CardContent className="p-5">
              <div className="text-2xl font-bold">{stats.data?.published ?? 0}</div>
              <div className="text-xs text-muted-foreground">Published APIs</div>
              <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Globe className="h-3 w-3 text-emerald-600" />
                  {stats.data?.publicApis ?? 0} public
                </span>
                <span className="inline-flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  {stats.data?.secureApis ?? 0} secure
                </span>
              </div>
            </CardContent>
          </Card>
        </Link>

        {manage ? (
          <Link
            to="/admin/api-keys"
            className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-accent/30">
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
                  <KeyRound className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{stats.data?.keys ?? 0}</div>
                  <div className="text-xs text-muted-foreground">API keys</div>
                  <div className="text-[10px] text-muted-foreground">For secure APIs</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ) : (
          <Card>
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
                <KeyRound className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stats.data?.keys ?? 0}</div>
                <div className="text-xs text-muted-foreground">API keys</div>
              </div>
            </CardContent>
          </Card>
        )}

        <Link
          to={manage ? "/admin/usage" : "/datasets"}
          className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-accent/30">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stats.data?.events ?? 0}</div>
                <div className="text-xs text-muted-foreground">API calls logged</div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      <EmailIngestOpsPanel />

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent datasets</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/datasets">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {recent.data && recent.data.length > 0 ? (
            <div className="divide-y divide-border">
              {recent.data.map((d) => (
                <Link
                  key={d.id}
                  to="/datasets/$datasetId"
                  params={{ datasetId: d.id }}
                  className="flex items-center justify-between py-3 transition-colors hover:text-primary"
                >
                  <div className="flex items-center gap-3">
                    <Rows3 className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{d.name}</span>
                  </div>
                  <span className="text-xs capitalize text-muted-foreground">
                    {d.status}
                    {d.status === "published"
                      ? ` · ${d.api_access === "public" ? "public" : "secure"}`
                      : ""}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">No datasets yet.</p>
              <Button className="mt-4" asChild>
                <Link to="/datasets/new">
                  <Plus className="h-4 w-4" /> Create your first dataset
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
