import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/use-org";
import { slugify } from "@/lib/spreadsheet";
import { portalPath } from "@/lib/portal-branding";
import { showMarketingLanding } from "@/lib/deployment";
import {
  clearPendingJoinRef,
  isOrgUuid,
  setCurrentOrgIdLocal,
} from "@/lib/org-join";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Building2, Home, Link2, Loader2, UserPlus, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/onboarding")({
  validateSearch: (search: Record<string, unknown>) => ({
    new: search.new === true || search.new === "1" || search.new === "true",
  }),
  component: Onboarding,
});

function Onboarding() {
  const navigate = useNavigate();
  const { new: creatingNew } = Route.useSearch();
  const { orgs, isLoading, isReady, setCurrentOrgId, refetch } = useOrg();
  const [name, setName] = useState("");
  const [orgUuid, setOrgUuid] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(creatingNew || showMarketingLanding);

  useEffect(() => {
    if (!isReady || isLoading) return;
    if (orgs.length > 0 && !creatingNew) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [isReady, isLoading, orgs.length, creatingNew, navigate]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;
      const { data, error } = await supabase.rpc("create_organization", {
        _name: name.trim(),
        _slug: slug,
      });
      if (error) throw error;
      if (data?.id) setCurrentOrgId(data.id);
      const result = await refetch();
      if (result.error) throw result.error;
      if (!result.data?.length) {
        throw new Error("Organization was created but could not load your workspace. Refresh and try again.");
      }
      toast.success(
        data?.slug
          ? `Organization created. Share your portal: ${window.location.origin}${portalPath(data.slug)}`
          : "Organization created",
      );
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create organization");
    } finally {
      setLoading(false);
    }
  }

  async function joinByUuid(e: React.FormEvent) {
    e.preventDefault();
    const ref = orgUuid.trim();
    if (!isOrgUuid(ref)) {
      toast.error("Enter the organization UUID (from your admin), not a name or slug.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("join_organization_by_ref", { _ref: ref });
      if (error) throw error;
      const orgId = typeof data === "string" ? data : null;
      if (!orgId) throw new Error("Unable to join this organization");
      setCurrentOrgIdLocal(orgId);
      setCurrentOrgId(orgId);
      clearPendingJoinRef();
      const result = await refetch();
      if (result.error) throw result.error;
      toast.success("You've joined the workspace as a Viewer.");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to join this organization");
    } finally {
      setLoading(false);
    }
  }

  function goToInvite(e: React.FormEvent) {
    e.preventDefault();
    const raw = inviteInput.trim();
    if (!raw) return;
    let token = raw;
    try {
      if (raw.includes("/invite/")) {
        const u = new URL(raw, window.location.origin);
        const parts = u.pathname.split("/").filter(Boolean);
        const idx = parts.indexOf("invite");
        if (idx >= 0 && parts[idx + 1]) token = decodeURIComponent(parts[idx + 1]);
      }
    } catch {
      /* use raw as token */
    }
    if (!token) {
      toast.error("Paste a full invite link or token.");
      return;
    }
    void navigate({ to: "/invite/$token", params: { token } });
  }

  if (isLoading || (isReady && orgs.length > 0 && !creatingNew)) {
    return (
      <div className="grid-bg flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const joinFirst = !showMarketingLanding && !creatingNew;

  return (
    <div className="grid-bg relative flex min-h-screen flex-col p-6">
      {creatingNew && (
        <div className="mx-auto mb-4 flex w-full max-w-md items-center justify-between">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/workspaces">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Workspaces
            </Link>
          </Button>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" asChild aria-label="Go to dashboard">
              <Link to="/dashboard">
                <Home className="h-4 w-4" />
              </Link>
            </Button>
            <Button variant="ghost" size="icon" asChild aria-label="Close">
              <Link to="/admin">
                <X className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-md space-y-4">
          <div className="mb-4 flex justify-center">
            <Wordmark />
          </div>

          {joinFirst && (
            <>
              <Card>
                <CardHeader>
                  <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15">
                    <UserPlus className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle>Join a workspace</CardTitle>
                  <CardDescription>
                    Enter the organization UUID from your administrator. Join must be enabled on that
                    workspace (Authentication → Allow join by organization ID). You join as a Viewer.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={joinByUuid} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="org-uuid">Organization UUID</Label>
                      <Input
                        id="org-uuid"
                        value={orgUuid}
                        onChange={(e) => setOrgUuid(e.target.value)}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                        autoFocus
                        className="font-mono text-sm"
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Join as Viewer"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15">
                    <Link2 className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">Have an invite link?</CardTitle>
                  <CardDescription>
                    Paste the full /invite/… link or token for Contributor+ roles.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={goToInvite} className="flex flex-col gap-3 sm:flex-row">
                    <Input
                      value={inviteInput}
                      onChange={(e) => setInviteInput(e.target.value)}
                      placeholder={`${typeof window !== "undefined" ? window.location.origin : ""}/invite/…`}
                      className="font-mono text-xs"
                    />
                    <Button type="submit" variant="outline" className="shrink-0">
                      Open invite
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {!showCreate ? (
                <button
                  type="button"
                  className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => setShowCreate(true)}
                >
                  First admin on this instance? Create a new workspace
                </button>
              ) : null}
            </>
          )}

          {(showCreate || creatingNew || showMarketingLanding) && (
            <Card>
              <CardHeader>
                <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <CardTitle>
                  {creatingNew ? "Create another workspace" : "Create your workspace"}
                </CardTitle>
                <CardDescription>
                  {joinFirst
                    ? "Only needed when you are setting up this Gridwire instance for the first time."
                    : "Workspaces keep datasets, API keys, and team members isolated. Your account can belong to many workspaces."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={create} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="org">Organization name</Label>
                    <Input
                      id="org"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Acme Inc."
                      autoFocus={!joinFirst}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create organization"}
                  </Button>
                  {creatingNew && (
                    <Button type="button" variant="outline" className="w-full" asChild>
                      <Link to="/workspaces">Cancel</Link>
                    </Button>
                  )}
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
