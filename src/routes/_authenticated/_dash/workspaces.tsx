import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_dash/workspaces")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/workspaces", replace: true });
  },
});
