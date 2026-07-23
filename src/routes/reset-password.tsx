import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, ArrowRight, KeyRound } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — Gridwire" },
      { name: "description", content: "Set a new password for your Gridwire account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

/** One-shot guard so React Strict Mode (or a double mount) cannot burn a recovery OTP twice. */
function claimRecoveryToken(tokenHash: string): boolean {
  try {
    const key = `gridwire:recovery-otp:${tokenHash}`;
    if (sessionStorage.getItem(key) === "1") return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return true;
  }
}

function waitForSession(ms = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub.subscription.unsubscribe();
      resolve(ok);
    };
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish(true);
    });
    const timer = setTimeout(() => {
      void supabase.auth.getSession().then(({ data }) => finish(!!data.session));
    }, ms);
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish(true);
    });
  });
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [validSession, setValidSession] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) setValidSession(true);
      if (event === "PASSWORD_RECOVERY") setValidSession(true);
    });

    async function establishRecoverySession() {
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const type = params.get("type");
      let localError: string | null = null;

      const existing = await supabase.auth.getSession();
      if (existing.data.session) {
        if (!cancelled) {
          setValidSession(true);
          setReady(true);
          if (tokenHash) window.history.replaceState({}, "", "/reset-password");
        }
        return;
      }

      if (tokenHash && (type === "recovery" || !type)) {
        if (claimRecoveryToken(tokenHash)) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "recovery",
          });
          if (error) {
            const again = await supabase.auth.getSession();
            if (!again.data.session) {
              localError = error.message || "This reset link is invalid or has expired.";
            }
          }
        } else {
          // Sibling mount is verifying — wait for its session instead of verifying again.
          await waitForSession(2000);
        }

        if (!cancelled) {
          window.history.replaceState({}, "", "/reset-password");
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        const ok = !!data.session;
        setValidSession(ok);
        if (!ok) {
          setStatusMessage(
            localError ??
              (tokenHash
                ? "This reset link is invalid or has expired."
                : "Open the reset link from your email to continue."),
          );
        }
        setReady(true);
      }
    }

    void establishRecoverySession();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      toast.error("Use at least 8 characters");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated. You're all set.");
    navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Wordmark />
        </div>
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <KeyRound className="h-5 w-5" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Set a new password</h1>

        {ready && !validSession ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              {statusMessage ??
                "This reset link is invalid or has expired. Request a new one from the sign-in page."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Reset links are single-use and expire after 5 minutes.
            </p>
            <Button asChild className="mt-6 w-full">
              <Link to="/auth">Back to sign in</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a strong password you don&apos;t use anywhere else.
            </p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !ready || !validSession}>
                {loading || !ready ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Update password <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
