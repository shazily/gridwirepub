import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useOrg } from "@/hooks/use-org";
import { AdminShell } from "@/components/admin-shell";
import { PageHeader } from "@/components/app-shell";
import { HelpTip } from "@/components/help-tip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { portalPath } from "@/lib/portal-branding";
import { regeneratePortalSlug } from "@/lib/security.functions";
import { toast } from "sonner";
import { Building2, Check, Copy, ExternalLink, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/_dash/admin/workspaces")({
  component: AdminWorkspacesPage,
});

function origin() {
  return typeof window !== "undefined" ? window.location.origin : "";
}

function AdminWorkspacesPage() {
  const { orgs, currentOrg, setCurrentOrgId, refetch } = useOrg();
  const navigate = useNavigate();
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  function portalUrl(slug: string) {
    return `${origin()}${portalPath(slug)}`;
  }

  function copyLink(slug: string) {
    void navigator.clipboard.writeText(portalUrl(slug));
    toast.success("Portal link copied");
  }

  function embedSnippet(slug: string) {
    const url = portalUrl(slug);
    return `<iframe src="${url}" width="100%" height="720" style="border:0;border-radius:8px" title="Data portal"></iframe>`;
  }

  async function regenerate(orgId: string) {
    setRegeneratingId(orgId);
    try {
      const { portalSlug } = await regeneratePortalSlug({ data: { orgId } });
      toast.success(`New portal link: /portal/${portalSlug}. Old link still works via alias.`);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not regenerate link");
    } finally {
      setRegeneratingId(null);
    }
  }

  return (
    <AdminShell>
      <PageHeader
        title="Your workspaces"
        description="Each workspace has its own portal URL for embedding in your company intranet."
      />

      <div className="space-y-4">
        {orgs.map((org) => {
          const isCurrent = org.id === currentOrg?.id;
          const slug = org.portal_slug ?? org.slug;
          const url = portalUrl(slug);
          return (
            <Card key={org.id} className={isCurrent ? "border-primary/40" : undefined}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{org.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{org.slug}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {isCurrent ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-primary">
                        <Check className="h-4 w-4" /> Current
                      </span>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setCurrentOrgId(org.id)}>
                        Switch
                      </Button>
                    )}
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/admin/organization">Rename / brand</Link>
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    Public portal URL
                    <HelpTip title="Embed in your company portal">
                      Share this link or paste the iframe snippet on your intranet. Changing the
                      display name does not change the URL. Use Regenerate only if the link was
                      leaked — old URLs keep working via alias.
                    </HelpTip>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Input readOnly value={url} className="font-mono text-xs" />
                    <Button size="icon" variant="outline" onClick={() => copyLink(slug)} aria-label="Copy">
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="outline" asChild>
                      <a href={url} target="_blank" rel="noreferrer" aria-label="Open portal">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      disabled={regeneratingId === org.id}
                      onClick={() => regenerate(org.id)}
                      aria-label="Regenerate portal link"
                    >
                      <RefreshCw className={`h-4 w-4 ${regeneratingId === org.id ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-auto px-0 text-xs"
                    onClick={() => {
                      void navigator.clipboard.writeText(embedSnippet(slug));
                      toast.success("Embed snippet copied");
                    }}
                  >
                    Copy iframe embed snippet
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Button className="mt-4" onClick={() => navigate({ to: "/onboarding", search: { new: true } })}>
        <Plus className="mr-2 h-4 w-4" />
        Create workspace
      </Button>
    </AdminShell>
  );
}
