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
  /** Full recipient address when the gateway provides it (preferred for routing). */
  originalRecipient?: string;
  toAddress?: string;
  attachments: { name: string; contentType: string; contentBase64: string }[];
};

/** Standard inbound JSON (Postmark-compatible field names). */
export function parseInboundWebhookBody(body: {
  From?: string;
  FromFull?: { Email?: string };
  Subject?: string;
  MessageID?: string;
  MailboxHash?: string;
  OriginalRecipient?: string;
  To?: string;
  ToFull?: { Email?: string };
  Attachments?: { Name?: string; Content?: string; ContentType?: string }[];
}): InboundWebhookPayload {
  const from =
    body.FromFull?.Email?.trim().toLowerCase() ??
    body.From?.trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1") ??
    "";

  const toAddress =
    body.ToFull?.Email?.trim().toLowerCase() ??
    body.To?.trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1") ??
    undefined;

  const originalRecipient = body.OriginalRecipient?.trim().toLowerCase() || undefined;

  return {
    from,
    subject: body.Subject ?? "",
    externalId: body.MessageID ?? undefined,
    mailboxHash: body.MailboxHash?.trim().toLowerCase() || undefined,
    originalRecipient,
    toAddress: toAddress || undefined,
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
      originalRecipient: parsed.originalRecipient,
      toAddress: parsed.toAddress,
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
