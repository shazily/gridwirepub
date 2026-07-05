import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_dash/api-docs")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/api-docs", replace: true });
  },
});
