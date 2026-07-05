import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState, useEffect } from "react";
import { useOrg, canEdit, isContributor } from "@/hooks/use-org";
import { parseWorkbook, detectPii, type ParsedWorkbook, MAX_ROWS_PER_SHEET } from "@/lib/spreadsheet";
import { publishDataset } from "@/lib/publish.functions";
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
import {
  UploadCloud,
  FileSpreadsheet,
  Loader2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Check,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/datasets/new")({
  validateSearch: (s: Record<string, unknown>) => ({
    datasetId: typeof s.datasetId === "string" ? s.datasetId : undefined,
  }),
  component: NewDatasetWizard,
});

type SheetState = { name: string; included: boolean };

const STEPS = ["Upload", "Sheets", "Fields", "Load mode", "Review"];

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
  const { datasetId: existingDatasetId } = Route.useSearch();
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
        toast.error(err instanceof Error ? err.message : "Failed to parse file");
      } finally {
        setParsing(false);
      }
    },
    [name, maxUploadBytes, maxRowsPerSheet],
  );

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
      let fileBase64: string | undefined;
      if (sourceFile) {
        const buf = await sourceFile.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
        fileBase64 = btoa(binary);
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
      toast.error(err instanceof Error ? err.message : "Failed to publish dataset");
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
        description="Turn a spreadsheet into a live REST API in five steps."
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
                <div className="font-medium">{parsing ? "Parsing…" : "Drop an Excel or CSV file"}</div>
                <div className="text-sm text-muted-foreground">.xlsx, .xls, .csv — up to 5,000 rows per sheet</div>
              </div>
              <input
                type="file"
                accept=".xlsx,.xls,.xlsm,.csv"
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

      {/* Step 1: Sheets */}
      {step === 1 && wb && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-sm text-muted-foreground">Choose which tabs to publish. Each becomes its own API resource.</p>
            {wb.hasMacros && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                <span>This workbook contains macros. Gridwire never executes macros — only cell data and computed values are imported.</span>
              </div>
            )}
            <div className="space-y-2">
              {wb.sheets.filter((s) => s.headers.length > 0).map((s) => {
                const checked = sheets.find((x) => x.name === s.name)?.included ?? false;
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
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.headers.length} columns · {s.rowCount} rows{s.truncated ? " (truncated to 5,000)" : ""}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Fields */}
      {step === 2 && wb && (
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

      {/* Step 3: Load mode */}
      {step === 3 && (
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

      {/* Step 4: Review */}
      {step === 4 && wb && (
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
          <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={publishing}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {step < 4 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 1 && includedSheetNames.length === 0}
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
