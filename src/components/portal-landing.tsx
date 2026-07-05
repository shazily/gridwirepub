import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PortalBrand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { type PortalBranding, portalAuthSearch } from "@/lib/portal-branding";
import { ArrowRight, Database, KeyRound, ShieldCheck, Users } from "lucide-react";

const highlights = [
  { icon: Database, text: "Upload spreadsheets and publish versioned REST APIs" },
  { icon: ShieldCheck, text: "Mask, hash, or encrypt sensitive fields automatically" },
  { icon: KeyRound, text: "Scoped API keys with full consumption and audit logging" },
  { icon: Users, text: "Team roles from owner down to read-only viewer" },
];

type PortalLandingPageProps = {
  branding: PortalBranding;
};

export function PortalLandingPage({ branding }: PortalLandingPageProps) {
  const navigate = useNavigate();
  const authSearch = portalAuthSearch(branding.slug);

  const platformName = branding.platform_name;
  const orgName = branding.organization_name;
  const logoUrl = branding.logo_url;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  return (
    <div className="grid-bg flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-6">
        <PortalBrand platformName={platformName} logoUrl={logoUrl} />
        <Button asChild variant="outline">
          <Link to="/auth" search={authSearch}>
            Sign in
          </Link>
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 pb-16 pt-4">
        <div className="text-center">
          <p className="mb-3 text-sm font-medium uppercase tracking-wider text-primary">
            Data portal
          </p>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
            Welcome to <span className="text-primary">{orgName}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            Access {platformName} to publish spreadsheet data as secure APIs for your teams and
            systems.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button size="lg" asChild>
              <Link to="/auth" search={authSearch}>
                Sign in to portal <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/auth" search={authSearch}>
                Create account
              </Link>
            </Button>
          </div>
        </div>

        <Card className="mt-12 border-border/80 bg-card/80 backdrop-blur-sm">
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
            {highlights.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.text} className="flex gap-3 text-sm text-muted-foreground">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <p className="pt-1.5">{item.text}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </main>

      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        <p>
          {platformName !== "Gridwire" ? (
            <>
              Powered by <span className="font-medium text-foreground">Gridwire</span>
            </>
          ) : (
            <>© {new Date().getFullYear()} Gridwire — MIT licensed</>
          )}
        </p>
      </footer>
    </div>
  );
}
