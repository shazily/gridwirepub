import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Container,
  Loader2,
  Server,
  ShieldCheck,
  Upload,
} from "lucide-react";

type HealthResponse = { status?: string };
type ReadyResponse = { status?: string; checks?: Record<string, unknown> };

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/public/health");
  if (!res.ok) throw new Error("Health check failed");
  return res.json() as Promise<HealthResponse>;
}

async function fetchReady(): Promise<ReadyResponse> {
  const res = await fetch("/api/public/ready");
  if (!res.ok) throw new Error("Readiness check failed");
  return res.json() as Promise<ReadyResponse>;
}

const setupSteps = [
  {
    icon: Server,
    title: "Portal is running",
    desc: "You are connected to this Gridwire instance. All data stays on infrastructure you control.",
  },
  {
    icon: Building2,
    title: "Sign in and join (or create)",
    desc: "Create an account, then join with your organization UUID or a join link — or create the first workspace if you are the instance admin.",
  },
  {
    icon: Upload,
    title: "Upload and publish",
    desc: "Import Excel or CSV, map fields in the wizard, and publish a versioned REST API for your data.",
  },
  {
    icon: ShieldCheck,
    title: "Govern access",
    desc: "Assign roles, issue scoped API keys, and enforce masking or hashing on sensitive fields at serve time.",
  },
];

export function SetupLandingPage() {
  const health = useQuery({ queryKey: ["setup-health"], queryFn: fetchHealth, retry: 1 });
  const ready = useQuery({ queryKey: ["setup-ready"], queryFn: fetchReady, retry: 1 });

  const portalUp = health.isSuccess;
  const backendReady = ready.isSuccess && ready.data?.status === "ready";

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
        <Wordmark />
        <Button asChild>
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>

      <main className="mx-auto max-w-4xl px-6 pb-20">
        <section className="relative overflow-hidden rounded-2xl border border-border bg-card/40 p-8 sm:p-12">
          <div className="grid-bg absolute inset-0 opacity-20" />
          <div className="relative">
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Set up your Gridwire instance
            </h1>
            <p className="mt-4 max-w-2xl text-muted-foreground">
              This deployment is ready for your organization. Sign in to create a workspace, upload
              spreadsheets, and expose them as secured APIs — with row-level isolation, hashed API keys,
              and per-field masking enforced on every response.
            </p>

            <div className="mt-6 flex flex-wrap gap-3 text-sm">
              <StatusPill
                label="Portal"
                ok={portalUp}
                loading={health.isLoading}
                detail={portalUp ? "Running" : "Unavailable"}
              />
              <StatusPill
                label="Backend"
                ok={backendReady}
                loading={ready.isLoading}
                detail={backendReady ? "Ready" : ready.isError ? "Not ready" : "Checking…"}
              />
            </div>

            <Button size="lg" className="mt-8" asChild>
              <Link to="/auth">
                Get started <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">What happens next</h2>
          <ol className="mt-4 space-y-4">
            {setupSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <li
                  key={step.title}
                  className="flex gap-4 rounded-xl border border-border bg-card p-5"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-sm font-bold text-primary">
                    {index + 1}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <h3 className="font-medium">{step.title}</h3>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{step.desc}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="mt-10 rounded-xl border border-border bg-muted/20 p-6">
          <div className="flex items-start gap-3">
            <Container className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <h2 className="font-semibold">Deployed with Docker?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                If you used <code className="rounded bg-muted px-1.5 py-0.5">docker compose</code> or{" "}
                <code className="rounded bg-muted px-1.5 py-0.5">.\scripts\deploy.ps1 up</code>, the
                portal, database, auth, and worker are already running on this host. Configure
                connectors, SMTP, and TLS in your <code className="rounded bg-muted px-1.5 py-0.5">.env</code>{" "}
                file — see <code className="rounded bg-muted px-1.5 py-0.5">deploy/on-prem/README.md</code>{" "}
                in the repository.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatusPill({
  label,
  ok,
  loading,
  detail,
}: {
  label: string;
  ok: boolean;
  loading: boolean;
  detail: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1">
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
      ) : (
        <span className="h-2 w-2 rounded-full bg-destructive" />
      )}
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground">{detail}</span>
    </span>
  );
}
