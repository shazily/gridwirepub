import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { CarouselApi } from "@/components/ui/carousel";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useOrg } from "@/hooks/use-org";
import { isWelcomeCompleted, markWelcomeCompleted } from "@/lib/welcome-tour";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Building2,
  Crown,
  Database,
  KeyRound,
  Shield,
  UploadCloud,
  UserMinus,
  UserPlus,
  Users,
  Eye,
  PenLine,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/welcome")({
  validateSearch: (search: Record<string, unknown>) => ({
    replay: search.replay === true || search.replay === "1" || search.replay === "true",
  }),
  component: WelcomeTour,
});

const SLIDE_COUNT = 5;

const ROLES = [
  {
    role: "Owner",
    icon: Crown,
    summary: "Created the workspace. Full control including delete org and assigning admins.",
    access: "Everything",
  },
  {
    role: "Admin",
    icon: Shield,
    summary: "Day-to-day management — members, keys, connectors — without deleting the org.",
    access: "Manage (no owner promotion)",
  },
  {
    role: "Member",
    icon: PenLine,
    summary: "Create and edit datasets, publish APIs, view keys and connectors.",
    access: "Publish data",
  },
  {
    role: "Contributor",
    icon: UploadCloud,
    summary: "Upload-only. Data lands as secure, token-scoped APIs — no admin surfaces.",
    access: "Upload only",
  },
  {
    role: "Viewer",
    icon: Eye,
    summary: "Read datasets and dashboard stats. Cannot create or change anything.",
    access: "Read only",
  },
] as const;

function WelcomeTour() {
  const navigate = useNavigate();
  const { replay } = Route.useSearch();
  const { currentOrg, orgs, isLoading, isReady, isError, role } = useOrg();
  const orgId = currentOrg?.id;
  const [api, setApi] = useState<CarouselApi>();
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => setSlide(api.selectedScrollSnap());
    onSelect();
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  useEffect(() => {
    if (!isReady || isLoading) return;
    if (isError) return;
    if (orgs.length === 0) {
      navigate({ to: "/onboarding", replace: true });
      return;
    }
    if (!replay && orgId && isWelcomeCompleted(orgId)) {
      navigate({ to: "/dashboard", replace: true });
      return;
    }
    if (!replay && orgId && role === "owner") {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [isReady, isLoading, isError, orgs.length, orgId, role, replay, navigate]);

  const finish = useCallback(
    (to: "/dashboard" | "/members") => {
      if (orgId) markWelcomeCompleted(orgId);
      navigate({ to, replace: true });
    },
    [orgId, navigate],
  );

  if (isLoading || !currentOrg) {
    return (
      <div className="grid-bg flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const orgName = currentOrg.name;

  return (
    <div className="grid-bg flex min-h-screen flex-col p-4 sm:p-6">
      <div className="mx-auto mb-6 flex w-full max-w-3xl items-center justify-between">
        <Wordmark />
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => finish("/dashboard")}
        >
          Skip tour
        </Button>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center">
        <Carousel setApi={setApi} opts={{ loop: false }} className="w-full">
          <CarouselContent>
            <CarouselItem>
              <SlideCard
                icon={Building2}
                title={`Welcome to ${orgName}`}
                subtitle="You’re the organization owner. Here’s how Gridwire turns spreadsheets into production APIs — and how your team fits in."
              >
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Gridwire is your on-prem workspace: upload Excel or CSV, map fields, apply masking
                  for sensitive columns, and publish a documented REST API with keys and audit
                  logging. Everything stays inside your organization.
                </p>
              </SlideCard>
            </CarouselItem>

            <CarouselItem>
              <SlideCard
                icon={Database}
                title="How the platform works"
                subtitle="Four steps from file to API"
              >
                <ol className="space-y-3 text-sm">
                  {[
                    { step: "1", text: "Upload a spreadsheet or connect a folder / SFTP source." },
                    { step: "2", text: "Map columns, set types, and flag fields to mask or hash." },
                    { step: "3", text: "Publish — each version is tracked; schema drift triggers alerts." },
                    { step: "4", text: "Share API keys and monitor consumption from the dashboard." },
                  ].map((item) => (
                    <li key={item.step} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                        {item.step}
                      </span>
                      <span className="pt-0.5 text-muted-foreground">{item.text}</span>
                    </li>
                  ))}
                </ol>
              </SlideCard>
            </CarouselItem>

            <CarouselItem>
              <SlideCard
                icon={Users}
                title="Roles & access levels"
                subtitle="Assign the least privilege each person needs"
              >
                <div className="space-y-2">
                  {ROLES.map((r) => {
                    const Icon = r.icon;
                    return (
                      <div
                        key={r.role}
                        className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-3"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{r.role}</span>
                            <Badge variant="secondary" className="text-[10px]">
                              {r.access}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{r.summary}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SlideCard>
            </CarouselItem>

            <CarouselItem>
              <SlideCard
                icon={UserPlus}
                title="Manage users & revoke access"
                subtitle="Team & access — in the sidebar under Members"
              >
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>As owner you can delegate admins, but you always control who has access:</p>
                  <ul className="space-y-2">
                    <li className="flex gap-2">
                      <UserPlus className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>
                        <strong className="text-foreground">Invite links</strong> — generate a link
                        with a role (contributor, member, or viewer). Revoke unused links anytime.
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>
                        <strong className="text-foreground">Change roles</strong> — promote to admin
                        or demote members from the team list (owners only for admin/owner roles).
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <UserMinus className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>
                        <strong className="text-foreground">Revoke access</strong> — remove someone
                        from the organization with one click. Actions are recorded in the audit log.
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>
                        <strong className="text-foreground">API keys</strong> — rotate or revoke keys
                        separately under API Keys when someone should lose API access only.
                      </span>
                    </li>
                  </ul>
                </div>
              </SlideCard>
            </CarouselItem>

            <CarouselItem>
              <SlideCard
                icon={ArrowRight}
                title="You’re ready"
                subtitle="Start with a dataset or invite your team first"
              >
                <p className="mb-4 text-sm text-muted-foreground">
                  Your workspace is set up. In Admin → Organization you&apos;ll find your dedicated
                  portal link (<code className="text-xs">/portal/your-slug</code>) to share with
                  your team. Create a dataset from the dashboard or invite colleagues first.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button className="flex-1" onClick={() => finish("/members")}>
                    <Users className="h-4 w-4" /> Invite team
                  </Button>
                  <Button className="flex-1" variant="outline" onClick={() => finish("/dashboard")}>
                    Go to dashboard
                  </Button>
                </div>
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Replay this tour anytime from{" "}
                  <Link to="/help" className="text-primary underline-offset-4 hover:underline">
                    Help &amp; FAQ
                  </Link>
                  .
                </p>
              </SlideCard>
            </CarouselItem>
          </CarouselContent>

          <CarouselPrevious className="left-0 sm:-left-4" />
          <CarouselNext className="right-0 sm:-right-4" />
        </Carousel>

        <div className="mt-6 flex items-center justify-center gap-2">
          {Array.from({ length: SLIDE_COUNT }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              className={cn(
                "h-2 rounded-full transition-all",
                slide === i ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30",
              )}
              onClick={() => api?.scrollTo(i)}
            />
          ))}
        </div>

        {slide < SLIDE_COUNT - 1 && (
          <div className="mt-4 flex justify-center">
            <Button variant="ghost" size="sm" onClick={() => api?.scrollNext()}>
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function SlideCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Building2;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <Card className="border-border/80 shadow-lg">
      <CardContent className="p-6 sm:p-8">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15">
          <Icon className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </CardContent>
    </Card>
  );
}
