import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useOrg, canEdit } from "@/hooks/use-org";
import { listPdfIngestDrafts, rejectPdfDraft } from "@/lib/pdf-ingest.functions";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileScan, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/_dash/datasets/pdf-reviews")({
  component: PdfReviewsPage,
});

function statusLabel(status: string): string {
  switch (status) {
    case "processing":
      return "Discovering";
    case "pending_structure":
      return "Structure";
    case "extracting":
      return "Loading data";
    case "pending_review":
      return "Ready";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "processing":
    case "extracting":
      return "border-amber-500/40 bg-amber-500/10 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400";
    case "failed":
      return "border-destructive/40 bg-destructive/10 text-[10px] uppercase tracking-wide text-destructive";
    case "pending_structure":
      return "border-sky-500/40 bg-sky-500/10 text-[10px] uppercase tracking-wide text-sky-700 dark:text-sky-400";
    default:
      return "border-primary/40 bg-primary/10 text-[10px] uppercase tracking-wide text-primary";
  }
}

function ctaLabel(status: string): string {
  switch (status) {
    case "processing":
    case "extracting":
      return "Open job";
    case "pending_structure":
      return "Curate structure";
    case "pending_review":
      return "Review & publish";
    default:
      return "Open";
  }
}

function PdfReviewsPage() {
  const { currentOrg, role } = useOrg();
  const orgId = currentOrg?.id;
  const [rejecting, setRejecting] = useState<string | null>(null);

  const drafts = useQuery({
    queryKey: ["pdf-ingest-drafts", orgId],
    enabled: !!orgId && canEdit(role),
    queryFn: async () => {
      const rows = await listPdfIngestDrafts({ data: { orgId: orgId! } });
      return rows;
    },
    refetchInterval: (q) =>
      q.state.data?.some((d) => d.status === "processing" || d.status === "extracting")
        ? 3000
        : false,
  });

  async function onReject(draftId: string) {
    if (!orgId) return;
    setRejecting(draftId);
    try {
      await rejectPdfDraft({ data: { orgId, draftId, reason: "Rejected from PDF reviews queue" } });
      toast.success("PDF draft rejected");
      await drafts.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reject draft");
    } finally {
      setRejecting(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="PDF reviews"
        description="Structure-first PDF jobs: curate table layout, load data, then publish as an API."
        backTo="/datasets"
        backLabel="Datasets"
        crumbs={[{ label: "Datasets", to: "/datasets" }, { label: "PDF reviews" }]}
      />

      {!canEdit(role) ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            You need editor access to review PDF ingest drafts.
          </CardContent>
        </Card>
      ) : drafts.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : drafts.data && drafts.data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {drafts.data.map((d) => (
            <Card key={d.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
                      <FileScan className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium">{d.file_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.source} · {d.table_count ?? d.sheet_count} table
                        {(d.table_count ?? d.sheet_count) === 1 ? "" : "s"}
                        {d.page_count != null ? ` · ${d.page_count} pages` : ""}
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline" className={statusBadgeClass(d.status)}>
                    {statusLabel(d.status)}
                  </Badge>
                </div>
                {(d.status === "processing" || d.status === "extracting") && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {d.status === "extracting"
                      ? "Loading full table data…"
                      : "Discovering table structure…"}
                  </p>
                )}
                {d.status === "failed" && d.parse_error && (
                  <p className="text-xs text-destructive">{d.parse_error}</p>
                )}
                {d.ai_model && (
                  <p className="text-xs text-muted-foreground">Model: {d.ai_model}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {d.status !== "failed" ? (
                    <Button size="sm" asChild>
                      <Link to="/datasets/new" search={{ pdfDraftId: d.id }}>
                        {ctaLabel(d.status)}
                      </Link>
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={rejecting === d.id}
                    onClick={() => onReject(d.id)}
                  >
                    {rejecting === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reject"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No PDF drafts awaiting review. Upload a PDF, email one to ingest, or pull via a connector.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
