import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canManage } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Mail, Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/admin/alerts")({
  component: AdminAlertsPage,
});

const EVENT_TYPES = [
  { key: "publish", label: "Dataset published / updated", severity: "info" },
  { key: "baseline_drift", label: "Schema / baseline drift", severity: "warning" },
  { key: "ingestion_error", label: "Ingestion errors", severity: "error" },
  { key: "connector_error", label: "Connector failures", severity: "error" },
  { key: "suspicious_access", label: "Suspicious API access", severity: "warning" },
  { key: "email_ingest_success", label: "Email ingest succeeded (admin copy)", severity: "info" },
  { key: "email_ingest_failure", label: "Email ingest failed (admin copy)", severity: "error" },
] as const;

const sevMeta: Record<string, { icon: typeof Info; className: string }> = {
  info: { icon: CheckCircle2, className: "text-emerald-500" },
  warning: { icon: AlertTriangle, className: "text-amber-500" },
  error: { icon: XCircle, className: "text-destructive" },
};

function AdminAlertsPage() {
  const { currentOrg, role } = useOrg();
  const orgId = currentOrg?.id;
  const manage = canManage(role);
  const queryClient = useQueryClient();
  const [recipients, setRecipients] = useState("");
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  const configs = useQuery({
    queryKey: ["alert-configs", orgId],
    enabled: !!orgId && manage,
    queryFn: async () => {
      const { data, error } = await supabase.from("alerts").select("*").eq("org_id", orgId!);
      if (error) throw error;
      return data;
    },
  });

  const events = useQuery({
    queryKey: ["admin-alert-events", orgId],
    enabled: !!orgId && manage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_events")
        .select("*")
        .eq("org_id", orgId!)
        .eq("audience", "admins")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!configs.data) return;
    const en: Record<string, boolean> = {};
    let recip = "";
    for (const c of configs.data) {
      en[c.event_type] = c.enabled;
      if ((c.recipients ?? []).length > 0) recip = c.recipients.join(", ");
    }
    setEnabled(en);
    if (recip) setRecipients(recip);
  }, [configs.data]);

  async function save() {
    if (!orgId || !manage) return;
    const list = recipients
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const rows = EVENT_TYPES.map((t) => ({
      org_id: orgId,
      event_type: t.key,
      enabled: enabled[t.key] ?? false,
      recipients: list,
    }));
    const { error } = await supabase.from("alerts").upsert(rows, { onConflict: "org_id,event_type" });
    if (error) return toast.error(error.message);
    toast.success("Alert settings saved");
    queryClient.invalidateQueries({ queryKey: ["alert-configs", orgId] });
  }

  return (
    <AdminShell>
      <div>
        <PageHeader
          title="Alerts"
          description="Configure which operational events email your admin team. Members use the bell icon for workspace notifications."
          crumbs={[{ label: "Admin", to: "/admin" }, { label: "Alerts" }]}
        />

        <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <Mail className="mt-0.5 h-4 w-4 text-amber-500" />
          <span>
            Email ingest has its own recipient list under Admin → Email ingest. Use this page for
            connector failures, suspicious API access, and optional copies of publish events.
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Email alert settings</CardTitle>
              <CardDescription>Owners and admins only.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Recipients</Label>
                <Input
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                  placeholder="ops@acme.com, data@acme.com"
                />
                <p className="text-xs text-muted-foreground">Comma-separated email addresses.</p>
              </div>
              <div className="space-y-3">
                {EVENT_TYPES.map((t) => (
                  <div key={t.key} className="flex items-center justify-between gap-3">
                    <span className="text-sm">{t.label}</span>
                    <Switch
                      checked={enabled[t.key] ?? false}
                      onCheckedChange={(v) => setEnabled((p) => ({ ...p, [t.key]: v }))}
                    />
                  </div>
                ))}
              </div>
              <Button onClick={save} className="w-full">
                Save settings
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Admin event log</CardTitle>
              <CardDescription>Operational alerts visible to owners and admins only.</CardDescription>
            </CardHeader>
            <CardContent>
              {events.data && events.data.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">No admin alerts yet.</p>
              ) : (
                <div className="space-y-2">
                  {events.data?.map((e) => {
                    const sm = sevMeta[e.severity] ?? sevMeta.info;
                    const SIcon = sm.icon;
                    return (
                      <div key={e.id} className="rounded-lg border p-3">
                        <div className="flex items-center gap-2">
                          <SIcon className={`h-4 w-4 ${sm.className}`} />
                          <span className="text-sm font-medium">{e.title}</span>
                          <Badge
                            variant={e.email_status === "sent" ? "default" : "secondary"}
                            className="ml-auto text-[10px]"
                          >
                            {e.email_status === "sent" ? "emailed" : e.email_status}
                          </Badge>
                        </div>
                        {e.body && <p className="mt-1.5 text-xs text-muted-foreground">{e.body}</p>}
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {new Date(e.created_at).toLocaleString()}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminShell>
  );
}
