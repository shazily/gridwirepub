import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PortalLandingPage } from "@/components/portal-landing";
import { fetchPortalBranding } from "@/lib/portal-branding";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/portal/$orgSlug")({
  component: OrgPortalRoute,
});

function OrgPortalRoute() {
  const { orgSlug } = Route.useParams();
  const branding = useQuery({
    queryKey: ["portal-branding", orgSlug],
    queryFn: () => fetchPortalBranding(orgSlug),
    retry: false,
  });

  if (branding.isLoading) {
    return (
      <div className="grid-bg flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading portal…
      </div>
    );
  }

  if (branding.isError || !branding.data) {
    const denied = branding.error instanceof Error && branding.error.message === "portal_access_denied";
    return (
      <div className="grid-bg flex min-h-screen flex-col items-center justify-center p-6">
        <Wordmark />
        <Card className="mt-8 w-full max-w-md">
          <CardContent className="py-10 text-center">
            <h1 className="text-lg font-semibold">
              {denied ? "Access restricted" : "Portal not found"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {denied
                ? "This portal is only available from allowlisted networks. Contact your administrator to add your IP."
                : (
                  <>
                    No organization matches{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5">{orgSlug}</code>. Check the link
                    from your administrator.
                  </>
                )}
            </p>
            <Button className="mt-6" asChild variant="outline">
              <Link to="/">Back to Gridwire</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <PortalLandingPage branding={branding.data} />;
}
