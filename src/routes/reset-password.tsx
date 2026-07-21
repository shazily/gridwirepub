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

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [validSession, setValidSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function establishRecoverySession() {
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const type = params.get("type");

      if (tokenHash && (type === "recovery" || !type)) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });
        if (!cancelled && !error) {
          setValidSession(true);
          // Drop secrets from the address bar after verify.
          window.history.replaceState({}, "", "/reset-password");
        }
      }

      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (session) setValidSession(true);
        if (event === "PASSWORD_RECOVERY") setValidSession(true);
      });

      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        if (data.session) setValidSession(true);
        setReady(true);
      }

      return () => sub.subscription.unsubscribe();
    }

    const cleanupPromise = establishRecoverySession();
    return () => {
      cancelled = true;
      void cleanupPromise.then((cleanup) => cleanup?.());
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords do not match");
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
              This reset link is invalid or has expired. Request a new one from the sign-in page.
            </p>
            <Button asChild className="mt-6 w-full">
              <Link to="/auth">Back to sign in</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a strong password you don't use anywhere else.
            </p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
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
                  minLength={6}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !validSession}>
                {loading ? (
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
