import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canManage, type OrgRole } from "@/hooks/use-org";
import { useAuth } from "@/hooks/use-auth";
import { logAuditEvent } from "@/lib/audit.functions";
import { PageHeader } from "@/components/app-shell";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Activity, Link2, Copy, ShieldCheck, Ban, UserMinus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/admin/team")({
  component: Members,
});

const ROLES: OrgRole[] = ["owner", "admin", "member", "viewer", "contributor"];
const ADMIN_ASSIGNABLE_ROLES: OrgRole[] = ["member", "contributor", "viewer"];

function assignableRoles(actorRole: OrgRole | null): OrgRole[] {
  if (actorRole === "owner") return ROLES;
  if (actorRole === "admin") return ADMIN_ASSIGNABLE_ROLES;
  return [];
}
// Roles that can be granted through a shareable invite link.
const INVITE_ROLES: { value: OrgRole; label: string; hint: string }[] = [
  { value: "contributor", label: "Data contributor", hint: "Can only drop data — recommended for external teams" },
  { value: "member", label: "Member", hint: "Can create & manage datasets" },
  { value: "viewer", label: "Viewer", hint: "Read-only access" },
];

function origin() {
  return typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3020";
}

function Members() {
  const { currentOrg, role } = useOrg();
  const { user } = useAuth();
  const orgId = currentOrg?.id;
  const manage = canManage(role);
  const queryClient = useQueryClient();

  const [inviteRole, setInviteRole] = useState<OrgRole>("contributor");
  const [note, setNote] = useState("");
  const [expiresDays, setExpiresDays] = useState("7");
  const [maxUses, setMaxUses] = useState("");
  const [creating, setCreating] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string; role: OrgRole } | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");

  const members = useQuery({
    queryKey: ["members", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_members")
        .select("id, role, user_id, created_at, user_type, identity_source, profiles(display_name)")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: true });
      if (error) {
        // Pre-migration fallback when user_type columns are absent.
        const fallback = await supabase
          .from("org_members")
          .select("id, role, user_id, created_at, profiles(display_name)")
          .eq("org_id", orgId!)
          .order("created_at", { ascending: true });
        if (fallback.error) throw fallback.error;
        return (fallback.data ?? []).map((m) => ({
          ...m,
          user_type: "internal" as const,
          identity_source: "local" as const,
        }));
      }
      return data;
    },
  });

  const invites = useQuery({
    queryKey: ["invites", orgId],
    enabled: !!orgId && manage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_invites")
        .select("id, token, role, note, expires_at, max_uses, use_count, created_at")
        .eq("org_id", orgId!)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const events = useQuery({
    queryKey: ["consumption", orgId],
    enabled: !!orgId && manage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_events")
        .select("id, endpoint, status_code, row_count, created_at")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return data;
    },
  });

  async function createInvite() {
    if (!orgId) return;
    setCreating(true);
    try {
      const days = parseInt(expiresDays, 10);
      const uses = parseInt(maxUses, 10);
      const { error } = await supabase.rpc("create_org_invite", {
        _org: orgId,
        _role: inviteRole,
        _note: note.trim() || undefined,
        _expires_at: Number.isFinite(days) && days > 0
          ? new Date(Date.now() + days * 86400000).toISOString()
          : undefined,
        _max_uses: Number.isFinite(uses) && uses > 0 ? uses : undefined,
      });
      if (error) throw error;
      try {
        await logAuditEvent({
          data: {
            orgId,
            action: "invite.created",
            resourceType: "org_invite",
            metadata: { role: inviteRole, max_uses: Number.isFinite(uses) && uses > 0 ? uses : null },
          },
        });
      } catch {
        /* best-effort */
      }
      toast.success("Invite link created");
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["invites", orgId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create invite");
    } finally {
      setCreating(false);
    }
  }

  function copyLink(token: string) {
    navigator.clipboard.writeText(`${origin()}/invite/${token}`);
    toast.success("Invite link copied");
  }

  async function revokeInvite(id: string) {
    const { error } = await supabase.from("org_invites").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    if (orgId) {
      try {
        await logAuditEvent({
          data: { orgId, action: "invite.revoked", resourceType: "org_invite", resourceId: id },
        });
      } catch {
        /* best-effort */
      }
    }
    queryClient.invalidateQueries({ queryKey: ["invites", orgId] });
  }

  async function changeRole(id: string, newRole: OrgRole) {
    const { error } = await supabase.rpc("update_org_member_role", {
      _member_id: id,
      _new_role: newRole,
    });
    if (error) return toast.error(error.message);
    if (orgId) {
      try {
        await logAuditEvent({
          data: {
            orgId,
            action: "member.role.changed",
            resourceType: "org_member",
            resourceId: id,
            metadata: { role: newRole },
          },
        });
      } catch {
        /* best-effort */
      }
    }
    queryClient.invalidateQueries({ queryKey: ["members", orgId] });
  }

  async function changeUserType(id: string, userType: "internal" | "external") {
    const { error } = await supabase.rpc("update_org_member_user_type", {
      _member_id: id,
      _user_type: userType,
    });
    if (error) return toast.error(error.message);
    if (orgId) {
      try {
        await logAuditEvent({
          data: {
            orgId,
            action: "member.user_type.changed",
            resourceType: "org_member",
            resourceId: id,
            metadata: { user_type: userType },
          },
        });
      } catch {
        /* best-effort */
      }
    }
    queryClient.invalidateQueries({ queryKey: ["members", orgId] });
  }

  const ownerCount = (members.data ?? []).filter((m) => m.role === "owner").length;
  const roleOptions = assignableRoles(role);

  const filteredMembers = (members.data ?? []).filter((m) => {
    const profile = m.profiles as unknown as { display_name?: string } | null;
    const display = (profile?.display_name ?? "Member").toLowerCase();
    if (search.trim() && !display.includes(search.trim().toLowerCase())) return false;
    if (filterRole !== "all" && m.role !== filterRole) return false;
    const userType = (m as { user_type?: string }).user_type ?? "internal";
    const identitySource = (m as { identity_source?: string }).identity_source ?? "local";
    if (filterType !== "all" && userType !== filterType) return false;
    if (filterSource !== "all" && identitySource !== filterSource) return false;
    return true;
  });

  async function removeMember(id: string, memberRole: OrgRole) {
    if (memberRole === "owner" && ownerCount <= 1) {
      return toast.error("Cannot remove the last owner");
    }
    if (memberRole === "owner" && role !== "owner") {
      return toast.error("Only owners can remove another owner");
    }
    const { error } = await supabase.from("org_members").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (orgId) {
      try {
        await logAuditEvent({
          data: { orgId, action: "member.removed", resourceType: "org_member", resourceId: id },
        });
      } catch {
        /* best-effort */
      }
    }
    queryClient.invalidateQueries({ queryKey: ["members", orgId] });
  }

  return (
    <AdminShell>
      <PageHeader
        title="Team & access"
        description="Invite people with secure links, change roles, revoke workspace access, and review API activity."
      />

      {!manage && (
        <Card className="mb-6 border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Only organization owners and admins can invite users or revoke access. Ask your workspace
            owner if you need someone added or removed.
          </CardContent>
        </Card>
      )}

      {manage && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4 text-primary" /> Create an invite link
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Share the link with a teammate. They sign up (or sign in) and instantly join this workspace — no
              pre-existing account required.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5" style={{ minWidth: 220 }}>
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as OrgRole)}>
                  <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INVITE_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Expires in (days)</Label>
                <Input className="w-32" type="number" min={1} value={expiresDays} onChange={(e) => setExpiresDays(e.target.value)} placeholder="7" />
              </div>
              <div className="space-y-1.5">
                <Label>Max uses (optional)</Label>
                <Input className="w-36" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="unlimited" />
              </div>
              <div className="flex-1 space-y-1.5" style={{ minWidth: 180 }}>
                <Label>Note (optional)</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Finance team" />
              </div>
              <Button onClick={createInvite} disabled={creating}>
                <Link2 className="h-4 w-4" /> Generate link
              </Button>
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              Data contributors can only upload data — it's converted into a secure, token-only API with sensitive
              fields auto-flagged for masking, hashing or encryption.
            </p>
          </CardContent>
        </Card>
      )}

      {manage && invites.data && invites.data.length > 0 && (
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">Active invite links</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {invites.data.map((inv) => {
              const expired = inv.expires_at && new Date(inv.expires_at) < new Date();
              return (
                <div key={inv.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                  <Badge variant="secondary" className="capitalize">{inv.role}</Badge>
                  <code className="max-w-[16rem] truncate rounded bg-muted/50 px-2 py-1 font-mono text-xs">
                    /invite/{inv.token.slice(0, 12)}…
                  </code>
                  {inv.note && <span className="text-sm text-muted-foreground">{inv.note}</span>}
                  <span className="text-xs text-muted-foreground">
                    Used {inv.use_count}{inv.max_uses ? `/${inv.max_uses}` : ""}
                    {inv.expires_at ? ` · ${expired ? "expired" : `expires ${new Date(inv.expires_at).toLocaleDateString()}`}` : ""}
                  </span>
                  <div className="ml-auto flex gap-1.5">
                    <Button variant="outline" size="sm" onClick={() => copyLink(inv.token)}>
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => revokeInvite(inv.id)}>
                      <Ban className="h-3.5 w-3.5 text-destructive" /> Revoke
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">People in this workspace</CardTitle>
          <p className="text-sm text-muted-foreground">
            Change a member&apos;s role from the dropdown, or revoke their access entirely.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Input
              className="max-w-xs"
              placeholder="Search by name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select value={filterRole} onValueChange={setFilterRole}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Role" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
                <SelectItem value="external">External</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterSource} onValueChange={setFilterSource}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="local">Local</SelectItem>
                <SelectItem value="sso">SSO</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredMembers.map((m) => {
            const profile = m.profiles as unknown as { display_name?: string } | null;
            const display = profile?.display_name ?? "Member";
            const userType = ((m as { user_type?: string }).user_type ?? "internal") as "internal" | "external";
            const identitySource = ((m as { identity_source?: string }).identity_source ?? "local") as
              | "local"
              | "sso";
            const isSoleOwner = m.role === "owner" && ownerCount <= 1;
            const canRemove =
              manage &&
              !isSoleOwner &&
              (m.role !== "owner" || role === "owner") &&
              !(m.user_id === user?.id && m.role === "owner" && ownerCount <= 1);
            const canChangeRole =
              manage &&
              roleOptions.length > 0 &&
              !(m.role === "owner" && role !== "owner") &&
              !(m.user_id === user?.id && role === "admin");
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{display.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-[8rem] flex-1">
                  <div className="font-medium">{display}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant="outline" className="capitalize text-[10px]">{userType}</Badge>
                    <Badge variant="secondary" className="uppercase text-[10px]">{identitySource}</Badge>
                  </div>
                </div>
                {manage ? (
                  <Select
                    value={userType}
                    onValueChange={(v) => changeUserType(m.id, v as "internal" | "external")}
                  >
                    <SelectTrigger className="w-32 capitalize"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="internal">Internal</SelectItem>
                      <SelectItem value="external">External</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}
                {canChangeRole ? (
                  <Select value={m.role} onValueChange={(v) => changeRole(m.id, v as OrgRole)}>
                    <SelectTrigger className="w-36 capitalize"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((r) => (
                        <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="secondary" className="capitalize">{m.role}</Badge>
                )}
                {canRemove && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() =>
                      setRemoveTarget({ id: m.id, name: display, role: m.role as OrgRole })
                    }
                  >
                    <UserMinus className="h-3.5 w-3.5" /> Revoke
                  </Button>
                )}
              </div>
            );
          })}
          {filteredMembers.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No members match these filters.</p>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke access for {removeTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will immediately lose access to this organization&apos;s datasets, API keys, and
              connectors. You can invite them again later with a new link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removeTarget) {
                  void removeMember(removeTarget.id, removeTarget.role);
                  setRemoveTarget(null);
                }
              }}
            >
              Revoke access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {manage && (
        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Recent API consumption</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {events.data && events.data.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2">Endpoint</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Rows</th>
                    <th className="px-3 py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {events.data.map((e) => (
                    <tr key={e.id} className="border-b border-border/50">
                      <td className="max-w-[20rem] truncate px-3 py-2 font-mono text-xs">{e.endpoint}</td>
                      <td className="px-3 py-2">
                        <Badge variant={e.status_code < 400 ? "default" : "destructive"}>{e.status_code}</Badge>
                      </td>
                      <td className="px-3 py-2">{e.row_count}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">No API calls logged yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </AdminShell>
  );
}
