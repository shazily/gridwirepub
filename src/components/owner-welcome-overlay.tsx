import { useCallback, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOrg } from "@/hooks/use-org";
import { markWelcomeCompleted } from "@/lib/welcome-tour";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Building2,
  Crown,
  HardDrive,
  KeyRound,
  Layers,
  Shield,
  UploadCloud,
  Users,
  X,
  Lock,
  Mail,
  Smartphone,
} from "lucide-react";

const STEPS = [
  {
    id: "welcome",
    icon: Building2,
    title: (org: string) => `Welcome to ${org}`,
    subtitle: "You’re the workspace owner. This quick tour shows how Gridwire fits together.",
    body: (
      <p className="text-sm leading-relaxed text-muted-foreground">
        Gridwire turns spreadsheets into versioned REST APIs with field-level protection, audit
        logging, and on-prem object storage. Use the sidebar to switch workspaces — one account can
        belong to many organizations.
      </p>
    ),
  },
  {
    id: "account",
    icon: Layers,
    title: () => "Your account vs workspaces",
    subtitle: "One login, many organizations",
    body: (
      <ul className="space-y-2 text-sm text-muted-foreground">
        <li>
          <strong className="text-foreground">Your user account</strong> is global (email + password).
          It is not tied to a single organization.
        </li>
        <li>
          <strong className="text-foreground">Workspaces</strong> are separate organizations. You can
          own several, or be invited to others as admin, member, contributor, or viewer.
        </li>
        <li>
          Use the <strong className="text-foreground">org switcher</strong> at the top of the sidebar
          to change context. API keys, datasets, and quotas are always per workspace.
        </li>
        <li>
          Create another workspace anytime via <strong className="text-foreground">New organization</strong>{" "}
          in that menu.
        </li>
      </ul>
    ),
  },
  {
    id: "flow",
    icon: UploadCloud,
    title: () => "From file to API",
    subtitle: "Four steps your team will repeat",
    body: (
      <ol className="space-y-2 text-sm text-muted-foreground">
        {[
          "Upload Excel/CSV or connect a folder worker.",
          "Map columns, types, and PII masking (encrypt, hash, mask).",
          "Publish a version — schema drift and contracts are tracked.",
          "Share API keys; consumers call documented REST endpoints.",
        ].map((text, i) => (
          <li key={text} className="flex gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {i + 1}
            </span>
            <span className="pt-0.5">{text}</span>
          </li>
        ))}
      </ol>
    ),
  },
  {
    id: "admin",
    icon: Crown,
    title: () => "Admin console",
    subtitle: "What you control as owner",
    body: (
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { icon: Users, label: "Team & access", desc: "Invites, roles, revoke access" },
          { icon: HardDrive, label: "Storage & quotas", desc: "MinIO/S3, upload limits, teams" },
          { icon: KeyRound, label: "Authentication", desc: "SSO, MFA policy, org SMTP/SMS" },
          { icon: Building2, label: "Organization", desc: "Portal branding & invite links" },
          { icon: Shield, label: "Audit log", desc: "Security-relevant actions" },
          { icon: KeyRound, label: "API keys", desc: "Rotate tokens per consumer" },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="flex gap-2 rounded-lg border border-border bg-card/60 p-2.5 text-xs"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="font-medium text-foreground">{item.label}</div>
                <div className="text-muted-foreground">{item.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    ),
  },
  {
    id: "auth",
    icon: Lock,
    title: () => "Layers of authentication",
    subtitle: "How people and machines sign in",
    body: (
      <div className="space-y-2">
        {[
          {
            icon: Mail,
            label: "Email & password",
            desc: "Default for on-prem. Configure SMTP in Admin → Authentication for reset emails.",
          },
          {
            icon: Shield,
            label: "SSO (OIDC / SAML)",
            desc: "Azure AD, Okta, Google Workspace — per-org IdP in Admin → Authentication.",
          },
          {
            icon: Smartphone,
            label: "MFA (TOTP)",
            desc: "Owners/admins can require authenticator apps. Enroll under Settings.",
          },
          {
            icon: KeyRound,
            label: "API keys",
            desc: "Bearer tokens for dataset access — separate from human login.",
          },
        ].map((layer) => {
          const Icon = layer.icon;
          return (
            <div
              key={layer.label}
              className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-3"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="text-sm font-medium">{layer.label}</div>
                <p className="text-xs text-muted-foreground">{layer.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    ),
  },
] as const;

type OwnerWelcomeOverlayProps = {
  open: boolean;
  onClose: () => void;
};

export function OwnerWelcomeOverlay({ open, onClose }: OwnerWelcomeOverlayProps) {
  const { currentOrg, orgs } = useOrg();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const finish = useCallback(
    (to?: "/dashboard" | "/members" | "/admin") => {
      if (currentOrg) markWelcomeCompleted(currentOrg.id);
      onClose();
      if (to) navigate({ to });
    },
    [currentOrg, onClose, navigate],
  );

  if (!open || !currentOrg) return null;

  const isLast = step >= STEPS.length;
  const current = STEPS[step];
  const Icon = current?.icon ?? Crown;
  const orgName = currentOrg.name;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="owner-welcome-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        aria-label="Dismiss tour"
        onClick={() => finish()}
      />
      <div className="relative z-10 w-full max-w-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="gap-1 capitalize">
                <Crown className="h-3 w-3" /> Owner tour
              </Badge>
              {orgs.length > 1 && (
                <span>{orgs.length} workspaces on your account</span>
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => finish()}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="p-6 sm:p-8">
            {!isLast && current ? (
              <>
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h2 id="owner-welcome-title" className="text-xl font-bold tracking-tight">
                  {current.title(orgName)}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{current.subtitle}</p>
                <div className="mt-5">{current.body}</div>
              </>
            ) : (
              <>
                <h2 id="owner-welcome-title" className="text-xl font-bold tracking-tight">
                  You&apos;re ready
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Explore the Admin console, invite your team, or publish your first dataset. Replay
                  this tour anytime from{" "}
                  <Link to="/help" className="text-primary underline-offset-4 hover:underline">
                    Help &amp; FAQ
                  </Link>
                  .
                </p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                  <Button className="flex-1" onClick={() => finish("/admin")}>
                    Open admin console
                  </Button>
                  <Button className="flex-1" variant="outline" onClick={() => finish("/members")}>
                    <Users className="h-4 w-4" /> Invite team
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border px-5 py-4">
            <div className="flex gap-1.5">
              {Array.from({ length: STEPS.length + 1 }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Step ${i + 1}`}
                  className={cn(
                    "h-2 rounded-full transition-all",
                    step === i ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30",
                  )}
                  onClick={() => setStep(i)}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {step > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)}>
                  Back
                </Button>
              )}
              {!isLast ? (
                <Button size="sm" onClick={() => setStep((s) => s + 1)}>
                  Next <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button size="sm" onClick={() => finish("/dashboard")}>
                  Go to dashboard
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
