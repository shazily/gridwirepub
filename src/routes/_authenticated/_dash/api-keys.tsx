import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_dash/api-keys")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/api-keys", replace: true });
  },
});
