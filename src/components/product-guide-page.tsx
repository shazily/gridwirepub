import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-chrome";
import { PublicMarketingNav } from "@/components/public-marketing-nav";
import { showMarketingLanding } from "@/lib/deployment";
import {
  ADMIN_SHOTS,
  ARCHITECTURE_LAYERS,
  CHANGE_CONTROL,
  DEPLOY_STEPS,
  FEATURE_SHOTS,
  GUIDE_TOC,
  INFOSEC_QA,
  LIMITATIONS,
  PRODUCT_GUIDE_META,
} from "@/lib/product-guide-content";
import { Printer } from "lucide-react";

function Shot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="break-inside-avoid overflow-hidden rounded-xl border border-border bg-card">
      <img
        src={src}
        alt={alt}
        className="w-full border-b border-border bg-muted/30 object-contain object-top"
        loading="lazy"
      />
      <figcaption className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

export function ProductGuidePage() {
  return (
    <div className="product-guide flex min-h-screen flex-col bg-background text-foreground">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .product-guide { background: white; }
          a[href]::after { content: none !important; }
          .print-break { break-before: page; }
          img { max-height: 70vh; object-fit: contain; }
        }
      `}</style>

      <div className="no-print">
        <PublicSiteHeader
          trailing={showMarketingLanding ? <PublicMarketingNav /> : undefined}
        />
      </div>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <header className="border-b border-border pb-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Product documentation · v{PRODUCT_GUIDE_META.version} · {PRODUCT_GUIDE_META.date}
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {PRODUCT_GUIDE_META.title}
          </h1>
          <p className="mt-2 text-base text-muted-foreground">{PRODUCT_GUIDE_META.subtitle}</p>
          <p className="mt-3 text-xs text-muted-foreground">{PRODUCT_GUIDE_META.classification}</p>
          <div className="no-print mt-6 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => window.print()}
            >
              <Printer className="mr-2 h-4 w-4" />
              Print / Save as PDF
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/features">Features page</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/auth" search={{ mode: "signin" }}>
                Sign in
              </Link>
            </Button>
          </div>
        </header>

        <aside className="mt-8 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Honesty statement. </strong>
          {PRODUCT_GUIDE_META.honesty}
        </aside>

        <nav className="mt-8 rounded-xl border border-border bg-card/50 p-4" aria-label="Table of contents">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contents</p>
          <ol className="mt-3 space-y-1.5 text-sm">
            {GUIDE_TOC.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`} className="text-primary hover:underline">
                  {t.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <section id="executive" className="mt-12 scroll-mt-24 space-y-3">
          <h2 className="text-xl font-bold tracking-tight">1. Executive summary</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Gridwire is an open-source, self-hostable portal that turns Excel, CSV, and PDF tabular data into
            versioned REST APIs with field-level protection, API keys, audit events, multi-workspace tenancy,
            and optional connectors / email ingest. It is designed for on-prem and customer-controlled
            infrastructure (Docker Compose). It is not a general data warehouse, BI tool, or fully turnkey SSO
            appliance without operator IdP configuration.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Default local portal URL after on-prem deploy: <code className="text-xs">http://127.0.0.1:3020</code>.
            API gateway (Kong): <code className="text-xs">http://127.0.0.1:3040</code>.
          </p>
        </section>

        <section id="scope" className="mt-12 scroll-mt-24 space-y-3">
          <h2 className="text-xl font-bold tracking-tight">2. Scope and honesty</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Screenshots in this guide were captured from a live Gridwire portal instance.</li>
            <li>
              In-app Help (<code className="text-xs">/help</code>) and this guide both call out stubs; if they
              conflict with a sales one-pager, prefer the code and this document.
            </li>
            <li>
              “Configured” in Authentication means fields were saved — not that an IdP login round-trip was
              proven.
            </li>
          </ul>
        </section>

        <section id="architecture" className="print-break mt-12 scroll-mt-24 space-y-4">
          <h2 className="text-xl font-bold tracking-tight">3. Architecture</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            On-prem stack services (from <code className="text-xs">docker-compose.onprem.yml</code>): Postgres,
            GoTrue (auth), PostgREST, Kong, Portal, MinIO, Worker, ClamAV.
          </p>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Layer</th>
                  <th className="px-3 py-2 font-medium">Components</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                </tr>
              </thead>
              <tbody>
                {ARCHITECTURE_LAYERS.map((row) => (
                  <tr key={row.layer} className="border-b border-border/70 align-top">
                    <td className="px-3 py-2 font-medium">{row.layer}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.components}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-border bg-card/40 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
            <p className="mb-2 font-sans text-xs font-semibold uppercase tracking-wide text-foreground">
              Data flow (implemented)
            </p>
            <pre className="whitespace-pre-wrap">{`Upload / connector / email
  → parse (spreadsheet.ts / PDF pipeline)
  → publish.server.ts (rows + MinIO + Parquet snapshot)
  → Postgres dataset_versions / dataset_fields / dataset_rows
  → /api/v1/datasets/:id/:sheet (api-serve.server.ts)
       auth → load → mask/hash/encrypt view → ETag → audit/consumption`}</pre>
          </div>

          <p className="text-sm text-muted-foreground">
            Trust boundary for portal IP allowlisting applies to branded{" "}
            <code className="text-xs">/portal/{"{slug}"}</code> and its public branding API — not to every
            authenticated dashboard route.
          </p>
        </section>

        <section id="features" className="print-break mt-12 scroll-mt-24 space-y-6">
          <h2 className="text-xl font-bold tracking-tight">4. Feature tour</h2>
          <p className="text-sm text-muted-foreground">
            Core publisher journey: create/join workspace → upload or connect data → map fields and protection →
            publish version → issue API keys → consumers call versioned REST with optional ETag polling.
          </p>
          <div className="grid gap-6">
            {FEATURE_SHOTS.map((s) => (
              <Shot key={s.src} {...s} />
            ))}
          </div>
          <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Also in the authenticated shell</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Storage usage vs quota (<code className="text-xs">/storage</code>)</li>
              <li>Workspace notifications (<code className="text-xs">/notifications</code>)</li>
              <li>Settings — profile, password, TOTP enroll, org rename for admins</li>
              <li>App feedback (<code className="text-xs">/app-feedback</code>)</li>
              <li>Onboarding — join by org UUID, invite link, or create first workspace</li>
            </ul>
          </div>
        </section>

        <section id="admin" className="print-break mt-12 scroll-mt-24 space-y-6">
          <h2 className="text-xl font-bold tracking-tight">5. Admin control plane</h2>
          <p className="text-sm text-muted-foreground">
            Visible to organization <strong className="text-foreground">owner</strong> and{" "}
            <strong className="text-foreground">admin</strong> roles only (
            <code className="text-xs">canManage</code>). Use this plane to govern access, auth policy storage,
            quotas, keys, connectors, ingest, and audit.
          </p>
          <div className="grid gap-6">
            {ADMIN_SHOTS.map((s) => (
              <Shot key={s.src} {...s} />
            ))}
          </div>
        </section>

        <section id="deploy" className="print-break mt-12 scroll-mt-24 space-y-4">
          <h2 className="text-xl font-bold tracking-tight">6. Deploy, configure, test</h2>
          <ol className="space-y-4">
            {DEPLOY_STEPS.map((step, i) => (
              <li key={step.title} className="rounded-xl border border-border p-4">
                <p className="text-sm font-semibold">
                  {i + 1}. {step.title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted-foreground">
            Reference scripts: <code className="text-xs">scripts/deploy.ps1</code>,{" "}
            <code className="text-xs">scripts/deploy.sh</code>,{" "}
            <code className="text-xs">scripts/apply-migrations.ps1</code>,{" "}
            <code className="text-xs">scripts/smoke-test.ps1</code>,{" "}
            <code className="text-xs">.env.example</code>.
          </p>
        </section>

        <section id="infosec" className="print-break mt-12 scroll-mt-24 space-y-4">
          <h2 className="text-xl font-bold tracking-tight">7. InfoSec / CRO questionnaire</h2>
          <p className="text-sm text-muted-foreground">
            Answers are intentionally precise. Gaps are stated as gaps — not as roadmap promises.
          </p>
          <dl className="space-y-4">
            {INFOSEC_QA.map((item) => (
              <div key={item.q} className="break-inside-avoid rounded-xl border border-border p-4">
                <dt className="text-sm font-semibold">{item.q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="change" className="print-break mt-12 scroll-mt-24 space-y-4">
          <h2 className="text-xl font-bold tracking-tight">8. What can and cannot change</h2>
          {CHANGE_CONTROL.map((row) => (
            <div key={row.can} className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Operators / admins can
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{row.can}</p>
              </div>
              <div className="rounded-xl border border-border p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Platform invariants / not available via UI
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{row.cannot}</p>
              </div>
            </div>
          ))}
        </section>

        <section id="limitations" className="mt-12 scroll-mt-24 space-y-3 pb-16">
          <h2 className="text-xl font-bold tracking-tight">9. Known limitations</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            {LIMITATIONS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="pt-6 text-xs text-muted-foreground">
            End of guide · Gridwire Product &amp; Security Guide v{PRODUCT_GUIDE_META.version} · Screenshots under{" "}
            <code>/product-guide/</code> · Print this page to PDF from your browser.
          </p>
        </section>
      </main>

      <div className="no-print">
        <PublicSiteFooter />
      </div>
    </div>
  );
}
