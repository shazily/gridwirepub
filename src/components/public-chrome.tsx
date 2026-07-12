import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand";

type PublicSiteHeaderProps = {
  homeTo?: string;
  homeParams?: Record<string, string>;
  trailing?: ReactNode;
};

export function PublicSiteHeader({ homeTo = "/", homeParams, trailing }: PublicSiteHeaderProps) {
  return (
    <header className="mx-auto flex w-full max-w-6xl shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4 py-3 sm:px-6 sm:py-4">
      <Link
        to={homeTo}
        params={homeParams}
        className="min-w-0 shrink rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Wordmark />
      </Link>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </header>
  );
}

export function PublicSiteFooter() {
  return (
    <footer className="shrink-0 border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:text-sm">
        <Wordmark />
        <span>© {new Date().getFullYear()} Gridwire — MIT licensed</span>
      </div>
    </footer>
  );
}
