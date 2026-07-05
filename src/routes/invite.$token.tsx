import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getInvitePreview } from "@/lib/invites.functions";
import { GridwireMark, Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, ShieldCheck, UserPlus, AlertTriangle, ArrowRight } from "lucide-react";

export const PENDING_INVITE_KEY = "gridwire.pendingInvite";
const CURRENT_ORG_KEY = "gridwire.currentOrgId";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({
    meta: [
      { title: "Team invite — Gridwire" },
      { name: "description", content: "You've been invited to collaborate on a Gridwire workspace." },
    ],
  }),
  component: InvitePage,
});

type Preview =
  | { valid: true; org_name: string; role: string }
  | { valid: false; reason: string };

function reasonText(reason: string): string {
  switch (reason) {
    case "not_found":
      return "This invite link is not valid.";
    case "revoked":
      return "This invite link has been revoked.";
    case "expired":
      return "This invite link has expired.";
    case "used_up":
      return "This invite link has reached its usage limit.";
    default:
      return "This invite link cannot be used.";
  }
}

async function acceptAndRedirect(token: string, navigate: ReturnType<typeof useNavigate>) {
  const { data, error } = await supabase.rpc("accept_org_invite", { _token: token });
  if (error) {
    toast.error(error.message);
    return false;
  }
  if (typeof data === "string" && typeof window !== "undefined") {
    window.localStorage.setItem(CURRENT_ORG_KEY, data);
  }
  window.localStorage.removeItem(PENDING_INVITE_KEY);
  toast.success("You've joined the workspace!");
  navigate({ to: "/datasets/new", replace: true });
  return true;
}

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const fetchPreview = useServerFn(getInvitePreview);

  const preview = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: async () => {
      const data = await fetchPreview({ data: { token } });
      return data as Preview;
    },
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(!!data.session);
      setSessionChecked(true);
    });
  }, []);

  const valid = preview.data?.valid === true;

  async function handleJoin() {
    setAccepting(true);
    await acceptAndRedirect(token, navigate);
    setAccepting(false);
  }

  return (
    <div className="grid-bg flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link to="/"><Wordmark /></Link>
        </div>
        <Card>
          <CardHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15">
              <UserPlus className="h-5 w-5 text-primary" />
            </div>
            {preview.isLoading ? (
              <CardTitle>Checking invite…</CardTitle>
            ) : valid && preview.data?.valid ? (
              <>
                <CardTitle>Join {preview.data.org_name}</CardTitle>
                <CardDescription className="flex items-center gap-2">
                  You've been invited as a{" "}
                  <Badge variant="secondary" className="capitalize">{preview.data.role}</Badge>
                </CardDescription>
              </>
            ) : (
              <>
                <CardTitle>Invite unavailable</CardTitle>
                <CardDescription>
                  {preview.data && !preview.data.valid ? reasonText(preview.data.reason) : "This invite link cannot be used."}
                </CardDescription>
              </>
            )}
          </CardHeader>

          <CardContent>
            {preview.isLoading || !sessionChecked ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !valid ? (
              <Button className="w-full" variant="outline" onClick={() => navigate({ to: "/" })}>
                Back to home
              </Button>
            ) : signedIn ? (
              <div className="space-y-4">
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  Contributors can securely drop data that's converted into a protected, token-only API.
                </p>
                <Button className="w-full" onClick={handleJoin} disabled={accepting}>
                  {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                    <>Accept invite <ArrowRight className="h-4 w-4" /></>
                  )}
                </Button>
              </div>
            ) : (
              <InviteAuth token={token} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InviteAuth({ token }: { token: string }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/invite/${token}`,
            data: { display_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        if (data.session) {
          await acceptAndRedirect(token, navigate);
        } else {
          // Email confirmation required — remember the invite for after confirm.
          window.localStorage.setItem(PENDING_INVITE_KEY, token);
          toast.success("Check your email to confirm your account, then you'll join automatically.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await acceptAndRedirect(token, navigate);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        {mode === "signup"
          ? "Create your account to accept this invite. This workspace is invite-only."
          : "Sign in to accept this invite."}
      </p>
      {mode === "signup" && (
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "signup" ? "Create account & join" : "Sign in & join"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {mode === "signup" ? "Already have an account? " : "Need an account? "}
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
          {mode === "signup" ? "Sign in" : "Sign up"}
        </button>
      </p>
      <div className="flex items-center justify-center pt-2 lg:hidden">
        <GridwireMark className="h-6 w-6 opacity-40" />
      </div>
    </form>
  );
}
