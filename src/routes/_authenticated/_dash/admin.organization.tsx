import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canManage, type OrgRole } from "@/hooks/use-org";
import { logAuditEvent } from "@/lib/audit.functions";
import { PageHeader } from "@/components/app-shell";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Link2, Copy, Trash2, Loader2, ShieldAlert, Building2, ImageIcon, Globe } from "lucide-react";
import { PortalBrand } from "@/components/brand";
import { portalPath } from "@/lib/portal-branding";

const MAX_LOGO_BYTES = 150 * 1024;

export const Route = createFileRoute("/_authenticated/_dash/admin/organization")({
  component: OrgAdmin,
});

const INVITE_ROLES: { value: OrgRole; label: string }[] = [
  { value: "contributor", label: "Contributor" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

function origin() {
  return typeof window !== "undefined" ? window.location.origin : "";
}

async function auditBestEffort(
  orgId: string,
  action: string,
  resourceType?: string,
  resourceId?: string,
  metadata?: Record<string, unknown>,
) {
  try {
    await logAuditEvent({
      data: { orgId, action, resourceType, resourceId, metadata },
    });
  } catch {
    /* best-effort */
  }
}

function OrgAdmin() {
  const { currentOrg, role, refetch, setCurrentOrgId, orgs } = useOrg();
  const orgId = currentOrg?.id;
  const manage = canManage(role);
  const isOwner = role === "owner";
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);

  const [platformName, setPlatformName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [savingBranding, setSavingBranding] = useState(false);

  const [inviteRole, setInviteRole] = useState<OrgRole>("contributor");
  const [maxUses, setMaxUses] = useState("");
  const [inviteMaxFileMb, setInviteMaxFileMb] = useState("");
  const [inviteMaxUploadMb, setInviteMaxUploadMb] = useState("");
  const [creating, setCreating] = useState(false);

  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (currentOrg) {
      setName(currentOrg.name);
      setSlug(currentOrg.slug);
      setPlatformName(currentOrg.portal_platform_name ?? "");
      setLogoUrl(currentOrg.portal_logo_url ?? null);
    }
  }, [currentOrg]);

  const invites = useQuery({
    queryKey: ["admin-invites", orgId],
    enabled: !!orgId && manage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_invites")
        .select("id, token, role, max_uses, use_count, max_upload_bytes, max_file_bytes, created_at, revoked_at")
        .eq("org_id", orgId!)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function saveBranding() {
    if (!orgId) return;
    setSavingBranding(true);
    try {
      const { error } = await supabase
        .from("organizations")
        .update({
          portal_platform_name: platformName.trim() || null,
          portal_logo_url: logoUrl,
        })
        .eq("id", orgId);
      if (error) throw error;
      await auditBestEffort(orgId, "org.branding.updated", "organization", orgId, {
        platform_name: platformName.trim() || null,
        has_logo: !!logoUrl,
      });
      toast.success("Portal branding saved");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save branding");
    } finally {
      setSavingBranding(false);
    }
  }

  async function handleLogoFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      return toast.error("Logo must be an image (PNG, JPG, SVG, or WebP)");
    }
    if (file.size > MAX_LOGO_BYTES) {
      return toast.error("Logo must be 150 KB or smaller");
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setLogoUrl(reader.result);
    };
    reader.readAsDataURL(file);
  }

  const portalUrl = slug.trim() ? `${origin()}${portalPath(slug.trim())}` : "";

  function copyPortalLink() {
    if (!portalUrl) return;
    navigator.clipboard.writeText(portalUrl);
    toast.success("Portal link copied");
  }

  async function saveOrg() {
    if (!orgId) return;
    const cleanSlug = slug.trim().toLowerCase();
    if (!name.trim()) return toast.error("Name is required");
    if (!/^[a-z0-9-]+$/.test(cleanSlug)) {
      return toast.error("Slug can only contain lowercase letters, numbers, and hyphens");
    }
    setSavingOrg(true);
    try {
      const { error } = await supabase
        .from("organizations")
        .update({ name: name.trim(), slug: cleanSlug })
        .eq("id", orgId);
      if (error) throw error;
      await auditBestEffort(orgId, "org.updated", "organization", orgId, {
        name: name.trim(),
        slug: cleanSlug,
      });
      toast.success("Organization updated");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update organization");
    } finally {
      setSavingOrg(false);
    }
  }

  async function createInvite() {
    if (!orgId) return;
    setCreating(true);
    try {
      const uses = parseInt(maxUses, 10);
      const { error } = await supabase.rpc("create_org_invite", {
        _org: orgId,
        _role: inviteRole,
        _max_uses: Number.isFinite(uses) && uses > 0 ? uses : undefined,
        _max_file_bytes: inviteMaxFileMb
          ? Math.round(parseFloat(inviteMaxFileMb) * 1_048_576)
          : undefined,
        _max_upload_bytes: inviteMaxUploadMb
          ? Math.round(parseFloat(inviteMaxUploadMb) * 1_048_576)
          : undefined,
      });
      if (error) throw error;
      await auditBestEffort(orgId, "invite.created", "org_invite", undefined, { role: inviteRole });
      toast.success("Invite link created");
      setMaxUses("");
      setInviteMaxFileMb("");
      setInviteMaxUploadMb("");
      queryClient.invalidateQueries({ queryKey: ["admin-invites", orgId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create invite");
    } finally {
      setCreating(false);
    }
  }

  async function revokeInvite(id: string) {
    const { error } = await supabase
      .from("org_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    if (orgId) await auditBestEffort(orgId, "invite.revoked", "org_invite", id);
    toast.success("Invite revoked");
    queryClient.invalidateQueries({ queryKey: ["admin-invites", orgId] });
  }

  async function deleteOrg() {
    if (!orgId) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("organizations").delete().eq("id", orgId);
      if (error) throw error;
      toast.success("Organization deleted");
      const remaining = orgs.filter((o) => o.id !== orgId);
      await refetch();
      if (remaining.length > 0) {
        setCurrentOrgId(remaining[0].id);
        navigate({ to: "/dashboard" });
      } else {
        navigate({ to: "/onboarding" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete organization");
    } finally {
      setDeleting(false);
    }
  }

  if (!manage) {
    return (
    <AdminShell>
      <div>
        <PageHeader title="Organization" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              You need owner or admin access to manage the organization.
            </p>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
    );
  }

  return (
    <AdminShell>
    <div className="space-y-6">
      <PageHeader
        title="Organization"
        description="Portal branding, workspace details, invite links, and destructive actions."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-primary" /> Portal branding
          </CardTitle>
          <CardDescription>
            Each organization has its own portal URL. Share that link with your team — the main
            Gridwire site stays separate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {portalUrl && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <p className="text-sm font-medium">Organization portal link</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Send this URL to members. Sign-in is branded for this workspace.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="max-w-full truncate rounded bg-background px-2 py-1.5 font-mono text-xs">
                  {portalUrl}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={copyPortalLink}>
                  <Copy className="h-3.5 w-3.5" /> Copy link
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border bg-muted/20 p-4">
            <PortalBrand
              platformName={platformName.trim() || name || "Gridwire"}
              logoUrl={logoUrl}
            />
            <p className="text-xs text-muted-foreground">Preview</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="platform-name">Platform name</Label>
              <Input
                id="platform-name"
                value={platformName}
                onChange={(e) => setPlatformName(e.target.value)}
                placeholder={name || "e.g. Acme Data Portal"}
              />
              <p className="text-xs text-muted-foreground">
                Shown in the header. Leave blank to use the organization name ({name}).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-display-name">Organization name (on portal)</Label>
              <Input id="org-display-name" value={name} onChange={(e) => setName(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Large welcome headline on the portal home page.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="logo-upload">Logo</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" asChild>
                <label htmlFor="logo-upload" className="cursor-pointer">
                  <ImageIcon className="h-4 w-4" /> Upload image
                </label>
              </Button>
              <input
                id="logo-upload"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="sr-only"
                onChange={(e) => {
                  void handleLogoFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              {logoUrl && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setLogoUrl(null)}>
                  Remove logo
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPG, SVG, or WebP. Max 150 KB.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveBranding} disabled={savingBranding}>
              {savingBranding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save branding"}
            </Button>
            <Button variant="outline" onClick={saveOrg} disabled={savingOrg}>
              {savingOrg ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save organization name"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-primary" /> Workspace details
          </CardTitle>
          <CardDescription>The slug is used in your public API URLs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="org-name">Name</Label>
              <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-slug">Slug</Label>
              <Input
                id="org-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="acme-inc"
              />
            </div>
          </div>
          <Button onClick={saveOrg} disabled={savingOrg}>
            {savingOrg ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4 text-primary" /> Invite links
          </CardTitle>
          <CardDescription>
            Anyone with an active link can join this workspace with the selected role.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as OrgRole)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITE_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="max-uses">Max uses (optional)</Label>
              <Input
                id="max-uses"
                type="number"
                min={1}
                className="w-40"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="Unlimited"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Max file (MB)</Label>
              <Input
                className="w-28"
                type="number"
                min={1}
                value={inviteMaxFileMb}
                onChange={(e) => setInviteMaxFileMb(e.target.value)}
                placeholder="Org default"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Total upload (MB)</Label>
              <Input
                className="w-28"
                type="number"
                min={1}
                value={inviteMaxUploadMb}
                onChange={(e) => setInviteMaxUploadMb(e.target.value)}
                placeholder="Org pool"
              />
            </div>
            <Button onClick={createInvite} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create link"}
            </Button>
          </div>

          {invites.data && invites.data.length > 0 ? (
            <div className="space-y-2">
              {invites.data.map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
                >
                  <Badge variant="secondary" className="capitalize">
                    {inv.role}
                  </Badge>
                  <code className="font-mono text-xs text-muted-foreground">
                    /invite/{inv.token.slice(0, 12)}…
                  </code>
                  <span className="text-xs text-muted-foreground">
                    {inv.use_count}
                    {inv.max_uses ? ` / ${inv.max_uses}` : ""} uses
                    {(inv as { max_file_bytes?: number | null }).max_file_bytes
                      ? ` · ${Math.round((inv as { max_file_bytes: number }).max_file_bytes / 1_048_576)} MB/file`
                      : ""}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Copy link"
                      onClick={() => {
                        navigator.clipboard.writeText(`${origin()}/invite/${inv.token}`);
                        toast.success("Invite link copied");
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Revoke"
                      onClick={() => revokeInvite(inv.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active invite links.</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
          <CardDescription>
            {isOwner
              ? "Deleting the organization permanently removes all datasets, keys, members, and history. This cannot be undone."
              : "Only the organization owner can delete this workspace."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={!isOwner}>
                <Trash2 className="h-4 w-4" /> Delete organization
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{currentOrg?.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes all data for this organization. Type the organization name
                  to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                placeholder={currentOrg?.name}
              />
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDeleteText("")}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleteText !== currentOrg?.name || deleting}
                  onClick={(e) => {
                    e.preventDefault();
                    deleteOrg();
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete forever"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
      </div>
    </AdminShell>
  );
}
