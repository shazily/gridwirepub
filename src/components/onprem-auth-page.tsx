import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isOnPremDeployment } from "@/lib/deployment";
import { setPendingJoinRef } from "@/lib/org-join";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowRight, Loader2, Building2, KeyRound, ShieldCheck } from "lucide-react";

const USERNAME_RE = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i;

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

function isValidUsername(username: string): boolean {
  const u = normalizeUsername(username);
  return u.length >= 3 && u.length <= 32 && USERNAME_RE.test(u);
}

type Mode = "signin" | "signup" | "forgot";

/**
 * On-prem / self-host auth surface — no marketing hero.
 * Join-by-org happens after account creation (onboarding or pending join ref).
 */
export function OnPremAuthPage({
  modeFromSearch,
  joinRef,
}: {
  modeFromSearch?: Mode;
  joinRef?: string;
}) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>(modeFromSearch ?? "signin");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (modeFromSearch) setMode(modeFromSearch);
  }, [modeFromSearch]);

  useEffect(() => {
    if (joinRef?.trim()) setPendingJoinRef(joinRef.trim());
  }, [joinRef]);

  const publicConfig = useQuery({
    queryKey: ["public-config"],
    queryFn: async () => {
      const res = await fetch("/api/public/config");
      if (!res.ok) throw new Error("config unavailable");
      return res.json() as Promise<{
        password_reset_available: boolean;
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
            }),
          });
          const data = (await res.json()) as { error?: string };
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
            data: { username: uname, display_name: uname },
          },
        });
        if (error) throw error;
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
        toast.success("Account created.");
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

  return (
    <div className="grid-bg flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-6">
        <Link to="/">
          <Wordmark />
        </Link>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">Home</Link>
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 lg:flex-row lg:items-start lg:gap-16 lg:py-16">
        <aside className="max-w-md space-y-4 lg:pt-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {mode === "signin"
              ? "Sign in to this instance"
              : mode === "signup"
                ? "Create an account"
                : "Reset your password"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "forgot"
              ? "Enter your email or username and we will send a reset link if outbound mail is configured."
              : "Joining an existing workspace? Sign in or create an account, then enter the organization UUID (or open a join link your admin shared). Creating a new workspace is only for the first administrator on this instance."}
          </p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              Join with org UUID or /join link when an admin enables it
            </li>
            <li className="flex items-start gap-2">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              Invite links still grant Contributor+ roles
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              Local accounts — no marketing signup funnel
            </li>
          </ul>
        </aside>

        <div className="w-full max-w-sm rounded-xl border border-border bg-card/80 p-6 shadow-sm backdrop-blur-sm">
          <form onSubmit={handleEmail} className="space-y-4">
            {mode === "forgot" && !passwordResetAvailable && publicConfig.isSuccess && (
              <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-muted-foreground">
                This deployment has no outbound email configured. Ask your operator to set Postmark or SMTP in{" "}
                <code className="text-[10px]">.env</code>.
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
                  placeholder="you@company.com"
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
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "forgot" ? (
              <>
                Remembered it?{" "}
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => setMode("signin")}
                >
                  Back to sign in
                </button>
              </>
            ) : (
              <>
                {mode === "signin" ? "Need an account? " : "Already have an account? "}
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                >
                  {mode === "signin" ? "Create account" : "Sign in"}
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
