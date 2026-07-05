import { Link } from "@tanstack/react-router";
import { ArrowLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Crumb = { label: string; to?: string };

type PageNavProps = {
  backTo?: string;
  backLabel?: string;
  homeTo?: string;
  crumbs?: Crumb[];
  className?: string;
};

/** Consistent back / home / breadcrumb bar for nested pages. */
export function PageNav({
  backTo = "/dashboard",
  backLabel = "Back",
  homeTo = "/dashboard",
  crumbs,
  className,
}: PageNavProps) {
  return (
    <nav
      className={cn("mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground", className)}
      aria-label="Page navigation"
    >
      <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" asChild>
        <Link to={backTo}>
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </Link>
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" asChild aria-label="Home">
        <Link to={homeTo}>
          <Home className="h-3.5 w-3.5" />
        </Link>
      </Button>
      {crumbs && crumbs.length > 0 && (
        <ol className="flex flex-wrap items-center gap-1">
          {crumbs.map((c, i) => (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1">
              <span aria-hidden className="text-border">
                /
              </span>
              {c.to ? (
                <Link to={c.to} className="hover:text-foreground">
                  {c.label}
                </Link>
              ) : (
                <span className="text-foreground">{c.label}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}
