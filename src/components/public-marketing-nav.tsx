import { Link } from "@tanstack/react-router";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GRIDWIRE_GITHUB_REPO_URL } from "@/lib/github";

export function PublicMarketingNav() {
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/features">Features</Link>
      </Button>
      <Button variant="ghost" size="sm" asChild>
        <Link to="/feedback">Feedback</Link>
      </Button>
      <Button variant="ghost" size="sm" asChild>
        <a href={GRIDWIRE_GITHUB_REPO_URL} target="_blank" rel="noreferrer">
          <Github className="mr-1.5 h-4 w-4" />
          GitHub
        </a>
      </Button>
      <Button variant="outline" size="sm" className="bg-background/80 shadow-sm" asChild>
        <Link to="/auth">Demo sign-in</Link>
      </Button>
    </div>
  );
}
