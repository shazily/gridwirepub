import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand";
import { showMarketingLanding } from "@/lib/deployment";

export function LinkedInBrandIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
      />
    </svg>
  );
}

type PublicSiteHeaderProps = {
  homeTo?: string;
  homeParams?: Record<string, string>;
  trailing?: ReactNode;
};

export function PublicSiteHeader({ homeTo = "/", homeParams, trailing }: PublicSiteHeaderProps) {
  return (
    <header className="mx-auto flex w-full max-w-6xl shrink-0 items-center justify-between border-b border-border/50 px-6 py-4">
      <Link to={homeTo} params={homeParams} className="rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <Wordmark />
      </Link>
      {trailing}
    </header>
  );
}

export function PublicSiteFooter() {
  return (
    <footer className="shrink-0 border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:text-sm">
        <Wordmark />
        <div className="flex flex-col gap-2 sm:items-end">
          <span>© {new Date().getFullYear()} Gridwire — MIT licensed</span>
          {showMarketingLanding && (
            <span className="flex items-center gap-2">
              Created by Shazily Munawar
              <a
                href="https://www.linkedin.com/in/shazilymunawar/"
                target="_blank"
                rel="noreferrer noopener"
                aria-label="Shazily Munawar on LinkedIn"
                className="inline-flex rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
              >
                <LinkedInBrandIcon className="h-4 w-4" />
              </a>
            </span>
          )}
        </div>
      </div>
    </footer>
  );
}
