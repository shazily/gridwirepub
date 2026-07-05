import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, KeyRound, Rows3, Activity, Plus, ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;

  const stats = useQuery({
    queryKey: ["dashboard-stats", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [datasets, published, keys, events] = await Promise.all([
        supabase.from("datasets").select("id", { count: "exact", head: true }).eq("org_id", orgId!),
        supabase.from("datasets").select("id", { count: "exact", head: true }).eq("org_id", orgId!).eq("status", "published"),
        supabase.from("api_keys").select("id", { count: "exact", head: true }).eq("org_id", orgId!).is("revoked_at", null),
        supabase.from("consumption_events").select("id", { count: "exact", head: true }).eq("org_id", orgId!),
      ]);
      return {
        datasets: datasets.count ?? 0,
        published: published.count ?? 0,
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
        .select("id, name, status, source_type, updated_at")
        .eq("org_id", orgId!)
        .order("updated_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  const cards = [
    { label: "Datasets", value: stats.data?.datasets ?? 0, icon: Database },
    { label: "Published APIs", value: stats.data?.published ?? 0, icon: ArrowUpRight },
    { label: "Active API keys", value: stats.data?.keys ?? 0, icon: KeyRound },
    { label: "API calls logged", value: stats.data?.events ?? 0, icon: Activity },
  ];

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
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label}>
              <CardContent className="flex items-center gap-4 p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{c.value}</div>
                  <div className="text-xs text-muted-foreground">{c.label}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

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
                  <span className="text-xs capitalize text-muted-foreground">{d.status}</span>
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
