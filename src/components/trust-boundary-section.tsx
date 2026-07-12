import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, FileSearch, ListChecks, Mail, ScanLine, Server, type LucideIcon } from "lucide-react";

const TRUST_BOUNDARY_STEPS = [
  { icon: Mail, label: "Email gateway", detail: "Inbound webhook or upload" },
  { icon: ListChecks, label: "Allowlist", detail: "Sender + org policy" },
  { icon: ScanLine, label: "Virus scan", detail: "ClamAV before parse" },
  { icon: FileSearch, label: "Schema match", detail: "Template + drift gate" },
  { icon: Server, label: "Versioned API", detail: "Keys, masking, audit" },
] as const;

function TrustBoundaryFlow() {
  return (
    <div
      className="rounded-2xl border border-border/80 bg-card/60 p-4 backdrop-blur-sm sm:p-6"
      aria-label="Governed ingest data flow"
    >
      <div className="-mx-1 overflow-x-auto px-1 pb-1 sm:overflow-visible sm:pb-0">
        <ol className="flex min-w-[min(100%,40rem)] flex-col gap-2 sm:min-w-0 md:min-w-[36rem] md:flex-row md:items-stretch lg:min-w-0">
          {TRUST_BOUNDARY_STEPS.map((step, index) => {
            const Icon: LucideIcon = step.icon;
            const isLast = index === TRUST_BOUNDARY_STEPS.length - 1;
            return (
              <li
                key={step.label}
                className="flex flex-1 flex-col md:min-w-[9.5rem] md:flex-row md:items-center lg:min-w-0"
              >
                <div className="flex flex-1 items-center gap-3 rounded-xl border border-border/70 bg-background/40 p-3 md:flex-col md:px-2 md:py-4 md:text-center">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/20 md:mx-auto">
                    <Icon className="h-4 w-4 text-primary" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 md:flex-none">
                    <p className="text-sm font-semibold leading-snug">{step.label}</p>
                    <p className="text-xs text-muted-foreground">{step.detail}</p>
                  </div>
                </div>
                {!isLast && (
                  <div
                    className="flex shrink-0 justify-center px-1 py-1 text-muted-foreground/60 md:px-1.5 md:py-0"
                    aria-hidden
                  >
                    <ArrowRight className="h-4 w-4 rotate-90 md:rotate-0" />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

type TrustBoundarySectionProps = {
  showFeatureListLink?: boolean;
};

export function TrustBoundarySection({ showFeatureListLink = true }: TrustBoundarySectionProps) {
  return (
    <section id="trust-boundary" className="scroll-mt-24">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <h2 className="font-display text-xl font-bold sm:text-2xl">Where control sits</h2>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Every path into production data passes the same boundary — on infrastructure you operate.
            ETags, Parquet export, and connectors follow only after ingest clears the gate.
          </p>
        </div>
        {showFeatureListLink && (
          <Button variant="outline" size="sm" className="w-full bg-background/60 sm:w-auto" asChild>
            <a href="#ingestion">Ingestion features</a>
          </Button>
        )}
      </div>
      <TrustBoundaryFlow />
    </section>
  );
}
