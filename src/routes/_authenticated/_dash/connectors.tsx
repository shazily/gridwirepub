import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_dash/connectors")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/connectors", replace: true });
  },
});
