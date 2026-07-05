import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { HardDrive } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useOrg } from "@/hooks/use-org";
import { getOrgStorageSummary } from "@/lib/governance.functions";

function formatGb(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

type StorageUsageBarProps = {
  compact?: boolean;
  className?: string;
};

/** Gmail-style storage meter for the sidebar — visible to all workspace members. */
export function StorageUsageBar({ compact, className }: StorageUsageBarProps) {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;

  const summary = useQuery({
    queryKey: ["storage-summary", orgId],
    enabled: !!orgId,
    queryFn: () => getOrgStorageSummary({ data: { orgId: orgId! } }),
    staleTime: 60_000,
  });

  const used = summary.data?.usedBytes ?? 0;
  const quota = summary.data?.quotaBytes ?? 0;
  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  const warn = pct >= 85;
  const critical = pct >= 95;

  if (!orgId || summary.isLoading) {
    return (
      <div className={cn("rounded-lg border border-border bg-card/50 px-3 py-2", className)}>
        <div className="h-2 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <Link
      to="/storage"
      className={cn(
        "block rounded-lg border border-border bg-card/50 px-3 py-2 transition-colors hover:bg-accent/30",
        className,
      )}
    >
      <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        <HardDrive className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate font-medium text-foreground">Storage</span>
      </div>
      <Progress
        value={quota > 0 ? pct : 0}
        className={cn(
          "h-2",
          critical && "[&>div]:bg-destructive",
          warn && !critical && "[&>div]:bg-amber-500",
        )}
      />
      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
        {formatGb(used)} of {quota > 0 ? formatGb(quota) : "unlimited"} used
        {!compact && quota > 0 && ` (${pct}%)`}
      </p>
    </Link>
  );
}
