import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, Plus, FileSpreadsheet } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/datasets/")({
  component: DatasetsList,
});

function DatasetsList() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;

  const datasets = useQuery({
    queryKey: ["datasets", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("datasets")
        .select("id, name, description, status, source_type, updated_at, dataset_versions(row_count, sheet_count, version_no)")
        .eq("org_id", orgId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div>
      <PageHeader
        title="Datasets"
        description="Each dataset is a published REST API backed by your spreadsheet."
        action={
          <Button asChild>
            <Link to="/datasets/new">
              <Plus className="h-4 w-4" /> New dataset
            </Link>
          </Button>
        }
      />

      {datasets.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : datasets.data && datasets.data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {datasets.data.map((d) => {
            const latest = (d.dataset_versions ?? []).reduce(
              (max, v) => (v.version_no > (max?.version_no ?? -1) ? v : max),
              undefined as undefined | { version_no: number; row_count: number; sheet_count: number },
            );
            return (
              <Link key={d.id} to="/datasets/$datasetId" params={{ datasetId: d.id }}>
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardContent className="p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
                        <Database className="h-4 w-4 text-primary" />
                      </div>
                      <Badge variant={d.status === "published" ? "default" : "secondary"} className="capitalize">
                        {d.status}
                      </Badge>
                    </div>
                    <div className="font-medium">{d.name}</div>
                    {d.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{d.description}</p>
                    )}
                    <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <FileSpreadsheet className="h-3 w-3" /> {latest?.sheet_count ?? 0} sheets
                      </span>
                      <span>{latest?.row_count ?? 0} rows</span>
                      {latest && <span>v{latest.version_no}</span>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15">
              <Database className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="font-medium">No datasets yet</div>
              <p className="text-sm text-muted-foreground">Upload your first spreadsheet to generate an API.</p>
            </div>
            <Button asChild>
              <Link to="/datasets/new">
                <Plus className="h-4 w-4" /> New dataset
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
