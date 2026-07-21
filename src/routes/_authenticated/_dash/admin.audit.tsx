import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy path — audit lives under Logs → Audit. */
export const Route = createFileRoute("/_authenticated/_dash/admin/audit")({
  beforeLoad: () => {
    throw redirect({ to: "/logs", search: { tab: "audit" }, replace: true });
  },
});
