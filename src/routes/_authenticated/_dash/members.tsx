import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_dash/members")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/team", replace: true });
  },
});
