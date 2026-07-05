import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canManage } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ScrollText,
  KeyRound,
  UserCog,
  Database,
  Globe,
  Lock,
  Mail,
  ShieldAlert,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/_dash/admin/audit")({
  component: AuditLog,
});

type AuditEvent = {
  id: number;
  action: string;
  actor_label: string | null;
  resource_type: string | null;
  resource_id: string | null;
  dataset_id: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const ACTION_META: Record<string, { label: string; icon: typeof ScrollText; tone: string }> = {
  "api.data.read": { label: "Data accessed via API", icon: Database, tone: "text-primary" },
  "dataset.created": { label: "Dataset created", icon: Database, tone: "text-success" },
  "dataset.version.published": { label: "New version published", icon: Database, tone: "text-success" },
  "dataset.access.changed": { label: "API access changed", icon: Lock, tone: "text-warning" },
  "api_key.created": { label: "API key created", icon: KeyRound, tone: "text-success" },
  "api_key.revoked": { label: "API key revoked", icon: KeyRound, tone: "text-destructive" },
  "api_key.rotated": { label: "API key rotated", icon: KeyRound, tone: "text-warning" },
  "api.auth.failed": { label: "Failed API authentication", icon: ShieldAlert, tone: "text-destructive" },
  "invite.created": { label: "Invite link created", icon: Mail, tone: "text-primary" },
  "invite.revoked": { label: "Invite revoked", icon: Mail, tone: "text-destructive" },
  "member.role.changed": { label: "Member role changed", icon: UserCog, tone: "text-warning" },
  "member.removed": { label: "Member removed", icon: UserCog, tone: "text-destructive" },
};

function metaFor(action: string) {
  return ACTION_META[action] ?? { label: action, icon: ScrollText, tone: "text-muted-foreground" };
}

function AuditLog() {
  const { currentOrg, role } = useOrg();
  const orgId = currentOrg?.id;
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");

  const events = useQuery({
    queryKey: ["audit-events", orgId],
    enabled: !!orgId && canManage(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_events")
        .select("id, action, actor_label, resource_type, resource_id, dataset_id, ip, metadata, created_at")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as AuditEvent[];
    },
  });

  const filtered = useMemo(() => {
    const list = events.data ?? [];
    return list.filter((e) => {
      if (filter === "access" && e.action !== "api.data.read") return false;
      if (filter === "control" && e.action === "api.data.read") return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        e.action.toLowerCase().includes(q) ||
        (e.actor_label ?? "").toLowerCase().includes(q) ||
        (e.resource_id ?? "").toLowerCase().includes(q) ||
        JSON.stringify(e.metadata ?? {}).toLowerCase().includes(q)
      );
    });
  }, [events.data, search, filter]);

  function exportCsv() {
    const cols = [
      "created_at",
      "action",
      "actor_label",
      "resource_type",
      "resource_id",
      "dataset_id",
      "ip",
      "metadata",
    ] as const;
    const escape = (v: unknown) => {
      const s =
        v === null || v === undefined
          ? ""
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = filtered.map((e) => cols.map((c) => escape(e[c as keyof AuditEvent])).join(","));
    const csv = [cols.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (!canManage(role)) {
    return (
    <AdminShell>
      <div>
        <PageHeader title="Audit log" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ShieldAlert className="h-8 w-8 text-warning" />
            <p className="text-sm text-muted-foreground">
              Only organization owners and admins can view the audit log.
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
        title="Audit log"
        description="A tamper-evident record of who accessed data and who changed access controls. Retained per organization and visible only to owners and admins."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search actor, action, resource…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            <SelectItem value="access">Data access only</SelectItem>
            <SelectItem value="control">Access-control changes</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {filtered.length} event{filtered.length === 1 ? "" : "s"}
          </span>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      {events.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ScrollText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No audit events yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => {
            const m = metaFor(e.action);
            const Icon = m.icon;
            const access = (e.metadata as { access?: string } | null)?.access;
            return (
              <Card key={e.id}>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                    <Icon className={`h-4 w-4 ${m.tone}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium">{m.label}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {e.actor_label || "Unknown"}
                      {e.resource_id ? ` · ${e.resource_id}` : ""}
                      {e.ip ? ` · ${e.ip}` : ""}
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {access && (
                      <Badge variant="secondary" className="gap-1">
                        {access === "public" ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                        {access}
                      </Badge>
                    )}
                    {typeof (e.metadata as { row_count?: number } | null)?.row_count === "number" && (
                      <Badge variant="secondary">{(e.metadata as { row_count?: number }).row_count} rows</Badge>
                    )}
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {new Date(e.created_at).toLocaleString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      </div>
    </AdminShell>
  );
}
