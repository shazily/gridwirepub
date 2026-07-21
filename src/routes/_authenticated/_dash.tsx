import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/use-org";
import { AppShell } from "@/components/app-shell";
import { PENDING_INVITE_KEY } from "@/routes/invite.$token";
import {
  clearPendingJoinRef,
  getPendingJoinRef,
  PENDING_JOIN_KEY,
} from "@/lib/org-join";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_dash")({
  component: DashLayout,
});

function DashLayout() {
  const { orgs, isLoading, isError, isReady, refetch, setCurrentOrgId } = useOrg();
  const navigate = useNavigate();
  const inviteHandled = useRef(false);
  const joinHandled = useRef(false);
  const redeemInFlight = useRef(false);

  // Redeem a pending invite (e.g. after email confirmation) before deciding
  // whether the user needs onboarding.
  useEffect(() => {
    if (inviteHandled.current || typeof window === "undefined") return;
    const token = window.localStorage.getItem(PENDING_INVITE_KEY);
    if (!token) {
      inviteHandled.current = true;
      return;
    }
    redeemInFlight.current = true;
    inviteHandled.current = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("accept_org_invite", { _token: token });
        window.localStorage.removeItem(PENDING_INVITE_KEY);
        if (error) return;
        if (typeof data === "string") setCurrentOrgId(data);
        await refetch();
        toast.success("You've joined the workspace!");
      } finally {
        redeemInFlight.current = false;
      }
    })();
  }, [refetch, setCurrentOrgId]);

  // Redeem pending join-by-org ref (UUID or portal slug from /join/… or ?join=).
  useEffect(() => {
    if (joinHandled.current || typeof window === "undefined") return;
    const ref = getPendingJoinRef();
    if (!ref) {
      joinHandled.current = true;
      return;
    }
    // Prefer invite if both somehow set — invite effect may still be running.
    if (window.localStorage.getItem(PENDING_INVITE_KEY)) return;

    redeemInFlight.current = true;
    joinHandled.current = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("join_organization_by_ref", { _ref: ref });
        clearPendingJoinRef();
        if (error) return;
        if (typeof data === "string") setCurrentOrgId(data);
        await refetch();
        toast.success("You've joined the workspace as a Viewer.");
      } finally {
        redeemInFlight.current = false;
      }
    })();
  }, [refetch, setCurrentOrgId]);

  useEffect(() => {
    if (redeemInFlight.current) return;
    if (typeof window !== "undefined") {
      if (window.localStorage.getItem(PENDING_INVITE_KEY)) return;
      if (window.localStorage.getItem(PENDING_JOIN_KEY)) return;
    }
    if (!isReady) return;
    if (isError) return;
    if (orgs.length === 0) {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [isReady, isError, orgs.length, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Could not load your workspace memberships. This is usually a database permission issue after
          an upgrade.
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
