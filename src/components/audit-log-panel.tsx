import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  Archive,
  ArchiveRestore,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canManage } from "@/hooks/use-org";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  "dataset.archived": { label: "Dataset archived", icon: Archive, tone: "text-warning" },
  "dataset.restored": { label: "Dataset restored", icon: ArchiveRestore, tone: "text-success" },
  "dataset.deleted": { label: "Dataset permanently deleted", icon: Trash2, tone: "text-destructive" },
  "dataset.delete_failed": { label: "Dataset delete failed", icon: ShieldAlert, tone: "text-destructive" },
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

/** Insert-only control-plane / data-access audit trail (owners & admins). */
export function AuditLogPanel() {
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
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <ShieldAlert className="h-8 w-8 text-warning" />
          <p className="text-sm text-muted-foreground">
            Only organization owners and admins can view the audit log.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Tamper-evident, insert-only record of data access and control-plane changes — including
        dataset archive, restore, and permanent deletion.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search actor, action, resource…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
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
            const meta = (e.metadata ?? {}) as {
              access?: string;
              row_count?: number;
              correlation_id?: string;
              reason?: string | null;
              previous_status?: string;
              new_status?: string;
              deleted_name?: string;
              api_effect?: string;
            };
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
                    {(meta.reason || meta.correlation_id || meta.api_effect) && (
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {meta.deleted_name ? `“${meta.deleted_name}” · ` : ""}
                        {meta.previous_status && meta.new_status
                          ? `${meta.previous_status} → ${meta.new_status}`
                          : meta.api_effect
                            ? `API: ${meta.api_effect}`
                            : ""}
                        {meta.reason ? ` · ${meta.reason}` : ""}
                        {meta.correlation_id ? ` · ${meta.correlation_id.slice(0, 8)}` : ""}
                      </div>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {meta.access && (
                      <Badge variant="secondary" className="gap-1">
                        {meta.access === "public" ? (
                          <Globe className="h-3 w-3" />
                        ) : (
                          <Lock className="h-3 w-3" />
                        )}
                        {meta.access}
                      </Badge>
                    )}
                    {typeof meta.row_count === "number" && (
                      <Badge variant="secondary">{meta.row_count} rows</Badge>
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
  );
}
