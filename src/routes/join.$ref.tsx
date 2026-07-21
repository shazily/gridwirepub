import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getJoinPreview } from "@/lib/org-join.functions";
import {
  clearPendingJoinRef,
  setCurrentOrgIdLocal,
  setPendingJoinRef,
} from "@/lib/org-join";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { AlertTriangle, Loader2, UserPlus } from "lucide-react";

export const Route = createFileRoute("/join/$ref")({
  head: () => ({
    meta: [
      { title: "Join workspace — Gridwire" },
      {
        name: "description",
        content: "Join an existing Gridwire workspace with a shareable join link.",
      },
    ],
  }),
  component: JoinPage,
});

function JoinPage() {
  const { ref: rawRef } = Route.useParams();
  const ref = decodeURIComponent(rawRef);
  const navigate = useNavigate();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [joining, setJoining] = useState(false);
  const fetchPreview = useServerFn(getJoinPreview);

  const preview = useQuery({
    queryKey: ["join-preview", ref],
    queryFn: async () => fetchPreview({ data: { ref } }),
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(!!data.session);
      setSessionChecked(true);
    });
  }, []);

  useEffect(() => {
    if (preview.data?.valid) setPendingJoinRef(ref);
  }, [preview.data?.valid, ref]);

  const valid = preview.data?.valid === true;

  async function handleJoin() {
    setJoining(true);
    try {
      const { data, error } = await supabase.rpc("join_organization_by_ref", { _ref: ref });
      if (error) throw error;
      if (typeof data === "string") {
        setCurrentOrgIdLocal(data);
      }
      clearPendingJoinRef();
      toast.success("You've joined the workspace as a Viewer.");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to join this organization");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="grid-bg flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link to="/">
            <Wordmark />
          </Link>
        </div>
        <Card>
          <CardHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15">
              <UserPlus className="h-5 w-5 text-primary" />
            </div>
            {preview.isLoading || !sessionChecked ? (
              <CardTitle>Checking join link…</CardTitle>
            ) : valid && preview.data?.valid ? (
              <>
                <CardTitle>Join {preview.data.org_name}</CardTitle>
                <CardDescription>
                  You will join as a Viewer. An administrator can change your role later.
                </CardDescription>
              </>
            ) : (
              <>
                <CardTitle>Join link unavailable</CardTitle>
                <CardDescription>
                  This join link is not available. Ask your administrator to enable join by organization ID
                  and share a current link.
                </CardDescription>
              </>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {preview.isError && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                Could not verify this link. Try again in a moment.
              </p>
            )}
            {valid && signedIn && (
              <Button className="w-full" onClick={() => void handleJoin()} disabled={joining}>
                {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : "Join workspace"}
              </Button>
            )}
            {valid && !signedIn && (
              <div className="flex flex-col gap-2">
                <Button asChild className="w-full">
                  <Link to="/auth" search={{ mode: "signin", join: ref }}>
                    Sign in to join
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/auth" search={{ mode: "signup", join: ref }}>
                    Create account to join
                  </Link>
                </Button>
              </div>
            )}
            {!valid && !preview.isLoading && (
              <Button asChild variant="outline" className="w-full">
                <Link to="/auth">Go to sign in</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
