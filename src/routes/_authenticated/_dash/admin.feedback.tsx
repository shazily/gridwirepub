import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_dash/admin/feedback")({
  beforeLoad: () => {
    throw redirect({ to: "/app-feedback", replace: true });
  },
});
