import { Badge } from "@/components/ui/badge";
import { Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

export type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  event_type: string;
  created_at: string;
};

const sevMeta: Record<string, { icon: typeof Info; className: string }> = {
  info: { icon: CheckCircle2, className: "text-emerald-500" },
  warning: { icon: AlertTriangle, className: "text-amber-500" },
  error: { icon: XCircle, className: "text-destructive" },
};

export function NotificationFeed({
  items,
  emptyLabel = "No notifications yet.",
  compact = false,
}: {
  items: NotificationRow[];
  emptyLabel?: string;
  compact?: boolean;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {items.map((e) => {
        const sm = sevMeta[e.severity] ?? sevMeta.info;
        const SIcon = sm.icon;
        return (
          <div
            key={e.id}
            className={compact ? "rounded-md border p-2" : "rounded-lg border p-3"}
          >
            <div className="flex items-center gap-2">
              <SIcon className={`h-4 w-4 shrink-0 ${sm.className}`} />
              <span className="text-sm font-medium">{e.title}</span>
              {!compact && (
                <Badge variant="secondary" className="ml-auto text-[10px] capitalize">
                  {e.event_type.replace(/_/g, " ")}
                </Badge>
              )}
            </div>
            {e.body && (
              <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">{e.body}</p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              {new Date(e.created_at).toLocaleString()}
            </p>
          </div>
        );
      })}
    </div>
  );
}
