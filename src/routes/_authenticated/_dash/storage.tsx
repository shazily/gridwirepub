import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { StorageUsageBar } from "@/components/storage-usage-bar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getOrgStorageSummary } from "@/lib/governance.functions";
import { HardDrive } from "lucide-react";
import { canManage } from "@/hooks/use-org";

export const Route = createFileRoute("/_authenticated/_dash/storage")({
  component: StoragePage,
});

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function StoragePage() {
  const { currentOrg, role } = useOrg();
  const orgId = currentOrg?.id;
  const manage = canManage(role);

  const summary = useQuery({
    queryKey: ["storage-summary", orgId],
    enabled: !!orgId,
    queryFn: () => getOrgStorageSummary({ data: { orgId: orgId! } }),
  });

  const used = summary.data?.usedBytes ?? 0;
  const quota = summary.data?.quotaBytes ?? 0;
  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Storage"
        description="How much of your workspace allocation is in use."
        backTo="/dashboard"
        backLabel="Dashboard"
        crumbs={[{ label: "Storage" }]}
      />

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center gap-2">
          <HardDrive className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-base">Workspace storage</CardTitle>
            <CardDescription>
              {currentOrg?.name ?? "This workspace"} — uploads, dataset versions, and exports count toward this total.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={quota > 0 ? pct : 0} className="h-3" />
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span>
              <span className="font-semibold tabular-nums">{formatBytes(used)}</span>
              <span className="text-muted-foreground"> used</span>
            </span>
            <span className="text-muted-foreground tabular-nums">
              {quota > 0 ? `${formatBytes(quota)} total (${pct}%)` : "No quota set"}
            </span>
          </div>
          {summary.data?.maxUploadBytes ? (
            <p className="text-xs text-muted-foreground">
              Max single upload: {formatBytes(summary.data.maxUploadBytes)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <StorageUsageBar className="mb-6" />

      {manage && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm text-muted-foreground">
              Owners and admins can change quotas, team caps, and storage backend under Admin.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/storage">Storage settings</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
