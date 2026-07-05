import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_dash/audit")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/audit", replace: true });
  },
});
