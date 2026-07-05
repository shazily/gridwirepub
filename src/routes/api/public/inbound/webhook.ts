import { createFileRoute } from "@tanstack/react-router";
import { handleInboundWebhookRequest } from "@/lib/inbound-webhook-parse.server";

/** POST /api/public/inbound/webhook — provider-agnostic inbound email ingest webhook. */
export const Route = createFileRoute("/api/public/inbound/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handleInboundWebhookRequest(request),
    },
  },
});
