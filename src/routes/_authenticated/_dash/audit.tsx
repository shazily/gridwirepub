import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy path — use /logs?tab=audit. */
export const Route = createFileRoute("/_authenticated/_dash/audit")({
  beforeLoad: () => {
    throw redirect({ to: "/logs", search: { tab: "audit" }, replace: true });
  },
});
