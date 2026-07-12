import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState, useEffect } from "react";
import { useOrg, canEdit, isContributor } from "@/hooks/use-org";
import { parseWorkbook, detectPii, type ParsedWorkbook, MAX_ROWS_PER_SHEET } from "@/lib/spreadsheet";
import { isPdfFileName, type PdfParseConfidence } from "@/lib/ingest-file-types";
import { publishDataset } from "@/lib/publish.functions";
import { getPdfIngestDraftFn, startPdfIngest, publishPdfDraft, approvePdfStructureFn } from "@/lib/pdf-ingest.functions";
import {
  includedStructureTables,
  normalizeStructureSnapshot,
  PDF_STRUCTURE_SAMPLE_ROWS,
  type PdfStructureSnapshot,
  type PdfStructureTable,
} from "@/lib/pdf-structure";
import type { PublishField } from "@/lib/publish";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toUserFacingMessage } from "@/lib/user-facing-error";
import {
  UploadCloud,
  FileSpreadsheet,
  Loader2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Check,
  FileScan,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/datasets/new")({
  validateSearch: (s: Record<string, unknown>) => ({
    datasetId: typeof s.datasetId === "string" ? s.datasetId : undefined,
    pdfDraftId: typeof s.pdfDraftId === "string" ? s.pdfDraftId : undefined,
  }),
  component: NewDatasetWizard,
});

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

type SheetState = { name: string; included: boolean };

const EXCEL_STEPS = ["Upload", "Sheets", "Fields", "Load mode", "Review"];
const PDF_STEPS = ["Upload", "Structure", "Data", "Fields", "Load mode", "Review"];

export const HASH_ALGOS: { value: NonNullable<PublishField["hash_algo"]>; label: string }[] = [
  { value: "sha256", label: "SHA-256" },
  { value: "sha512", label: "SHA-512" },
  { value: "sha3_256", label: "SHA3-256" },
  { value: "sha3_512", label: "SHA3-512" },
  { value: "hmac_sha256", label: "HMAC-SHA256" },
  { value: "hmac_sha512", label: "HMAC-SHA512" },
];

