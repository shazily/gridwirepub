import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-chrome";
import { PublicMarketingNav } from "@/components/public-marketing-nav";
import { TrustBoundarySection } from "@/components/trust-boundary-section";
import {
  FEATURE_SPOTLIGHTS,
  PLATFORM_FEATURE_CATEGORIES,
  PLATFORM_FEATURES,
  type PlatformFeatureCategoryId,
} from "@/lib/platform-features";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Cable,
  GitBranch,
  Globe,
  HardDrive,
  KeyRound,
  FileScan,
  Mail,
  Network,
  ShieldCheck,
  UploadCloud,
  Users,
  type LucideIcon,
} from "lucide-react";

const CATEGORY_ICONS: Record<PlatformFeatureCategoryId, LucideIcon> = {
  ingestion: UploadCloud,
  apis: BookOpen,
  security: ShieldCheck,
  lineage: Network,
  workspace: Users,
};

const FEATURE_ICONS: Partial<Record<string, LucideIcon>> = {
  "pdf-parser": FileScan,
  "email-ingest": Mail,
  connectors: Cable,
  "lineage-graph": GitBranch,
  "lineage-api": Network,
  alerts: Bell,
  "portal-ip-allowlist": Globe,
  "storage-meter": HardDrive,
  "api-keys": KeyRound,
};

function FeatureIcon({ featureId, category }: { featureId: string; category: PlatformFeatureCategoryId }) {
  const Icon = FEATURE_ICONS[featureId] ?? CATEGORY_ICONS[category];
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/20">
      <Icon className="h-4 w-4 text-primary" />
    </div>
  );
}

const SPOTLIGHT_ICONS = {
  lineage: Network,
  "email-ingest": Mail,
} as const;

function FeatureSpotlightSection({
  spotlight,
}: {
  spotlight: (typeof FEATURE_SPOTLIGHTS)[number];
}) {
  const Icon = SPOTLIGHT_ICONS[spotlight.id];
  return (
    <section
      id={spotlight.id === "lineage" ? "lineage-deep-dive" : "email-ingest-deep-dive"}
      className="scroll-mt-24 rounded-2xl border border-primary/25 bg-card/70 p-4 backdrop-blur-sm sm:p-8"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-display text-xl font-bold sm:text-2xl">{spotlight.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {spotlight.description}
          </p>
        </div>
      </div>
      <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {spotlight.steps.map((s) => (
          <li key={s.step} className="rounded-lg border border-border/70 bg-background/50 p-4">
            <span className="text-xs font-semibold text-primary">Step {s.step}</span>
            <h3 className="mt-1 text-sm font-semibold">{s.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted-foreground">
        {spotlight.footerNote}{" "}
        <a
          href={`#${spotlight.categoryAnchor}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          {spotlight.categoryLinkLabel} →
        </a>
      </p>
    </section>
  );
}

export function PlatformFeaturesPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicSiteHeader trailing={<PublicMarketingNav />} />

      <main className="relative flex-1">
        <div className="grid-bg absolute inset-0 opacity-20" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-14">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-primary">Platform capabilities</p>
            <h1 className="font-display mt-2 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Everything Gridwire ships today
            </h1>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              Self-hostable spreadsheet-to-API platform with governed ingest, field-level security,
              interactive lineage, and a full admin console — no proprietary cloud lock-in.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button size="lg" className="w-full shadow-lg shadow-primary/20 sm:w-auto" asChild>
                <Link to="/auth">
                  Try the demo <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="w-full bg-background/60 sm:w-auto" asChild>
                <Link to="/">Back to home</Link>
              </Button>
            </div>
          </div>

          <nav
            className="-mx-4 mt-10 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
            aria-label="Feature categories"
          >
            {PLATFORM_FEATURE_CATEGORIES.map((cat) => {
              const Icon = CATEGORY_ICONS[cat.id];
              return (
                <a
                  key={cat.id}
                  href={`#${cat.id}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/80 bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {cat.title}
                </a>
              );
            })}
          </nav>

          <div className="mt-12">
            <TrustBoundarySection />
          </div>

          <div className="mt-12 space-y-10">
            {FEATURE_SPOTLIGHTS.map((spotlight) => (
              <FeatureSpotlightSection key={spotlight.id} spotlight={spotlight} />
            ))}
          </div>

          <div className="mt-14 space-y-14">
            {PLATFORM_FEATURE_CATEGORIES.map((category) => {
              const items = PLATFORM_FEATURES.filter((f) => f.category === category.id);
              const Icon = CATEGORY_ICONS[category.id];
              return (
                <section key={category.id} id={category.id} className="scroll-mt-24">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="font-display text-xl font-bold sm:text-2xl">{category.title}</h2>
                      <p className="mt-1 max-w-2xl text-sm text-muted-foreground sm:text-base">
                        {category.description}
                      </p>
                    </div>
                  </div>

                  <ul className="mt-6 grid gap-4 sm:grid-cols-2">
                    {items.map((feature) => (
                      <li
                        key={feature.id}
                        className={cn(
                          "rounded-xl border border-border/80 bg-card/70 p-4 backdrop-blur-sm",
                          feature.category === "lineage" && "border-primary/25",
                        )}
                      >
                        <div className="flex gap-3">
                          <FeatureIcon featureId={feature.id} category={feature.category} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-semibold sm:text-base">{feature.title}</h3>
                              {feature.badge === "new" && (
                                <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                                  New
                                </Badge>
                              )}
                              {feature.badge === "upcoming" && (
                                <Badge
                                  variant="outline"
                                  className="border-primary/40 bg-primary/10 text-[10px] uppercase tracking-wide text-primary"
                                >
                                  Upcoming
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                              {feature.description}
                            </p>
                            {feature.bullets && feature.bullets.length > 0 && (
                              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                                {feature.bullets.map((b) => (
                                  <li key={b} className="flex gap-1.5">
                                    <span className="text-primary">·</span>
                                    <span>{b}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          <section className="mt-16 rounded-2xl border border-primary/25 bg-card/80 p-6 text-center sm:p-10">
            <h2 className="font-display text-xl font-bold sm:text-2xl">Ready to publish your first API?</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground sm:text-base">
              Spin up a demo workspace, upload a spreadsheet, explore the lineage graph, and call your
              dataset with a scoped API key.
            </p>
            <Button size="lg" className="mt-6 w-full shadow-lg shadow-primary/20 sm:w-auto" asChild>
              <Link to="/auth">
                Open demo workspace <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </section>
        </div>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
