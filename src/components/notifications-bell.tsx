import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/use-org";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NotificationFeed } from "@/components/notification-feed";
import { cn } from "@/lib/utils";

async function markNotificationsRead(orgId: string, userId: string) {
  const now = new Date().toISOString();
  await supabase.from("user_notification_reads").upsert(
    { org_id: orgId, user_id: userId, last_read_at: now },
    { onConflict: "user_id,org_id" },
  );
}

export function NotificationsBell({ className }: { className?: string }) {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session;
    },
  });
  const userId = session.data?.user?.id;

  const readState = useQuery({
    queryKey: ["notification-read", orgId, userId],
    enabled: !!orgId && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_notification_reads")
        .select("last_read_at")
        .eq("org_id", orgId!)
        .eq("user_id", userId!)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return data?.last_read_at ?? null;
    },
  });

  const events = useQuery({
    queryKey: ["workspace-notifications", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_events")
        .select("id, title, body, severity, event_type, created_at")
        .eq("org_id", orgId!)
        .eq("audience", "workspace")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const lastRead = readState.data;
  const unreadCount =
    events.data?.filter((e) => !lastRead || e.created_at > lastRead).length ?? 0;

  async function handleOpenChange(open: boolean) {
    if (!open || !orgId || !userId) return;
    await markNotificationsRead(orgId, userId);
    queryClient.invalidateQueries({ queryKey: ["notification-read", orgId, userId] });
  }

  return (
    <Popover onOpenChange={(open) => void handleOpenChange(open)}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative", className)}
          aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          <Link to="/notifications" className="text-xs text-primary hover:underline">
            View all
          </Link>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          <NotificationFeed
            items={events.data?.slice(0, 5) ?? []}
            compact
            emptyLabel="You're all caught up."
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
