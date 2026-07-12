import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { safeTokenEqual } from "@/lib/token-compare.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function authorize(request: Request): boolean {
  const token = request.headers.get("x-worker-token") ?? "";
  const expected = process.env.WORKER_INGEST_TOKEN ?? "";
  return Boolean(expected) && safeTokenEqual(token, expected);
}

const schema = z.object({
  connector_id: z.string().uuid(),
  file_name: z.string().min(1).max(255),
  content_base64: z.string().min(1),
  run_id: z.string().uuid().optional(),
});

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Companion worker uploads a discovered file here. The portal parses it
 * server-side and publishes a new version of the connector's target dataset.
 */
export const Route = createFileRoute("/api/public/worker/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorize(request)) return json({ error: "Unauthorized" }, 401);
        const parsed = schema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return json({ error: "Invalid payload", details: parsed.error.flatten() }, 400);
        const body = parsed.data;

        try {
          const { ingestFileForConnector } = await import("@/lib/worker-ingest.server");
          const result = await ingestFileForConnector({
            connectorId: body.connector_id,
            fileName: body.file_name,
            bytes: base64ToArrayBuffer(body.content_base64),
          });

          if (body.run_id) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const statusNote = result.pendingPdfReview
              ? `PDF staged for review (${result.pdfDraftId})`
              : undefined;
            await supabaseAdmin
              .from("connector_runs")
              .update({
                files_ingested: result.pendingPdfReview ? 0 : 1,
                status: "success",
                finished_at: new Date().toISOString(),
                ...(statusNote ? { error: statusNote } : {}),
              })
              .eq("id", body.run_id);
          }

          return json({ ok: true, ...result });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Ingestion failed";
          return json({ error: message }, 400);
        }
      },
    },
  },
});
