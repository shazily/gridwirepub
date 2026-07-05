import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/use-org";
import { slugify } from "@/lib/spreadsheet";
import { portalPath } from "@/lib/portal-branding";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Building2, Home, Loader2, X } from "lucide-react";

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
  const [loading, setLoading] = useState(false);

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

  if (isLoading || (isReady && orgs.length > 0 && !creatingNew)) {
    return (
      <div className="grid-bg flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

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
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center">
            <Wordmark />
          </div>
          <Card>
            <CardHeader>
              <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <CardTitle>{creatingNew ? "Create another workspace" : "Create your workspace"}</CardTitle>
              <CardDescription>
                Workspaces keep datasets, API keys, and team members isolated. Your account can belong
                to many workspaces — switch between them anytime from the sidebar.
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
                    autoFocus
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
        </div>
      </div>
    </div>
  );
}
