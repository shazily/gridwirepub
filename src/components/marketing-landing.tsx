import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { GRIDWIRE_GITHUB_REPO_URL } from "@/lib/github";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-chrome";
import { PublicMarketingNav } from "@/components/public-marketing-nav";
import {
  MARKETING_SLIDESHOW_FEATURE_IDS,
  MARKETING_WHATS_NEW,
  getFeatureById,
} from "@/lib/platform-features";
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
  type LucideIcon,
} from "lucide-react";

type SlideshowFeature = { icon: LucideIcon; title: string; desc: string };

const SLIDESHOW_ICONS: Record<string, LucideIcon> = {
  "field-protection": ShieldCheck,
  "api-keys": KeyRound,
  "multi-tenant": Users,
  "parse-spreadsheets": UploadCloud,
  "versioning-diffs": GitBranch,
  connectors: Cable,
  "openapi-swagger": BookOpen,
  alerts: Bell,
};

function slideshowFeatures(): SlideshowFeature[] {
  return MARKETING_SLIDESHOW_FEATURE_IDS.flatMap((id) => {
    const f = getFeatureById(id);
    if (!f) return [];
    const Icon = SLIDESHOW_ICONS[id] ?? BookOpen;
    return [{ icon: Icon, title: f.title, desc: f.description }];
  });
}

const FEATURES_PER_SLIDE = 3;
const SLIDE_MS = 6000;

function chunkFeatures(items: SlideshowFeature[], size: number): SlideshowFeature[][] {
  const slides: SlideshowFeature[][] = [];
  for (let i = 0; i < items.length; i += size) {
    slides.push(items.slice(i, i + size));
  }
  return slides;
}

function FeatureSlideshow() {
  const features = useMemo(() => slideshowFeatures(), []);
  const slides = useMemo(() => chunkFeatures(features, FEATURES_PER_SLIDE), [features]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

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
      className="relative flex min-h-[360px] flex-col rounded-2xl border border-primary/25 bg-card/80 p-5 shadow-lg shadow-primary/5 backdrop-blur-sm sm:min-h-[400px] sm:p-6"
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
                <h3 className="text-sm font-semibold leading-snug sm:text-base">{feature.title}</h3>
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

      <main className="relative flex flex-1 flex-col overflow-hidden">
        <div className="grid-bg absolute inset-0 opacity-25" />
        <div
          className="pointer-events-none absolute -left-32 top-0 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-24 bottom-0 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
          aria-hidden
        />

        <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pb-6 pt-2 lg:justify-center lg:pb-8 lg:pt-0">
          <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-10">
            <div className="space-y-5 lg:space-y-6">
              <h1 className="font-display text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.25rem]">
                Turn any spreadsheet into a <span className="text-primary">secure production API</span>.
              </h1>

              <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
                Upload spreadsheets or email them to a governed ingest address — into your secured data
                environment, with lineage on every publish.
              </p>

              <div className="flex flex-wrap gap-3">
                <Button size="lg" className="shadow-lg shadow-primary/20" asChild>
                  <Link to="/auth">
                    Create your demo workspace <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="bg-background/60" asChild>
                  <Link to="/features">Explore all features</Link>
                </Button>
              </div>

              <div className="rounded-xl border border-primary/20 bg-card/70 p-5 shadow-sm backdrop-blur-sm sm:p-6">
                <h2 className="font-display text-xl font-bold sm:text-2xl">
                  Deploy it for your org.
                </h2>
                <p className="mt-2 max-w-lg text-sm text-muted-foreground sm:text-base">
                  Self-host on infrastructure you control — with row-level isolation, hashed API keys,
                  field-level masking, lineage access, and full audit trails so teams can publish data APIs without
                  giving up security.
                </p>
                <Button size="lg" variant="outline" className="mt-4 bg-background/60" asChild>
                  <a href={GRIDWIRE_GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                    <Github className="h-4 w-4" /> Get the Repo
                  </a>
                </Button>
              </div>
            </div>

            <FeatureSlideshow />
          </div>

          <section className="relative mt-10 border-t border-border/60 pt-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-bold sm:text-2xl">What&apos;s new</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Recent platform updates — also covered in Help &amp; FAQ after you sign in.
                </p>
              </div>
              <Button variant="outline" size="sm" className="bg-background/60" asChild>
                <Link to="/features">Full feature list</Link>
              </Button>
            </div>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2">
              {MARKETING_WHATS_NEW.map((item) => (
                <li
                  key={item.title}
                  className="rounded-xl border border-border/80 bg-card/60 p-4 backdrop-blur-sm"
                >
                  <h3 className="text-sm font-semibold">{item.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                    {item.desc}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
