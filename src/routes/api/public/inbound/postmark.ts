import { createFileRoute } from "@tanstack/react-router";
import { handleInboundWebhookRequest } from "@/lib/inbound-webhook-parse.server";

/** POST /api/public/inbound/postmark — Postmark inbound webhook (requires signature in production). */
export const Route = createFileRoute("/api/public/inbound/postmark")({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleInboundWebhookRequest(request, { requirePostmarkSignature: true }),
    },
  },
});
