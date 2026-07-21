import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { useOrg } from "@/hooks/use-org";
import { clearWelcomeCompleted } from "@/lib/welcome-tour";
import { HELP_ARTICLES, HELP_FAQS, searchHelp } from "@/lib/help-manual";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  MessageSquarePlus,
  ShieldCheck,
  Sparkles,
  Search,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_dash/help")({
  component: HelpPage,
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
});

function HelpPage() {
  const navigate = useNavigate();
  const { currentOrg } = useOrg();
  const { q: qFromUrl } = Route.useSearch();
  const [query, setQuery] = useState(qFromUrl ?? "");

  const { articles, faqs } = useMemo(() => searchHelp(query), [query]);

  const categories = useMemo(() => {
    const set = new Set(articles.map((a) => a.category));
    return [...set];
  }, [articles]);

  const replayWelcomeTour = () => {
    if (currentOrg?.id) clearWelcomeCompleted(currentOrg.id);
    void navigate({ to: "/dashboard" });
  };

  return (
    <div className="w-full max-w-6xl">
      <PageHeader
        title="Help & manual"
        description="Searchable guides for email, alerts, admin options, and workspace features — based on what is actually implemented."
        backTo="/dashboard"
        backLabel="Dashboard"
        crumbs={[{ label: "Help" }]}
      />

      <div className="mb-6">
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help — e.g. password reset, Postmark, alerts, SMTP, connectors…"
            aria-label="Search help"
          />
        </div>
        {query.trim() && (
          <p className="mt-2 text-xs text-muted-foreground">
            {articles.length} article{articles.length === 1 ? "" : "s"}, {faqs.length} FAQ
            {faqs.length === 1 ? "" : "s"} match “{query.trim()}”.
          </p>
        )}
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Platform tour</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-3">
              Guided overlay for workspace owners: account vs workspaces, admin console, and authentication layers.
            </CardDescription>
            <Button size="sm" variant="outline" type="button" onClick={replayWelcomeTour}>
              Replay welcome tour
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">API documentation</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-3">
              Endpoints, auth, ETag polling, cURL and Postman collection.
            </CardDescription>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/api-docs">Open API Docs</Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="sm:col-span-2 lg:col-span-1">
          <CardHeader className="flex flex-row items-center gap-2">
            <MessageSquarePlus className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Need something else?</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription className="mb-3">
              Send feedback, a bug report, or a feature request.
            </CardDescription>
            <Button asChild size="sm" variant="outline">
              <Link to="/app-feedback">Send feedback</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Topic menu: horizontal scroll on small screens, sticky sidebar on desktop */}
        <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-56">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Topics
          </p>
          <nav
            className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
            aria-label="Help topics"
          >
            {!query.trim() &&
              HELP_ARTICLES.map((a) => (
                <a
                  key={a.id}
                  href={`#${a.id}`}
                  className={cn(
                    "flex shrink-0 items-center rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors",
                    "hover:bg-accent/40 hover:text-foreground",
                  )}
                >
                  {a.title}
                </a>
              ))}
            {query.trim() &&
              articles.map((a) => (
                <a
                  key={a.id}
                  href={`#${a.id}`}
                  className={cn(
                    "flex shrink-0 items-center rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors",
                    "hover:bg-accent/40 hover:text-foreground",
                  )}
                >
                  {a.title}
                </a>
              ))}
            <a
              href="#faqs"
              className="flex shrink-0 items-center rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              FAQs
            </a>
          </nav>
        </aside>

        <div className="min-w-0 flex-1 space-y-8">
          <Card id="admin-manual">
            <CardHeader>
              <CardTitle className="text-base">User manual</CardTitle>
              <CardDescription>
                Jump to a topic from the menu, or use search above. Look for the ? icon on admin pages
                for inline tips that link here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-10">
              {articles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No articles match that search.</p>
              ) : (
                categories.map((category) => (
                  <div key={category}>
                    <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {category}
                    </h2>
                    <div className="space-y-8">
                      {articles
                        .filter((a) => a.category === category)
                        .map((section) => (
                          <section key={section.id} id={section.id} className="scroll-mt-24">
                            <h3 className="mb-2 text-sm font-semibold">{section.title}</h3>
                            <div className="space-y-2 text-sm text-muted-foreground">
                              {section.paragraphs.map((p, i) => (
                                <p key={i}>{p}</p>
                              ))}
                            </div>
                            {section.bullets && section.bullets.length > 0 && (
                              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                                {section.bullets.map((line, i) => (
                                  <li key={i}>{line}</li>
                                ))}
                              </ul>
                            )}
                            {section.caveats && section.caveats.length > 0 && (
                              <div className="mt-3 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                                {section.caveats.map((c, i) => (
                                  <p key={i} className="flex gap-2 text-muted-foreground">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                                    <span>{c}</span>
                                  </p>
                                ))}
                              </div>
                            )}
                            {section.links && section.links.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {section.links.map((l) => (
                                  <Button key={l.to} asChild size="sm" variant="outline">
                                    <Link to={l.to}>{l.label}</Link>
                                  </Button>
                                ))}
                              </div>
                            )}
                          </section>
                        ))}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card id="faqs">
            <CardHeader className="flex flex-row items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Frequently asked questions</CardTitle>
              {query.trim() && <Badge variant="secondary">{faqs.length}</Badge>}
            </CardHeader>
            <CardContent>
              {faqs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No FAQs match that search.</p>
              ) : (
                <Accordion type="single" collapsible className="w-full">
                  {faqs.map((f, i) => (
                    <AccordionItem key={i} value={`item-${i}`}>
                      <AccordionTrigger className="text-left text-sm">{f.q}</AccordionTrigger>
                      <AccordionContent className="text-sm text-muted-foreground">{f.a}</AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
