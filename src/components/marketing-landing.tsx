import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GRIDWIRE_GITHUB_REPO_URL } from "@/lib/github";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-chrome";
import { PublicMarketingNav } from "@/components/public-marketing-nav";
import { MARKETING_SLIDESHOW_FEATURE_IDS, getFeatureById } from "@/lib/platform-features";
import { cn } from "@/lib/utils";
import {
  UploadCloud,
  GitBranch,
  ShieldCheck,
  KeyRound,
  Cable,
  Users,
  ArrowRight,
  Github,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Bell,
  Mail,
  FileScan,
  type LucideIcon,
} from "lucide-react";

type SlideshowFeature = { icon: LucideIcon; title: string; desc: string; badge?: "new" | "upcoming" };

const SLIDESHOW_ICONS: Record<string, LucideIcon> = {
  "field-protection": ShieldCheck,
  "api-keys": KeyRound,
  "multi-tenant": Users,
  "parse-spreadsheets": UploadCloud,
  "pdf-parser": FileScan,
  "versioning-diffs": GitBranch,
  connectors: Cable,
  "openapi-swagger": BookOpen,
  alerts: Bell,
};

const INGEST_PATH_STEPS = [
  {
    icon: UploadCloud,
    title: "Upload once",
    description: "Drop Excel, CSV, or PDFs into your governed environment.",
  },
  {
    icon: FileScan,
    title: "PDF structure → data",
    description:
      "Map tables first on a cheap pass, approve the layout, then load full rows — not a blind full-document scrape.",
  },
  {
    icon: Mail,
    title: "Email ingest",
    description:
      "Trusted teams send files to a governed address — data reaches your warehouse instead of dying in someone's inbox.",
  },
  {
    icon: ShieldCheck,
    title: "Per-column protection",
    description:
      "Clear, mask, hash (SHA-256/512, SHA3, HMAC), or AES-256-GCM encrypt — enforced on every API response.",
    emphasized: true,
  },
] as const;

const WORKFLOW_TOOL_NAMES = ["Retool", "n8n", "Zapier"] as const;

type MarketingPanelProps = {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  className?: string;
};

function MarketingPanel({ icon: Icon, title, children, className }: MarketingPanelProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/80 bg-card/60 p-4 backdrop-blur-sm sm:p-5",
        className,
      )}
    >
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/20">
          <Icon className="h-5 w-5 text-primary" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground sm:text-base">{title}</p>
          <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  );
}

function GovernedIngestBanner() {
  return (
    <div className="flex w-full items-center gap-2.5 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 sm:inline-flex sm:w-auto sm:rounded-full sm:py-2.5">
      <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      <p className="text-sm font-semibold leading-snug text-foreground sm:text-base">
        Governed ingest to <span className="text-primary">versioned APIs</span> — on{" "}
        <span className="text-primary">your boundary</span>.
      </p>
    </div>
  );
}

function HeroMarketingCopy() {
  return (
    <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
      <span className="text-foreground font-medium">Upload Excel, CSV, or PDFs</span> — including{" "}
      <span className="text-foreground font-medium">AI PDF table parsing</span>. Or let trusted teams{" "}
      <span className="text-foreground font-medium">email files to a governed ingest address</span> so data
      reaches your <span className="text-foreground font-medium">warehouse</span> instead of dying in
      someone&apos;s inbox. Every publish builds a{" "}
      <span className="text-foreground font-medium">versioned API</span> with{" "}
      <span className="text-foreground font-medium">lineage you can audit</span>.
    </p>
  );
}

