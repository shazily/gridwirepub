import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy path — member notifications live at /notifications. */
export const Route = createFileRoute("/_authenticated/_dash/alerts")({
  beforeLoad: () => {
    throw redirect({ to: "/notifications", replace: true });
  },
});
