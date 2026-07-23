import { Link } from "@tanstack/react-router";
import { Menu, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { GRIDWIRE_GITHUB_REPO_URL } from "@/lib/github";

const NAV_LINKS = [
  { to: "/features" as const, label: "Features" },
  { to: "/product-guide" as const, label: "Product guide" },
  { to: "/feedback" as const, label: "Feedback" },
] as const;

export function PublicMarketingNav() {
  return (
    <>
      <div className="hidden items-center gap-1 md:flex md:gap-2">
        {NAV_LINKS.map((link) => (
          <Button key={link.to} variant="ghost" size="sm" asChild>
            <Link to={link.to}>{link.label}</Link>
          </Button>
        ))}
        <Button variant="ghost" size="sm" asChild>
          <a href={GRIDWIRE_GITHUB_REPO_URL} target="_blank" rel="noreferrer">
            <Rocket className="mr-1.5 h-4 w-4" />
            Deploy
          </a>
        </Button>
        <Button variant="outline" size="sm" className="shadow-sm" asChild>
          <Link to="/auth" search={{ mode: "signin" }}>
            Sign in
          </Link>
        </Button>
      </div>

      <Sheet>
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 md:hidden"
            aria-label="Open navigation menu"
          >
            <Menu className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-[min(100vw-2rem,20rem)]">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <nav className="mt-6 flex flex-col gap-2">
            {NAV_LINKS.map((link) => (
              <Button key={link.to} variant="ghost" className="justify-start" asChild>
                <Link to={link.to}>{link.label}</Link>
              </Button>
            ))}
            <Button variant="ghost" className="justify-start" asChild>
              <a href={GRIDWIRE_GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                <Rocket className="mr-2 h-4 w-4" />
                Deploy
              </a>
            </Button>
            <Button variant="outline" className="justify-start" asChild>
              <Link to="/auth" search={{ mode: "signin" }}>
                Sign in
              </Link>
            </Button>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