function NewDatasetWizard() {
  const navigate = useNavigate();
  const { datasetId: existingDatasetId, pdfDraftId: searchDraftId } = Route.useSearch();
  const { currentOrg, role } = useOrg();
  const [step, setStep] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [wb, setWb] = useState<ParsedWorkbook | null>(null);
  const [sheets, setSheets] = useState<SheetState[]>([]);
  const [fields, setFields] = useState<PublishField[]>([]);
  const [loadMode, setLoadMode] = useState<"full" | "incremental">("full");
  const [apiAccess, setApiAccess] = useState<"secure" | "public">("secure");
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [maxUploadBytes, setMaxUploadBytes] = useState(52_428_800);
  const [maxRowsPerSheet, setMaxRowsPerSheet] = useState(MAX_ROWS_PER_SHEET);
  const [pdfDraftId, setPdfDraftId] = useState<string | null>(searchDraftId ?? null);
  const [pdfConfidence, setPdfConfidence] = useState<PdfParseConfidence | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);

  const [pdfJobStatus, setPdfJobStatus] = useState<"idle" | "processing" | "failed">("idle");
  const [pdfJobError, setPdfJobError] = useState<string | null>(null);
  const [pdfStructure, setPdfStructure] = useState<PdfStructureSnapshot | null>(null);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templatePattern, setTemplatePattern] = useState("*.pdf");
  const [approvingStructure, setApprovingStructure] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{
    percent: number;
    label: string;
  } | null>(null);

  const isPdfWizard = Boolean(pdfDraftId || pdfStructure);
  const STEPS = isPdfWizard ? PDF_STEPS : EXCEL_STEPS;
  const lastStep = STEPS.length - 1;

  useEffect(() => {
    if (!currentOrg?.id) return;
    void supabase
      .from("organizations")
      .select("max_upload_bytes, max_rows_per_sheet")
      .eq("id", currentOrg.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.max_upload_bytes) setMaxUploadBytes(data.max_upload_bytes);
        const rows = (data as { max_rows_per_sheet?: number } | null)?.max_rows_per_sheet;
        if (rows && rows > 0) setMaxRowsPerSheet(rows);
      });
  }, [currentOrg?.id]);

  const applyParsedWorkbook = useCallback(
    (
      parsed: ParsedWorkbook,
      confidence: PdfParseConfidence | null | undefined,
      opts?: { toastOk?: boolean; goToStep?: number },
    ) => {
      const nonEmpty = parsed.sheets.filter((s) => s.headers.length > 0);
      if (nonEmpty.length === 0) {
        toast.error("No readable content found in this PDF.");
        return false;
      }
      setPdfConfidence(confidence ?? null);
      setWb(parsed);
      setName((prev) => prev || parsed.fileName.replace(/\.[^.]+$/, ""));
      setSheets(nonEmpty.map((s, i) => ({ name: s.name, included: i === 0 || nonEmpty.length === 1 })));
      setActiveSheet(nonEmpty[0]!.name);
      let flaggedCount = 0;
      setFields(
        nonEmpty.flatMap((s) =>
          s.headers.map((h, idx) => {
            const samples = s.rows.slice(0, 20).map((r) => r[h.api_name]);
            const pii = detectPii(h.api_name, h.original_name, samples);
            if (pii.isPii) flaggedCount++;
            return {
              source_key: h.api_name,
              sheet_name: s.name,
              original_name: h.original_name,
              api_name: h.api_name,
              data_type: h.data_type,
              nullable: true,
              is_pii: pii.isPii,
              masking: pii.masking,
              hash_algo: "hmac_sha256" as const,
              included: true,
              position: idx,
            };
          }),
        ),
      );
      if (flaggedCount > 0) {
        toast.warning(
          `Auto-flagged ${flaggedCount} field${flaggedCount === 1 ? "" : "s"} as sensitive (PII). Review masking on the Fields step.`,
        );
      }
      const textFallback = (confidence?.sheets ?? []).some((s) =>
        (s.flags ?? []).some(
          (f) => f === "text_fallback" || f === "needs_human_curation" || f === "ai_provider_failed",
        ),
      );
      if (opts?.toastOk !== false) {
        if (textFallback) {
          toast.warning(
            "AI could not structure this PDF cleanly — we loaded the extracted text for you to review and edit before publishing.",
          );
        } else {
          toast.message("Table data loaded — review fields before publishing.");
        }
      }
      setStep(opts?.goToStep ?? 1);
      setPdfJobStatus("idle");
      setPdfJobError(null);
      return true;
    },
    [],
  );

  const applyStructure = useCallback(
    (structure: PdfStructureSnapshot, confidence?: PdfParseConfidence | null) => {
      const normalized = normalizeStructureSnapshot(structure);
      setPdfStructure(normalized);
      setPdfConfidence(confidence ?? null);
      setName((prev) => prev || "PDF dataset");
      if (!templateName) {
        setTemplateName(`${normalized.tables[0]?.name ?? "PDF"} layout`);
      }
      setStep(1);
      setPdfJobStatus("idle");
      setPdfJobError(null);
      toast.message("Review the discovered table structure — samples only. Approve to load full data.");
      setPdfJobError(null);
    },
    [templateName],
  );

  const waitForPdfDraft = useCallback(
    async (
      orgId: string,
      draftId: string,
      until: "pending_structure" | "pending_review" = "pending_structure",
      onProgress?: (info: { percent: number; label: string; status: string }) => void,
    ) => {
      const started = Date.now();
      const deadline = started + 15 * 60 * 1000;
      while (Date.now() < deadline) {
        const draft = await getPdfIngestDraftFn({ data: { orgId, draftId } });
        const elapsed = Date.now() - started;
        const status = draft.status;

        if (until === "pending_structure" && status === "pending_structure") {
          onProgress?.({ percent: 100, label: "Structure ready", status });
          return draft;
        }
        if (until === "pending_review" && status === "pending_review") {
          onProgress?.({ percent: 100, label: "Data loaded", status });
          return draft;
        }
        if (until === "pending_structure" && status === "pending_review") {
          onProgress?.({ percent: 100, label: "Ready", status });
          return draft;
        }
        // Extract failed → structure restored for retry
        if (
          until === "pending_review" &&
          status === "pending_structure" &&
          draft.parse_error
        ) {
          throw new Error(draft.parse_error);
        }
        if (status === "failed") {
          throw new Error(draft.parse_error || "PDF parsing failed");
        }
        if (status === "accepted" || status === "rejected") {
          throw new Error(`This PDF draft is ${status}.`);
        }

        let percent = 8;
        let label = "Queued…";
        if (status === "processing") {
          percent = Math.min(85, 12 + Math.floor(elapsed / 800));
          label = "Discovering table structure…";
        } else if (status === "extracting") {
          percent = Math.min(92, 20 + Math.floor(elapsed / 600));
          label = "Loading full table rows…";
        } else if (status === "pending_structure" && until === "pending_review") {
          percent = 15;
          label = "Starting data extract…";
        }
        onProgress?.({ percent, label, status });

        await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error(
        "Still working after 15 minutes. You can leave — check Datasets → PDF reviews when it finishes.",
      );
    },
    [],
  );

  useEffect(() => {
    if (!currentOrg?.id || !searchDraftId || draftHydrated) return;
    let cancelled = false;
    setParsing(true);
    setPdfDraftId(searchDraftId);
    setPdfJobStatus("processing");

    void (async () => {
      try {
        let draft = await getPdfIngestDraftFn({
          data: { orgId: currentOrg.id, draftId: searchDraftId },
        });
        if (cancelled) return;

        if (draft.status === "processing") {
          toast.message("Discovering PDF table structure…");
          draft = await waitForPdfDraft(currentOrg.id, searchDraftId, "pending_structure");
          if (cancelled) return;
        }

        if (draft.status === "extracting") {
          toast.message("Loading full table data from PDF…");
          draft = await waitForPdfDraft(currentOrg.id, searchDraftId, "pending_review");
          if (cancelled) return;
        }

        if (draft.status === "failed") {
          setPdfJobStatus("failed");
          setPdfJobError(draft.parse_error || "PDF parsing failed");
          toast.error(draft.parse_error || "PDF parsing failed");
          setDraftHydrated(true);
          return;
        }

        if (draft.status === "pending_structure" && draft.structure_snapshot) {
          applyStructure(
            draft.structure_snapshot as PdfStructureSnapshot,
            draft.confidence as PdfParseConfidence,
          );
          if (draft.parse_error) {
            setPdfJobError(draft.parse_error);
            toast.error(draft.parse_error);
          }
          setDraftHydrated(true);
          return;
        }

        if (draft.status === "pending_review" && draft.parsed_workbook) {
          if (draft.structure_snapshot) {
            setPdfStructure(normalizeStructureSnapshot(draft.structure_snapshot as PdfStructureSnapshot));
          }
          applyParsedWorkbook(draft.parsed_workbook, draft.confidence as PdfParseConfidence, {
            goToStep: 2,
          });
          setDraftHydrated(true);
          return;
        }

        toast.error("This PDF draft is not ready for review.");
        setDraftHydrated(true);
      } catch (err) {
        if (!cancelled) {
          setPdfJobStatus("failed");
          setPdfJobError(toUserFacingMessage(err, "Failed to load PDF draft"));
          toast.error(toUserFacingMessage(err, "Failed to load PDF draft"));
        }
        setDraftHydrated(true);
      } finally {
        if (!cancelled) setParsing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentOrg?.id, searchDraftId, draftHydrated, applyParsedWorkbook, applyStructure, waitForPdfDraft]);

  const onFile = useCallback(
    async (file: File) => {
      if (file.size > maxUploadBytes) {
        toast.error(
          `File exceeds organization limit (${Math.round(maxUploadBytes / 1024 / 1024)} MB). Contact an admin to raise the cap.`,
        );
        return;
      }
      setParsing(true);
      try {
        if (isPdfFileName(file.name)) {
          if (!currentOrg?.id) throw new Error("Select an organization first");
          const loadingId = toast.loading("Discovering structure… 5%");
          try {
            const fileBase64 = await fileToBase64(file);
            const started = await startPdfIngest({
              data: {
                orgId: currentOrg.id,
                fileName: file.name,
                fileBase64,
                source: "upload",
                targetDatasetId: existingDatasetId,
              },
            });
            setPdfDraftId(started.draftId);
            setPdfJobStatus("processing");
            setSourceFile(file);
            if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
            void navigate({
              to: "/datasets/new",
              search: { datasetId: existingDatasetId, pdfDraftId: started.draftId },
              replace: true,
            });
            const draft = await waitForPdfDraft(
              currentOrg.id,
              started.draftId,
              "pending_structure",
              ({ percent, label }) => {
                toast.loading(`${label} ${percent}%`, { id: loadingId });
              },
            );
            if (draft.status === "pending_structure" && draft.structure_snapshot) {
              applyStructure(
                draft.structure_snapshot as PdfStructureSnapshot,
                draft.confidence as PdfParseConfidence,
              );
              toast.dismiss(loadingId);
              toast.success("Structure mapped — review tables, then approve to load data.");
              return;
            }
            if (draft.status === "pending_review" && draft.parsed_workbook) {
              applyParsedWorkbook(draft.parsed_workbook, draft.confidence as PdfParseConfidence, {
                goToStep: 2,
                toastOk: false,
              });
              toast.dismiss(loadingId);
              toast.success("PDF ready for review.");
              return;
            }
            throw new Error("PDF draft has no structure yet");
          } catch (err) {
            setPdfJobStatus("failed");
            setPdfJobError(toUserFacingMessage(err, "Failed to parse PDF"));
            toast.dismiss(loadingId);
            toast.error(toUserFacingMessage(err, "Failed to parse PDF"));
            return;
          }
        }

        setPdfDraftId(null);
        setPdfConfidence(null);
        setPdfJobStatus("idle");
        const parsed = await parseWorkbook(file, { maxRowsPerSheet });
        const nonEmpty = parsed.sheets.filter((s) => s.headers.length > 0);
        if (nonEmpty.length === 0) {
          toast.error("No readable sheets found in this file.");
          return;
        }
        setWb(parsed);
        setSourceFile(file);
        if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
        setSheets(nonEmpty.map((s, i) => ({ name: s.name, included: i === 0 || nonEmpty.length === 1 })));
        setActiveSheet(nonEmpty[0].name);
        let flaggedCount = 0;
        setFields(
          nonEmpty.flatMap((s) =>
            s.headers.map((h, idx) => {
              const samples = s.rows.slice(0, 20).map((r) => r[h.api_name]);
              const pii = detectPii(h.api_name, h.original_name, samples);
              if (pii.isPii) flaggedCount++;
              return {
                source_key: h.api_name,
                sheet_name: s.name,
                original_name: h.original_name,
                api_name: h.api_name,
                data_type: h.data_type,
                nullable: true,
                is_pii: pii.isPii,
                masking: pii.masking,
                hash_algo: "hmac_sha256" as const,
                included: true,
                position: idx,
              };
            }),
          ),
        );
        if (flaggedCount > 0) {
          toast.warning(
            `Auto-flagged ${flaggedCount} field${flaggedCount === 1 ? "" : "s"} as sensitive (PII). Review masking on the Fields step.`,
          );
        }
        if (parsed.hasMacros) {
          toast.warning("This file contains macros (VBA). Macros are never executed — only data is parsed.");
        }
        if (parsed.sheets.some((s) => s.truncated)) {
          toast.warning(
            `One or more sheets exceeded the ${maxRowsPerSheet.toLocaleString()} row limit and were truncated.`,
          );
        }
        setStep(1);
      } catch (err) {
        toast.error(toUserFacingMessage(err, "Failed to parse file"));
      } finally {
        setParsing(false);
      }
    },
    [
      name,
      maxUploadBytes,
      maxRowsPerSheet,
      currentOrg?.id,
      existingDatasetId,
      navigate,
      applyParsedWorkbook,
      applyStructure,
      waitForPdfDraft,
    ],
  );

  async function handleApproveStructure() {
    if (!currentOrg?.id || !pdfDraftId || !pdfStructure) return;
    const included = includedStructureTables(pdfStructure);
    if (included.length === 0) {
      toast.error("Include at least one table with columns.");
      return;
    }
    if (saveAsTemplate && !templateName.trim()) {
      toast.error("Give the PDF template a name, or turn off Save as template.");
      return;
    }
    setApprovingStructure(true);
    setParsing(true);
    setPdfJobStatus("processing");
    setPdfJobError(null);
    setExtractProgress({ percent: 5, label: "Saving approved structure…" });
    const toastId = toast.loading("Starting data load… 5%");
    try {
      await approvePdfStructureFn({
        data: {
          orgId: currentOrg.id,
          draftId: pdfDraftId,
          structure: pdfStructure,
          saveTemplate: saveAsTemplate
            ? {
                name: templateName.trim(),
                fileNamePattern: templatePattern.trim() || "*.pdf",
                description: "Saved from PDF wizard for recurring SFTP/folder ingest",
              }
            : null,
        },
      });
      if (saveAsTemplate) {
        toast.message(`Template "${templateName.trim()}" saved for recurring PDFs.`);
      }
      setExtractProgress({ percent: 18, label: "Extract job started…" });
      toast.loading("Extracting table data… 18%", { id: toastId });

      const draft = await waitForPdfDraft(
        currentOrg.id,
        pdfDraftId,
        "pending_review",
        ({ percent, label }) => {
          setExtractProgress({ percent, label });
          toast.loading(`${label} ${percent}%`, { id: toastId });
        },
      );
      if (!draft.parsed_workbook) throw new Error("No data loaded from PDF");

      const flags = (draft.confidence as PdfParseConfidence | null)?.sheets?.flatMap((s) => s.flags ?? []) ?? [];
      const weak =
        flags.some((f) => f === "extract_failed_used_samples" || f === "ai_provider_failed") ||
        draft.ai_model === "text-fallback";

      applyParsedWorkbook(draft.parsed_workbook, draft.confidence as PdfParseConfidence, {
        goToStep: 2,
        toastOk: false,
      });
      setExtractProgress({ percent: 100, label: "Done" });
      toast.dismiss(toastId);
      if (weak) {
        toast.warning(
          "Data load finished with low confidence — review row counts carefully before publishing.",
        );
      } else {
        const rows = draft.parsed_workbook.sheets.reduce((n, s) => n + (s.rowCount ?? 0), 0);
        toast.success(`Data loaded — ${rows.toLocaleString()} row${rows === 1 ? "" : "s"} ready. Continue to Fields.`);
      }
      setPdfJobStatus("idle");
    } catch (err) {
      setPdfJobStatus("failed");
      const msg = toUserFacingMessage(err, "Failed to load PDF data");
      setPdfJobError(msg);
      setExtractProgress(null);
      toast.dismiss(toastId);
      toast.error(msg);
      // Stay on Structure so the user can retry Approve.
      setStep(1);
    } finally {
      setApprovingStructure(false);
      setParsing(false);
      window.setTimeout(() => setExtractProgress(null), 1200);
    }
  }

  function updateStructureTable(tableId: string, patch: Partial<PdfStructureTable>) {
    setPdfStructure((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tables: prev.tables.map((t) => (t.id === tableId ? { ...t, ...patch } : t)),
      };
    });
  }

  function updateStructureHeader(
    tableId: string,
    headerIdx: number,
    patch: Partial<PdfStructureTable["headers"][number]>,
  ) {
    setPdfStructure((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tables: prev.tables.map((t) => {
          if (t.id !== tableId) return t;
          return {
            ...t,
            headers: t.headers.map((h, i) => (i === headerIdx ? { ...h, ...patch } : h)),
          };
        }),
      };
    });
  }

  const includedSheetNames = useMemo(
    () => sheets.filter((s) => s.included).map((s) => s.name),
    [sheets],
  );

  function updateField(idx: number, patch: Partial<PublishField>) {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }

  async function handlePublish() {
    if (!currentOrg) return;
    if (!name.trim()) {
      toast.error("Give your dataset a name.");
      setStep(0);
      return;
    }
    if (loadMode === "incremental") {
      const missingKey = includedSheetNames.some(
        (sn) => !fields.some((f) => f.sheet_name === sn && f.included && f.is_key),
      );
      if (missingKey) {
        toast.error("Select a key column for each sheet when using incremental load mode.");
        setStep(3);
        return;
      }
    }
    setPublishing(true);
    try {
      const sheetRows = (wb?.sheets ?? []).map((s) => ({
        name: s.name,
        included: includedSheetNames.includes(s.name),
        rows: s.rows,
      }));

      if (pdfDraftId) {
        const { datasetId } = await publishPdfDraft({
          data: {
            orgId: currentOrg.id,
            draftId: pdfDraftId,
            datasetId: existingDatasetId,
            name: name.trim(),
            description: description.trim() || undefined,
            fields,
            sheets: sheetRows,
            loadMode,
            apiAccess: existingDatasetId ? undefined : isContributor(role) ? "secure" : apiAccess,
          },
        });
        toast.success("Dataset published from PDF! Your API is live.");
        navigate({ to: "/datasets/$datasetId", params: { datasetId } });
        return;
      }

      let fileBase64: string | undefined;
      if (sourceFile) {
        fileBase64 = await fileToBase64(sourceFile);
      }
      const { datasetId } = await publishDataset({
        data: {
          orgId: currentOrg.id,
          datasetId: existingDatasetId,
          name: name.trim(),
          description: description.trim() || undefined,
          fields,
          sheets: sheetRows,
          loadMode,
          hasMacros: wb?.hasMacros ?? false,
          fileName: wb?.fileName ?? sourceFile?.name ?? "upload",
          apiAccess: existingDatasetId ? undefined : isContributor(role) ? "secure" : apiAccess,
          fileBase64,
        },
      });
      toast.success("Dataset published! Your API is live.");
      navigate({ to: "/datasets/$datasetId", params: { datasetId } });
    } catch (err) {
      toast.error(toUserFacingMessage(err, "Failed to publish dataset"));
    } finally {
      setPublishing(false);
    }
  }

  if (!canEdit(role)) {
    return (
      <div>
        <PageHeader
          title="New dataset"
          backTo="/datasets"
          backLabel="Datasets"
          crumbs={[{ label: "Datasets", to: "/datasets" }, { label: "New" }]}
        />
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            You need member, admin, or owner access to create datasets.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="New dataset"
        description={
          isPdfWizard
            ? "Discover PDF table structure, approve it, then load data and publish an API."
            : "Turn a spreadsheet into a live REST API in five steps."
        }
        backTo="/datasets"
        backLabel="Datasets"
        crumbs={[{ label: "Datasets", to: "/datasets" }, { label: "New" }]}
      />

      {/* Stepper */}
      <div className="mb-8 flex items-center">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border text-sm font-medium",
                  i < step && "border-primary bg-primary text-primary-foreground",
                  i === step && "border-primary text-primary",
                  i > step && "border-border text-muted-foreground",
                )}
              >
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span className={cn("hidden text-sm sm:inline", i === step ? "font-medium" : "text-muted-foreground")}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && <div className={cn("mx-3 h-px flex-1", i < step ? "bg-primary" : "bg-border")} />}
          </div>
        ))}
      </div>

      {/* Step 0: Upload */}
      {step === 0 && (
        <Card>
          <CardContent className="space-y-6 p-6">
            <div className="space-y-1.5">
              <Label htmlFor="ds-name">Dataset name</Label>
              <Input id="ds-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 Inventory" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ds-desc">Description (optional)</Label>
              <Textarea id="ds-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this data represents…" />
            </div>
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/30 p-12 text-center transition-colors hover:border-primary/50 hover:bg-accent/20"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) onFile(f);
              }}
            >
              {parsing ? (
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              ) : (
                <UploadCloud className="h-8 w-8 text-primary" />
              )}
              <div>
                <div className="font-medium">
                  {parsing
                    ? pdfJobStatus === "processing"
                      ? "Discovering PDF structure…"
                      : "Reading file…"
                    : "Drop Excel, CSV, or PDF"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {parsing
                    ? "Safe to refresh or leave — reopen this link or Datasets → PDF reviews when ready."
                    : ".xlsx, .xls, .csv, .pdf — PDFs map structure first (samples only), then load data after you approve"}
                </div>
                {pdfJobError ? (
                  <p className="mt-2 text-sm text-destructive">{pdfJobError}</p>
                ) : null}
                {pdfDraftId && parsing ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Job id: <code className="font-mono">{pdfDraftId.slice(0, 8)}…</code>
                  </p>
                ) : null}
              </div>
              <input
                type="file"
                accept=".xlsx,.xls,.xlsm,.csv,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
            </label>
          </CardContent>
        </Card>
      )}

      {/* Step 1 (PDF): Structure curation */}
      {isPdfWizard && step === 1 && pdfStructure && (
        <Card>
          <CardContent className="space-y-4 p-6">
            {extractProgress && (
              <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    {extractProgress.label}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{extractProgress.percent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                    style={{ width: `${extractProgress.percent}%` }}
                  />
                </div>
              </div>
            )}
            {pdfJobError && !extractProgress && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {pdfJobError}
                <p className="mt-1 text-xs text-muted-foreground">
                  Your structure is still here — adjust columns if needed, then try Approve & load data again.
                </p>
              </div>
            )}
            <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              <FileScan className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <p className="font-medium text-foreground">Structure only — not full data yet</p>
                <p className="text-muted-foreground">
                  AI mapped columns from the start of the PDF only (first page(s), small text sample)
                  {pdfStructure.page_count ? ` · document reports ~${pdfStructure.page_count} page(s)` : ""}.
                  Include the grids you want, then approve to load all rows.
                  {pdfConfidence?.model ? ` · model ${pdfConfidence.model}` : ""}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {pdfStructure.tables.map((table) => (
                <div key={table.id} className="rounded-lg border border-border p-4 space-y-3">
                  <label className="flex items-center gap-3">
                    <Checkbox
                      checked={table.included}
                      onCheckedChange={(v) => updateStructureTable(table.id, { included: !!v })}
                    />
                    <Input
                      value={table.name}
                      onChange={(e) => updateStructureTable(table.id, { name: e.target.value })}
                      className="h-8 max-w-sm font-medium"
                      disabled={!table.included}
                    />
                    {typeof table.confidence === "number" && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        {Math.round(table.confidence * 100)}%
                      </Badge>
                    )}
                    {table.page_hint != null && (
                      <span className="text-xs text-muted-foreground">page ~{table.page_hint}</span>
                    )}
                  </label>
                  {table.included && (
                    <>
                      <div className="space-y-2 pl-8">
                        {table.headers.map((h, hi) => (
                          <div key={`${table.id}-${hi}`} className="flex flex-wrap items-center gap-2">
                            <Checkbox
                              checked={h.included}
                              onCheckedChange={(v) =>
                                updateStructureHeader(table.id, hi, { included: !!v })
                              }
                            />
                            <Input
                              value={h.original_name}
                              onChange={(e) =>
                                updateStructureHeader(table.id, hi, { original_name: e.target.value })
                              }
                              className="h-8 w-40 text-xs"
                              placeholder="Header"
                            />
                            <Input
                              value={h.api_name}
                              onChange={(e) =>
                                updateStructureHeader(table.id, hi, { api_name: e.target.value })
                              }
                              className="h-8 w-40 font-mono text-xs"
                              placeholder="api_name"
                            />
                          </div>
                        ))}
                      </div>
                      {table.sample_rows.length > 0 && (
                        <div className="overflow-x-auto rounded border border-border/60 bg-muted/20 p-2 text-xs">
                          <p className="mb-1 text-muted-foreground">Sample rows (preview only)</p>
                          <table className="w-full border-collapse">
                            <thead>
                              <tr>
                                {table.headers
                                  .filter((h) => h.included)
                                  .map((h) => (
                                    <th key={h.api_name} className="border-b px-2 py-1 text-left font-medium">
                                      {h.api_name}
                                    </th>
                                  ))}
                              </tr>
                            </thead>
                            <tbody>
                              {table.sample_rows.map((row, ri) => (
                                <tr key={ri}>
                                  {table.headers.map((h, hi) =>
                                    h.included ? (
                                      <td key={`${h.api_name}-${hi}`} className="px-2 py-1 text-muted-foreground">
                                        {String(Array.isArray(row) ? (row[hi] ?? "") : "")}
                                      </td>
                                    ) : null,
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <label className="flex items-center gap-3">
                <Checkbox checked={saveAsTemplate} onCheckedChange={(v) => setSaveAsTemplate(!!v)} />
                <div>
                  <div className="font-medium text-sm">Save as PDF template</div>
                  <div className="text-xs text-muted-foreground">
                    Reuse this layout for recurring files from folders or SFTP — ETL will know what is where.
                  </div>
                </div>
              </label>
              {saveAsTemplate && (
                <div className="grid gap-3 sm:grid-cols-2 pl-8">
                  <div className="space-y-1.5">
                    <Label htmlFor="tmpl-name">Template name</Label>
                    <Input
                      id="tmpl-name"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="Monthly KPI pack"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tmpl-pat">File name pattern</Label>
                    <Input
                      id="tmpl-pat"
                      value={templatePattern}
                      onChange={(e) => setTemplatePattern(e.target.value)}
                      placeholder="*kpi*.pdf"
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sheets (Excel step 1) / Data (PDF step 2) */}
      {((!isPdfWizard && step === 1) || (isPdfWizard && step === 2)) && wb && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-sm text-muted-foreground">
              {isPdfWizard
                ? "Full table data is loaded. Choose which tables to publish as API resources."
                : "Choose which tabs to publish. Each becomes its own API resource."}
            </p>
            {pdfDraftId && (
              <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <FileScan className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <p className="font-medium text-foreground">PDF data loaded from approved structure</p>
                  <p className="text-muted-foreground">
                    Confirm tables before continuing.
                    {pdfConfidence
                      ? ` Overall confidence: ${Math.round(pdfConfidence.overall * 100)}%`
                      : ""}
                    {pdfConfidence?.model ? ` · model ${pdfConfidence.model}` : ""}
                  </p>
                  {(wb.sheets.reduce((n, s) => n + s.rowCount, 0) <= PDF_STRUCTURE_SAMPLE_ROWS ||
                    (pdfConfidence?.sheets ?? []).some((s) =>
                      (s.flags ?? []).some((f) =>
                        ["fragment_only", "structure_only", "extract_failed_used_samples"].includes(f),
                      ),
                    )) && (
                    <p className="mt-2 text-destructive">
                      Only a few rows are loaded — this looks like structure samples, not the full
                      statement. Go Back to Structure and click Approve & load data again before
                      publishing.
                    </p>
                  )}
                </div>
              </div>
            )}
            {wb.hasMacros && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                <span>This workbook contains macros. Gridwire never executes macros — only cell data and computed values are imported.</span>
              </div>
            )}
            <div className="space-y-2">
              {wb.sheets.filter((s) => s.headers.length > 0).map((s) => {
                const checked = sheets.find((x) => x.name === s.name)?.included ?? false;
                const conf = pdfConfidence?.sheets.find((c) => c.sheetName === s.name);
                return (
                  <label key={s.name} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        setSheets((prev) => prev.map((x) => (x.name === s.name ? { ...x, included: !!v } : x)))
                      }
                    />
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        {s.name}
                        {conf && (
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                            {Math.round(conf.confidence * 100)}% confidence
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {s.headers.length} columns · {s.rowCount} rows{s.truncated ? " (truncated)" : ""}
                        {conf?.flags?.length ? ` · ${conf.flags.join(", ")}` : ""}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fields */}
      {((!isPdfWizard && step === 2) || (isPdfWizard && step === 3)) && wb && (
        <Card>
          <CardContent className="p-6">
            <Tabs value={activeSheet} onValueChange={setActiveSheet}>
              <TabsList className="mb-4 flex-wrap">
                {includedSheetNames.map((sn) => (
                  <TabsTrigger key={sn} value={sn}>{sn}</TabsTrigger>
                ))}
              </TabsList>
              {includedSheetNames.map((sn) => (
                <TabsContent key={sn} value={sn} className="space-y-2">
                  <div className="hidden grid-cols-[1fr_1fr_7rem_4rem_4rem_7rem_8rem] gap-2 px-2 text-xs font-medium text-muted-foreground md:grid">
                    <span>Original</span><span>API field</span><span>Type</span><span>PII</span><span>Nullable</span><span>Protection</span><span>Hash algo</span>
                  </div>
                  {fields.map((f, idx) =>
                    f.sheet_name === sn ? (
                      <div key={idx} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-border p-2 md:grid-cols-[1fr_1fr_7rem_4rem_4rem_7rem_8rem]">
                        <span className="truncate text-sm text-muted-foreground" title={f.original_name}>{f.original_name}</span>
                        <Input
                          value={f.api_name}
                          onChange={(e) => updateField(idx, { api_name: e.target.value })}
                          className="h-8 font-mono text-xs"
                        />
                        <Select value={f.data_type} onValueChange={(v) => updateField(idx, { data_type: v })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="string">string</SelectItem>
                            <SelectItem value="number">number</SelectItem>
                            <SelectItem value="boolean">boolean</SelectItem>
                            <SelectItem value="date">date</SelectItem>
                          </SelectContent>
                        </Select>
                        <Switch checked={f.is_pii} onCheckedChange={(v) => updateField(idx, { is_pii: v })} />
                        <Switch checked={f.nullable} onCheckedChange={(v) => updateField(idx, { nullable: v })} />
                        <Select value={f.masking} onValueChange={(v) => updateField(idx, { masking: v as PublishField["masking"] })}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">none</SelectItem>
                            <SelectItem value="mask">mask</SelectItem>
                            <SelectItem value="hash">hash</SelectItem>
                            <SelectItem value="encrypt">encrypt</SelectItem>
                          </SelectContent>
                        </Select>
                        {f.masking === "hash" ? (
                          <Select
                            value={f.hash_algo ?? "sha256"}
                            onValueChange={(v) => updateField(idx, { hash_algo: v as PublishField["hash_algo"] })}
                          >
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {HASH_ALGOS.map((a) => (
                                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-center text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    ) : null,
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Load mode */}
      {((!isPdfWizard && step === 3) || (isPdfWizard && step === 4)) && (
        <Card>
          <CardContent className="space-y-3 p-6">
            <p className="text-sm text-muted-foreground">How should future syncs from a connector update this data?</p>
            {([
              { id: "full", title: "Full load", desc: "Replace all rows on every sync. Best for snapshots and reference data." },
              { id: "incremental", title: "Incremental", desc: "Upsert changed/new rows on each sync. Best for growing transactional data." },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setLoadMode(opt.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors",
                  loadMode === opt.id ? "border-primary bg-primary/5" : "border-border hover:bg-accent/20",
                )}
              >
                <div className={cn("mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border", loadMode === opt.id ? "border-primary" : "border-muted-foreground")}>
                  {loadMode === opt.id && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
                </div>
                <div>
                  <div className="font-medium">{opt.title}</div>
                  <div className="text-sm text-muted-foreground">{opt.desc}</div>
                </div>
              </button>
            ))}
            {loadMode === "incremental" && (
              <div className="mt-4 space-y-3 rounded-lg border border-border p-4">
                <p className="text-sm font-medium">Key column for incremental upserts</p>
                <p className="text-xs text-muted-foreground">
                  Choose one unique identifier per sheet. New syncs merge rows that share the same key value.
                </p>
                {includedSheetNames.map((sn) => {
                  const sheetFields = fields.filter((f) => f.sheet_name === sn && f.included);
                  const currentKey = sheetFields.find((f) => f.is_key)?.api_name ?? "";
                  return (
                    <div key={sn} className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-medium">{sn}</span>
                      <Select
                        value={currentKey}
                        onValueChange={(apiName) => {
                          setFields((prev) =>
                            prev.map((f) => ({
                              ...f,
                              is_key: f.sheet_name === sn ? f.api_name === apiName : f.is_key,
                            })),
                          );
                        }}
                      >
                        <SelectTrigger className="w-56"><SelectValue placeholder="Select key column" /></SelectTrigger>
                        <SelectContent>
                          {sheetFields.map((f) => (
                            <SelectItem key={f.api_name} value={f.api_name}>{f.api_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Review */}
      {((!isPdfWizard && step === 4) || (isPdfWizard && step === 5)) && wb && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Name" value={name} />
              <Stat label="Sheets" value={String(includedSheetNames.length)} />
              <Stat label="Fields" value={String(fields.filter((f) => f.included && includedSheetNames.includes(f.sheet_name)).length)} />
              <Stat label="Load mode" value={loadMode} />
            </div>
            <div className="space-y-2">
              {includedSheetNames.map((sn) => (
                <div key={sn} className="rounded-lg border border-border p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-primary" />
                    <span className="font-medium">{sn}</span>
                    <Badge variant="secondary" className="ml-auto">
                      {wb.sheets.find((s) => s.name === sn)?.rowCount ?? 0} rows
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {fields.filter((f) => f.sheet_name === sn && f.included).map((f, i) => (
                      <span key={i} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {f.api_name}
                        {f.masking !== "none" && <span className="text-warning"> ·{f.masking}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {!existingDatasetId && (
              <div className="space-y-2">
                <Label>API access</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    { id: "secure", title: "Secure", desc: "Requires an API key (Bearer token) to read. Recommended." },
                    { id: "public", title: "Public", desc: "Anyone with the URL can read. Use only for non-sensitive open data." },
                  ] as const)
                    .filter((opt) => !(isContributor(role) && opt.id === "public"))
                    .map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setApiAccess(opt.id)}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                        apiAccess === opt.id ? "border-primary bg-primary/5" : "border-border hover:bg-accent/20",
                      )}
                    >
                      <div className={cn("mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border", apiAccess === opt.id ? "border-primary" : "border-muted-foreground")}>
                        {apiAccess === opt.id && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
                      </div>
                      <div>
                        <div className="font-medium">{opt.title}</div>
                        <div className="text-sm text-muted-foreground">{opt.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
                {isContributor(role) && (
                  <p className="text-xs text-muted-foreground">
                    Contributor uploads are always secure — accessible only with an API token.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Nav */}
      {step > 0 && (
        <div className="mt-6 flex justify-between">
          <Button
            variant="outline"
            onClick={() => setStep((s) => s - 1)}
            disabled={publishing || approvingStructure || parsing}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {isPdfWizard && step === 1 ? (
            <Button onClick={() => void handleApproveStructure()} disabled={approvingStructure || parsing}>
              {approvingStructure || parsing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {extractProgress ? `${extractProgress.percent}%` : "Loading…"}
                </>
              ) : (
                <>
                  Approve & load data <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          ) : step < lastStep ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={
                (isPdfWizard ? step === 2 : step === 1) && includedSheetNames.length === 0
              }
            >
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handlePublish} disabled={publishing}>
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Publish API <Check className="h-4 w-4" /></>}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate font-medium capitalize">{value}</div>
    </div>
  );
}