function IngestPathPanel() {
  return (
    <div className="w-full rounded-xl border border-border/80 bg-card/60 p-4 backdrop-blur-sm sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        From inbox to warehouse
      </p>
      <ul className="mt-3 space-y-3">
        {INGEST_PATH_STEPS.map((step) => {
          const Icon = step.icon;
          const emphasized = "emphasized" in step && step.emphasized;
          return (
            <li
              key={step.title}
              className={cn(
                "flex gap-3 rounded-lg border p-3",
                emphasized
                  ? "border-primary/30 bg-primary/5"
                  : "border-border/60 bg-background/40",
              )}
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                  emphasized ? "bg-primary/15 ring-1 ring-primary/20" : "bg-primary/10",
                )}
              >
                <Icon className="h-4 w-4 text-primary" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                  {emphasized ? (
                    <>
                      Clear, mask, hash{" "}
                      <span className="text-foreground font-medium">(SHA-256/512, SHA3, HMAC)</span>, or{" "}
                      <span className="text-foreground font-medium">AES-256-GCM</span> encrypt — enforced on{" "}
                      <span className="text-foreground font-medium">every API response</span>.
                    </>
                  ) : (
                    step.description
                  )}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AudiencePanel() {
  return (
    <MarketingPanel icon={Users} title="Who it's for">
      <span className="text-foreground font-medium">Integration and platform teams</span> who need a{" "}
      <span className="text-foreground font-medium">governed path</span> for the data business users
      already move by hand.
    </MarketingPanel>
  );
}

function DifferentiationPanel() {
  return (
    <div className="w-full rounded-xl border border-border/80 bg-card/60 p-4 backdrop-blur-sm sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Why not another workflow tool?
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {WORKFLOW_TOOL_NAMES.map((name) => (
          <Badge
            key={name}
            variant="outline"
            className="border-border/80 bg-background/50 font-normal text-muted-foreground line-through decoration-muted-foreground/50"
          >
            {name}
          </Badge>
        ))}
        <Badge className="border-transparent shadow-none">Gridwire</Badge>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Treats{" "}
        <span className="text-foreground font-medium">governed ingest, lineage, and field-level crypto</span>{" "}
        as <span className="font-medium text-primary">first-class primitives</span> — not workflow add-ons
        bolted onto a general automation tool.
      </p>
    </div>
  );
}

function NewAiPdfParsingPanel() {
  return (
    <div className="w-full rounded-xl border border-primary/30 bg-primary/5 p-4 backdrop-blur-sm sm:p-5">
      <div className="flex gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/25">
          <FileScan className="h-5 w-5 text-primary" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground sm:text-base">AI PDF table parsing</p>
            <Badge className="border-transparent text-[10px] uppercase tracking-wide shadow-none">
              New
            </Badge>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Map tables from a cheap structure pass, approve the layout, then load full rows — with reusable
            templates for recurring SFTP and folder PDFs. Same allowlist, ClamAV, lineage, and field
            protection as spreadsheet ingest.
          </p>
        </div>
      </div>
    </div>
  );
}

function slideshowFeatures(): SlideshowFeature[] {
  return MARKETING_SLIDESHOW_FEATURE_IDS.flatMap((id) => {
    const f = getFeatureById(id);
    if (!f) return [];
    const Icon = SLIDESHOW_ICONS[id] ?? BookOpen;
    return [{ icon: Icon, title: f.title, desc: f.description, badge: f.badge }];
  });
}

const SLIDE_MS = 6000;

function useSlideChunkSize(): number {
  const [size, setSize] = useState(1);

  useEffect(() => {
    const update = () => {
      const width = window.innerWidth;
      if (width >= 1024) setSize(3);
      else if (width >= 640) setSize(2);
      else setSize(1);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return size;
}

function chunkFeatures(items: SlideshowFeature[], size: number): SlideshowFeature[][] {
  const slides: SlideshowFeature[][] = [];
  for (let i = 0; i < items.length; i += size) {
    slides.push(items.slice(i, i + size));
  }
  return slides;
}

function FeatureSlideshow() {
  const features = useMemo(() => slideshowFeatures(), []);
  const chunkSize = useSlideChunkSize();
  const slides = useMemo(() => chunkFeatures(features, chunkSize), [features, chunkSize]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setIndex(0);
  }, [chunkSize]);

  const go = useCallback(
    (next: number) => {
      setIndex((next + slides.length) % slides.length);
    },
    [slides.length],
  );

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, SLIDE_MS);
    return () => window.clearInterval(id);
  }, [paused, slides.length]);

  const slide = slides[index];

  return (
    <div
      className="relative flex min-h-[280px] flex-col rounded-2xl border border-primary/25 bg-card/80 p-4 shadow-lg shadow-primary/5 backdrop-blur-sm sm:min-h-[340px] sm:p-5 lg:min-h-[400px] lg:p-6"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">Key features</p>
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Show slide ${i + 1}`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => go(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/35 hover:bg-muted-foreground/55",
                )}
              />
            ))}
          </div>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Previous slide"
              onClick={() => go(index - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Next slide"
              onClick={() => go(index + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div key={index} className="grid flex-1 gap-3 animate-in fade-in slide-in-from-right-3 duration-300">
        {slide.map((feature) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.title}
              className="flex gap-3 rounded-xl border border-border/70 bg-background/40 p-3 sm:p-4"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/20">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold leading-snug sm:text-base">{feature.title}</h3>
                  {feature.badge === "upcoming" && (
                    <Badge
                      variant="outline"
                      className="border-primary/40 bg-primary/10 text-[10px] uppercase tracking-wide text-primary"
                    >
                      Upcoming
                    </Badge>
                  )}
                  {feature.badge === "new" && (
                    <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                      New
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                  {feature.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Slide {index + 1} / {slides.length} ·{" "}
        <Link to="/features" className="text-primary underline-offset-4 hover:underline">
          See all features
        </Link>
      </p>
    </div>
  );
}

export function MarketingLandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicSiteHeader trailing={<PublicMarketingNav />} />

      <main className="relative flex flex-1 flex-col overflow-x-hidden">
        <div className="grid-bg absolute inset-0 opacity-25" />
        <div
          className="pointer-events-none absolute -left-32 top-0 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-24 bottom-0 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
          aria-hidden
        />

        <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-8 pt-3 sm:px-6 sm:pb-10 lg:justify-center lg:pb-12 lg:pt-6">
          <div className="space-y-5 sm:space-y-6 lg:max-w-3xl">
            <h1 className="font-display text-3xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-[3.25rem]">
              Turn spreadsheets and PDFs into a{" "}
              <span className="text-primary">secure production API</span>.
            </h1>

            <GovernedIngestBanner />

            <HeroMarketingCopy />

            <IngestPathPanel />
            <NewAiPdfParsingPanel />
            <AudiencePanel />
            <DifferentiationPanel />

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button size="lg" className="w-full shadow-lg shadow-primary/20 sm:w-auto" asChild>
                <Link to="/auth">
                  Create your demo workspace <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="w-full bg-background/60 sm:w-auto" asChild>
                <Link to="/features">Explore all features</Link>
              </Button>
            </div>

            <div className="rounded-xl border border-primary/20 bg-card/70 p-4 shadow-sm backdrop-blur-sm sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-lg font-bold sm:text-2xl">Deploy for your org</h2>
                <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  MIT license · Self-hostable
                </span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Postgres, auth, storage, and workers on infrastructure you control —{" "}
                <span className="text-foreground font-medium">row-level isolation</span>,{" "}
                <span className="text-foreground font-medium">hashed API keys</span>, field masking, and{" "}
                <span className="text-foreground font-medium">full audit trails</span>.
              </p>
              <Button size="lg" variant="outline" className="mt-4 w-full bg-background/60 sm:w-auto" asChild>
                <a href={GRIDWIRE_GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                  <Github className="h-4 w-4" /> Get the Repo
                </a>
              </Button>
            </div>
          </div>

          <div className="mt-10 border-t border-border/60 pt-8 sm:mt-12">
            <FeatureSlideshow />
          </div>
        </div>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
