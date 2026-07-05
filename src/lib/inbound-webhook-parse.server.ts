/**
 * Parse inbound email webhook JSON into a normalized shape for the ingest pipeline.
 * Accepts the common Postmark-style schema; other gateways can adapt to this format.
 */

import { verifyInboundWebhookAuth, type InboundWebhookAuthOptions } from "@/lib/inbound-webhook-auth.server";

export type InboundWebhookPayload = {
  from: string;
  subject: string;
  externalId?: string;
  mailboxHash?: string;
  attachments: { name: string; contentType: string; contentBase64: string }[];
};

/** Standard inbound JSON (Postmark-compatible field names). */
export function parseInboundWebhookBody(body: {
  From?: string;
  FromFull?: { Email?: string };
  Subject?: string;
  MessageID?: string;
  MailboxHash?: string;
  Attachments?: { Name?: string; Content?: string; ContentType?: string }[];
}): InboundWebhookPayload {
  const from =
    body.FromFull?.Email?.trim().toLowerCase() ??
    body.From?.trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1") ??
    "";

  return {
    from,
    subject: body.Subject ?? "",
    externalId: body.MessageID ?? undefined,
    mailboxHash: body.MailboxHash,
    attachments: (body.Attachments ?? []).map((a) => ({
      name: a.Name ?? "attachment",
      contentType: a.ContentType ?? "application/octet-stream",
      contentBase64: a.Content ?? "",
    })),
  };
}

export async function handleInboundWebhookRequest(
  request: Request,
  authOpts?: InboundWebhookAuthOptions,
): Promise<Response> {
  const { checkPublicEndpointRateLimit } = await import("@/lib/public-endpoint-guard.server");

  const rateLimited = checkPublicEndpointRateLimit(request, "inbound-webhook", { perMin: 120, burst: 60 });
  if (rateLimited) return rateLimited;

  const rawBody = await request.text();
  const auth = verifyInboundWebhookAuth(
    new Request(request.url, { method: request.method, headers: request.headers }),
    rawBody,
    authOpts,
  );
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error, code: auth.code }, { status: auth.status });
  }

  try {
    const body = JSON.parse(rawBody) as Parameters<typeof parseInboundWebhookBody>[0];
    const parsed = parseInboundWebhookBody(body);
    const { processInboundPostmarkEmail } = await import("@/lib/email-inbound.server");
    const result = await processInboundPostmarkEmail({
      from: parsed.from,
      subject: parsed.subject,
      externalId: parsed.externalId,
      mailboxHash: parsed.mailboxHash,
      attachments: parsed.attachments,
    });
    return Response.json({ ok: true, status: result.status, detail: result.detail }, { status: 200 });
  } catch (err) {
    const exposeDetail = process.env.NODE_ENV !== "production";
    return Response.json(
      {
        ok: false,
        error: exposeDetail && err instanceof Error ? err.message : "processing_failed",
        code: "processing_failed",
      },
      { status: 500 },
    );
  }
}
