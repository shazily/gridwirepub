import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isOnPremDeployment } from "@/lib/deployment";
import { fetchPortalBranding } from "@/lib/portal-branding";
import { PortalBrand } from "@/components/brand";
import { PublicSiteFooter, PublicSiteHeader } from "@/components/public-chrome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, ArrowRight, ShieldCheck, GitBranch, KeyRound } from "lucide-react";

const USERNAME_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i;

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

function isValidUsername(username: string): boolean {
  const u = normalizeUsername(username);
  return u.length >= 3 && u.length <= 32 && USERNAME_RE.test(u);
}

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    org: typeof search.org === "string" && search.org.trim() ? search.org.trim() : undefined,
    mode:
      search.mode === "signin" || search.mode === "signup" || search.mode === "forgot"
        ? search.mode
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Gridwire" },
      {
        name: "description",
        content: "Sign up or sign in with a username, email, and password to use Gridwire.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { org: orgSlug, mode: modeFromSearch } = Route.useSearch();
  const branding = useQuery({
    queryKey: ["portal-branding", orgSlug],
    queryFn: () => fetchPortalBranding(orgSlug!),
    enabled: !!orgSlug,
    staleTime: 60_000,
    retry: false,
  });
  const portalActive = !!orgSlug && !!branding.data && !branding.isError;
  const platformName = portalActive ? branding.data!.platform_name : "Gridwire";
  const logoUrl = portalActive ? branding.data!.logo_url : null;
  const orgName = portalActive ? branding.data!.organization_name : null;
  const authMode = portalActive ? (branding.data!.auth_mode ?? "hybrid") : "hybrid";
  const ssoConfigured = portalActive ? Boolean(branding.data!.sso_configured) : false;
  const localAuthAllowed = authMode === "local" || authMode === "hybrid";
  const ssoAuthAllowed = authMode === "sso" || authMode === "hybrid";
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">(modeFromSearch ?? "signin");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (modeFromSearch) setMode(modeFromSearch);
  }, [modeFromSearch]);

  useEffect(() => {
    if (authMode === "sso" && (mode === "signup" || mode === "forgot")) {
      setMode("signin");
    }
  }, [authMode, mode]);

  const publicConfig = useQuery({
    queryKey: ["public-config"],
    queryFn: async () => {
      const res = await fetch("/api/public/config");
      if (!res.ok) throw new Error("config unavailable");
      return res.json() as Promise<{
        password_reset_available: boolean;
        email_confirm_required: boolean;
        smtp_configured: boolean;
      }>;
    },
    staleTime: 60_000,
  });

  const passwordResetAvailable = publicConfig.data?.password_reset_available ?? false;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function resolveEmailForLogin(identifier: string): Promise<string> {
    const trimmed = identifier.trim();
    if (trimmed.includes("@")) return trimmed.toLowerCase();
    const res = await fetch("/api/public/auth/resolve-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: trimmed }),
    });
    const data = (await res.json()) as { email?: string | null; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Could not resolve login");
    if (!data.email) throw new Error("Invalid username or password");
    return data.email;
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "forgot") {
        if (!passwordResetAvailable) {
          throw new Error(
            "Password reset email is not configured on this server. Ask your administrator to configure Postmark or SMTP in the deployment .env file.",
          );
        }
        const resetEmail = email.includes("@")
          ? email.trim().toLowerCase()
          : await resolveEmailForLogin(email);
        if (isOnPremDeployment) {
          const res = await fetch("/api/public/auth/recover", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: resetEmail,
              redirectTo: `${window.location.origin}/reset-password`,
              ...(orgSlug ? { orgSlug } : {}),
            }),
          });
          const data = (await res.json()) as { error?: string; message?: string };
          if (!res.ok) throw new Error(data.error ?? "Could not send reset email");
        } else {
          const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
            redirectTo: `${window.location.origin}/reset-password`,
          });
          if (error) throw error;
        }
        toast.success("If an account exists for that email, a reset link has been sent.");
        setMode("signin");
        return;
      }
      if (mode === "signup") {
        const uname = normalizeUsername(username);
        if (!isValidUsername(uname)) {
          throw new Error(
            "Username must be 3–32 characters: letters, numbers, dots, underscores, or hyphens.",
          );
        }
        const availRes = await fetch(
          `/api/public/auth/username-available?username=${encodeURIComponent(uname)}`,
        );
        const avail = (await availRes.json()) as { available?: boolean };
        if (!avail.available) {
          throw new Error("That username is already taken. Please choose another.");
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              username: uname,
              display_name: uname,
            },
          },
        });
        if (error) throw error;
        // Ensure username is persisted even if trigger lags / conflicted.
        if (data.user?.id) {
          await supabase.from("profiles").upsert({
            id: data.user.id,
            username: uname,
            display_name: uname,
          });
        }
        if (!data.session) {
          toast.success("Check your email to confirm your account, then sign in.");
          setMode("signin");
          return;
        }
        toast.success("Account created. Welcome to Gridwire!");
      } else {
        const resolvedEmail = await resolveEmailForLogin(loginId);
        const { error } = await supabase.auth.signInWithPassword({
          email: resolvedEmail,
          password,
        });
        if (error) throw new Error("Invalid username or password");
      }
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    if (isOnPremDeployment) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch {
      toast.error("Google sign-in failed");
      setLoading(false);
    }
  }

  const homeTo = portalActive && orgSlug ? "/portal/$orgSlug" : "/";
  const homeParams = orgSlug ? { orgSlug } : undefined;

  return (
    <div className="flex min-h-screen flex-col">
      <PublicSiteHeader
        homeTo={homeTo}
        homeParams={homeParams}
        trailing={
          <Button variant="outline" size="sm" className="bg-background/80 shadow-sm" asChild>
            <Link to={homeTo} params={homeParams}>
              Home
            </Link>
          </Button>
        }
      />

      <div className="grid flex-1 lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 lg:flex">
        <div className="grid-bg absolute inset-0 opacity-40" />
        <div className="relative max-w-md space-y-6 pt-4">
          <h2 className="font-display text-4xl font-bold leading-tight">
            {portalActive && orgName
              ? `Sign in to ${orgName}`
              : "Turn any spreadsheet into a secure production API."}
          </h2>
          <p className="text-muted-foreground">
            {portalActive
              ? `Access ${platformName} to publish and consume spreadsheet data as secure APIs.`
              : "Create an account with a username, email, and password — then upload Excel or CSV and ship a documented REST API."}
          </p>
          <ul className="space-y-3 text-sm">
            <li className="flex items-center gap-3">
              <GitBranch className="h-4 w-4 text-primary" /> Versioning & baseline diffing
            </li>
            <li className="flex items-center gap-3">
              <ShieldCheck className="h-4 w-4 text-primary" /> Masking, hashing & encryption
            </li>
            <li className="flex items-center gap-3">
              <KeyRound className="h-4 w-4 text-primary" /> Scoped API keys & audit logs
            </li>
          </ul>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {portalActive && (
            <div className="mb-8 lg:hidden">
              <PortalBrand platformName={platformName} logoUrl={logoUrl} />
            </div>
          )}
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset your password"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin"
              ? authMode === "sso"
                ? "This workspace uses single sign-on."
                : "Sign in with your username or email and password."
              : mode === "signup"
                ? "Choose a username, email, and password to get started."
                : "Enter your email (or username) and we'll send a reset link."}
          </p>

          {portalActive && authMode === "sso" && (
            <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              {ssoConfigured
                ? "Ask your administrator for the Azure AD / Okta sign-in link for this portal. Password accounts are disabled."
                : "SSO is required for this portal, but the identity provider is not fully configured yet. Contact your administrator."}
            </div>
          )}

          {mode !== "forgot" && !isOnPremDeployment && localAuthAllowed && (
            <>
              <Button
                variant="outline"
                className="mt-6 w-full"
                onClick={handleGoogle}
                disabled={loading}
              >
                <GoogleIcon /> Continue with Google
              </Button>

              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          {localAuthAllowed && (
          <form
            onSubmit={handleEmail}
            className={mode === "forgot" ? "mt-6 space-y-4" : mode === "signin" && !isOnPremDeployment ? "space-y-4" : "mt-6 space-y-4"}
          >
            {mode === "forgot" && !passwordResetAvailable && publicConfig.isSuccess && (
              <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-muted-foreground">
                This deployment has no outbound email configured (set Postmark or{" "}
                <code className="text-[10px]">SMTP_HOST</code> in <code className="text-[10px]">.env</code>).
                Password reset links cannot be sent until mail is configured. On a demo install, ask your operator
                to add Postmark credentials or reset your password via the database.
              </p>
            )}
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={32}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ada_lovelace"
                />
                <p className="text-[11px] text-muted-foreground">
                  3–32 characters. Letters, numbers, dots, underscores, hyphens.
                </p>
              </div>
            )}
            {mode === "signin" ? (
              <div className="space-y-1.5">
                <Label htmlFor="loginId">Username or email</Label>
                <Input
                  id="loginId"
                  autoComplete="username"
                  required
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="ada_lovelace or you@company.com"
                />
              </div>
            ) : mode === "forgot" ? (
              <div className="space-y-1.5">
                <Label htmlFor="email">Email or username</Label>
                <Input
                  id="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com or ada_lovelace"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>
            )}
            {mode !== "forgot" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {mode === "signin" && (
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={() => setMode("forgot")}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <>
                  {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>
          )}

          {localAuthAllowed && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "forgot" ? (
              <>
                Remembered it?{" "}
                <button
                  className="font-medium text-primary hover:underline"
                  onClick={() => setMode("signin")}
                >
                  Back to sign in
                </button>
              </>
            ) : (
              <>
                {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
                <button
                  className="font-medium text-primary hover:underline"
                  onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                >
                  {mode === "signin" ? "Sign up" : "Sign in"}
                </button>
              </>
            )}
          </p>
          )}

          {!localAuthAllowed && ssoAuthAllowed && (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Password sign-in is disabled for this workspace.
            </p>
          )}

        </div>
      </div>
      </div>

      <PublicSiteFooter />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
