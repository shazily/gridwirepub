import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import { NotificationFeed } from "@/components/notification-feed";

export const Route = createFileRoute("/_authenticated/_dash/notifications")({
  component: NotificationsPage,
});

async function markNotificationsRead(orgId: string, userId: string) {
  const now = new Date().toISOString();
  await supabase.from("user_notification_reads").upsert(
    { org_id: orgId, user_id: userId, last_read_at: now },
    { onConflict: "user_id,org_id" },
  );
}

function NotificationsPage() {
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
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!orgId || !userId) return;
    void markNotificationsRead(orgId, userId).then(() => {
      queryClient.invalidateQueries({ queryKey: ["notification-read", orgId, userId] });
    });
  }, [orgId, userId, queryClient]);

  async function markAllRead() {
    if (!orgId || !userId) return;
    await markNotificationsRead(orgId, userId);
    queryClient.invalidateQueries({ queryKey: ["notification-read", orgId, userId] });
  }

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Updates on published datasets, email ingest outcomes, and schema changes in this workspace."
        backTo="/dashboard"
        backLabel="Dashboard"
        crumbs={[{ label: "Notifications" }]}
        action={
          <Button variant="outline" size="sm" onClick={() => void markAllRead()}>
            Mark all read
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
          <CardDescription>
            Everyone in this workspace sees the same feed. Admin-only operational alerts are in
            Admin → Alerts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.data && events.data.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15">
                <Bell className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">No notifications yet.</p>
            </div>
          ) : (
            <NotificationFeed items={events.data ?? []} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
