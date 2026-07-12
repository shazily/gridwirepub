import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useOrg, canManage } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createLlmApiKeyFn,
  listLlmApiKeysFn,
  listStoredLlmModelsFn,
  revokeLlmApiKeyFn,
  rotateLlmApiKeyFn,
  setActiveLlmApiKeyFn,
  testLlmConnectionFn,
  testLlmCredentialsFn,
  testStoredLlmKeyFn,
  updateLlmApiKeyFn,
  updateOrgAiConfigFn,
} from "@/lib/llm-api-keys.functions";
import type { LlmApiKeyPublic, LlmProvider, OrgAiConfig } from "@/lib/llm-api-keys-types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  BrainCircuit,
  Plus,
  Trash2,
  Loader2,
  RotateCw,
  CheckCircle2,
  Sparkles,
  Pencil,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/admin/ai")({
  component: AdminAiPdf,
});

const PROVIDERS: { value: LlmProvider; label: string; modelHint: string }[] = [
  { value: "openrouter", label: "OpenRouter", modelHint: "openrouter/free" },
  { value: "openai", label: "OpenAI", modelHint: "gpt-4o-mini" },
  { value: "anthropic", label: "Anthropic", modelHint: "claude-sonnet-4-20250514" },
  { value: "gemini", label: "Google Gemini", modelHint: "gemini-2.0-flash" },
  { value: "ollama", label: "Ollama (local)", modelHint: "llava" },
  { value: "openai_compatible", label: "OpenAI-compatible", modelHint: "gpt-4o-mini" },
];

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

function providerLabel(value: string): string {
  return PROVIDERS.find((p) => p.value === value)?.label ?? value;
}

function ConnectionStatusBadge({
  connected,
  loading,
  label,
  detail,
}: {
  connected: boolean;
  loading: boolean;
  label: string;
  detail?: string | null;
}) {
  return (
    <div
      className="flex max-w-md items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
      title={detail ?? undefined}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {loading ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-muted-foreground/50" />
        ) : (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
              connected ? "bg-emerald-500" : "bg-red-500",
            )}
          />
        )}
        <span
          className={cn(
            "relative inline-flex h-2.5 w-2.5 rounded-full",
            loading ? "bg-muted-foreground" : connected ? "bg-emerald-500" : "bg-red-500",
          )}
        />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{label}</div>
        {detail && <div className="truncate text-xs text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}

function AdminAiPdf() {
  const { currentOrg, role } = useOrg();
  const orgId = currentOrg?.id;
  const queryClient = useQueryClient();
  const manage = canManage(role);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<LlmProvider>("openrouter");
  const [model, setModel] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string }[]>([]);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [creating, setCreating] = useState(false);
  const [testingDraft, setTestingDraft] = useState(false);
  const [draftVerified, setDraftVerified] = useState(false);
  const [draftTestDetail, setDraftTestDetail] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotateKey, setRotateKey] = useState("");
  const [rotateOpen, setRotateOpen] = useState<LlmApiKeyPublic | null>(null);
  const [rotateVerified, setRotateVerified] = useState(false);
  const [testingRotate, setTestingRotate] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [editOpen, setEditOpen] = useState<LlmApiKeyPublic | null>(null);
  const [editName, setEditName] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editModelFilter, setEditModelFilter] = useState("");
  const [editModels, setEditModels] = useState<{ id: string; name: string }[]>([]);
  const [editVerified, setEditVerified] = useState(false);
  const [testingEdit, setTestingEdit] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const data = useQuery({
    queryKey: ["llm-api-keys", orgId],
    enabled: !!orgId && manage,
    queryFn: async () => listLlmApiKeysFn({ data: { orgId: orgId! } }),
  });

  const status = useQuery({
    queryKey: ["llm-connection-status", orgId, data.dataUpdatedAt],
    enabled: !!orgId && manage && !!data.data,
    queryFn: async () => testLlmConnectionFn({ data: { orgId: orgId! } }),
    refetchInterval: 60_000,
    retry: false,
  });

  const keys = data.data?.keys ?? [];
  const aiConfig: OrgAiConfig = data.data?.aiConfig ?? {};
  const pdfEnabled = data.data?.effective?.pdfParseEnabled ?? aiConfig.pdf_parse_enabled !== false;
  const pdfMock = data.data?.effective?.pdfParseMock ?? aiConfig.pdf_parse_mock === true;
  const envForcesMock =
    data.data?.effective?.envPdfParseMock === true && aiConfig.pdf_parse_mock !== true && !aiConfig.active_llm_key_id;
  const activeId = aiConfig.active_llm_key_id ?? null;
  const activeKey = keys.find((k) => k.id === activeId && !k.revoked_at) ?? keys.find((k) => !k.revoked_at);

  useEffect(() => {
    setDraftVerified(false);
    setDraftTestDetail(null);
    setAvailableModels([]);
    setModel("");
    setModelFilter("");
  }, [provider, baseUrl, apiKey]);

  useEffect(() => {
    setRotateVerified(false);
  }, [rotateKey]);

  useEffect(() => {
    // Changing the replacement secret requires a fresh test; keep current model list.
    if (editApiKey.trim()) setEditVerified(false);
  }, [editApiKey]);

  function mergeModelsWithCurrent(
    models: { id: string; name: string }[],
    current: string | null | undefined,
  ) {
    const retained = current?.trim();
    if (!retained) return models;
    if (models.some((m) => m.id === retained)) return models;
    return [{ id: retained, name: `${retained} (current)` }, ...models];
  }

  function openEdit(k: LlmApiKeyPublic) {
    setEditOpen(k);
    setEditName(k.name);
    setEditModel(k.model ?? "");
    setEditApiKey("");
    setEditModelFilter("");
    setEditModels(k.model ? [{ id: k.model, name: k.model }] : []);
    setEditVerified(false);
    void (async () => {
      if (!orgId) return;
      setTestingEdit(true);
      try {
        const result = await listStoredLlmModelsFn({
          data: { orgId, keyId: k.id },
        });
        const retained = k.model?.trim() || result.defaultModel;
        setEditModels(mergeModelsWithCurrent(result.models, retained));
        setEditModel(retained);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Could not load models — paste a valid API key and test",
        );
      } finally {
        setTestingEdit(false);
      }
    })();
  }

  async function testEditConnection() {
    if (!orgId || !editOpen) return;
    const preferredModel = editModel.trim();
    setTestingEdit(true);
    try {
      const result = await testStoredLlmKeyFn({
        data: {
          orgId,
          keyId: editOpen.id,
          apiKey: editApiKey.trim() || undefined,
          model: preferredModel || null,
        },
      });
      const retained = preferredModel || result.defaultModel;
      setEditModels(mergeModelsWithCurrent(result.models, retained));
      setEditModel(
        result.models.some((m) => m.id === retained) || retained === result.defaultModel
          ? retained
          : result.defaultModel,
      );
      if (result.connected) {
        setEditVerified(true);
        toast.success("Connection OK — full model list loaded");
      } else {
        // Models loaded; allow save unless a new secret was entered and failed ping.
        setEditVerified(!editApiKey.trim());
        toast.message("Model list loaded", {
          description: result.error || "Live ping failed — pick another model (try openrouter/free).",
        });
      }
    } catch (err) {
      setEditVerified(false);
      toast.error(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setTestingEdit(false);
    }
  }

  async function saveEdit() {
    if (!orgId || !editOpen || !editName.trim() || !editModel.trim()) return;
    if (editApiKey.trim() && !editVerified) {
      toast.error("Test the new API key before saving");
      return;
    }
    setSavingEdit(true);
    try {
      await updateLlmApiKeyFn({
        data: {
          orgId,
          keyId: editOpen.id,
          name: editName.trim(),
          model: editModel.trim(),
          apiKey: editApiKey.trim() || undefined,
        },
      });
      toast.success("Connection updated");
      setEditOpen(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update connection");
    } finally {
      setSavingEdit(false);
    }
  }

  const editFilteredModels = editModels.filter((m) => {
    if (!editModelFilter.trim()) return true;
    const q = editModelFilter.trim().toLowerCase();
    return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["llm-api-keys", orgId] });
    await queryClient.invalidateQueries({ queryKey: ["llm-connection-status", orgId] });
  }

  function resetCreateForm() {
    setName("");
    setApiKey("");
    setModel("");
    setModelFilter("");
    setAvailableModels([]);
    setBaseUrl("");
    setProvider("openrouter");
    setDraftVerified(false);
    setDraftTestDetail(null);
  }

  function resolvedBaseUrlForDraft(): string | null {
    if (provider === "openrouter") return OPENROUTER_BASE;
    if (provider === "openai_compatible" || provider === "ollama") {
      return baseUrl.trim() || null;
    }
    return null;
  }

  const filteredModels = availableModels.filter((m) => {
    if (!modelFilter.trim()) return true;
    const q = modelFilter.trim().toLowerCase();
    return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
  });

  async function testDraftCredentials() {
    if (!orgId) return;
    if (provider !== "ollama" && !apiKey.trim()) {
      toast.error("Paste the provider API key");
      return;
    }
    setTestingDraft(true);
    setDraftVerified(false);
    setAvailableModels([]);
    setModel("");
    try {
      const result = await testLlmCredentialsFn({
        data: {
          orgId,
          provider,
          model: null,
          baseUrl: resolvedBaseUrlForDraft(),
          apiKey: apiKey.trim(),
        },
      });
      setAvailableModels(result.models);
      setModel(result.defaultModel);
      setDraftTestDetail(
        `${providerLabel(result.provider)} · ${result.models.length} models available to this key · ${result.latencyMs}ms`,
      );
      if (result.connected) {
        setDraftVerified(true);
        toast.success("Connection OK — select a model available to your account");
      } else {
        // Catalog loaded; allow model pick even if the live ping was rate-limited.
        setDraftVerified(true);
        toast.error(result.error || "Ping failed — model list loaded; pick another model and retry");
      }
    } catch (err) {
      setDraftVerified(false);
      setAvailableModels([]);
      setDraftTestDetail(err instanceof Error ? err.message : "Connection failed");
      toast.error(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setTestingDraft(false);
    }
  }

  async function createKey() {
    if (!orgId || !name.trim() || !draftVerified || !model.trim()) return;
    setCreating(true);
    try {
      const result = await createLlmApiKeyFn({
        data: {
          orgId,
          name: name.trim(),
          provider,
          model: model.trim(),
          baseUrl: resolvedBaseUrlForDraft(),
          apiKey: apiKey.trim(),
        },
      });
      setSavedNotice(result.message);
      resetCreateForm();
      setOpen(false);
      toast.success("LLM API key saved");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create key");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!orgId) return;
    try {
      await revokeLlmApiKeyFn({ data: { orgId, keyId: id } });
      toast.success("Key revoked");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke key");
    }
  }

  async function testRotateCredentials() {
    if (!orgId || !rotateOpen || !rotateKey.trim()) return;
    setTestingRotate(true);
    setRotateVerified(false);
    try {
      await testLlmCredentialsFn({
        data: {
          orgId,
          provider: rotateOpen.provider,
          model: rotateOpen.model,
          baseUrl: rotateOpen.base_url,
          apiKey: rotateKey.trim(),
        },
      });
      setRotateVerified(true);
      toast.success("Connection OK — you can rotate");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setTestingRotate(false);
    }
  }

  async function confirmRotate() {
    if (!orgId || !rotateOpen || !rotateKey.trim() || !rotateVerified) return;
    setRotatingId(rotateOpen.id);
    try {
      const result = await rotateLlmApiKeyFn({
        data: { orgId, keyId: rotateOpen.id, apiKey: rotateKey.trim() },
      });
      setSavedNotice(result.message);
      setRotateOpen(null);
      setRotateKey("");
      setRotateVerified(false);
      toast.success("Key rotated — the old key is now revoked");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rotate key");
    } finally {
      setRotatingId(null);
    }
  }

  async function setActive(id: string) {
    if (!orgId) return;
    try {
      await setActiveLlmApiKeyFn({ data: { orgId, keyId: id } });
      toast.success("Active key updated");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set active key");
    }
  }

  async function savePdfSettings(patch: { pdfParseEnabled?: boolean; pdfParseMock?: boolean }) {
    if (!orgId) return;
    setSavingSettings(true);
    try {
      await updateOrgAiConfigFn({ data: { orgId, ...patch } });
      toast.success("PDF settings saved");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSavingSettings(false);
    }
  }

  const statusLoading = status.isFetching || data.isLoading;
  const connected = status.data?.connected === true;
  const statusLabel = (() => {
    if (statusLoading) return "Checking connection…";
    if (pdfMock && !connected) return "Mock mode · LLM not connected";
    if (connected && status.data?.provider) {
      return `${providerLabel(status.data.provider)} · ${status.data.model ?? "model"}`;
    }
    if (activeKey) return `${providerLabel(activeKey.provider)} · not connected`;
    return "No LLM provider configured";
  })();
  const statusDetail = (() => {
    if (statusLoading) return null;
    if (connected && status.data?.latencyMs != null) {
      return `Connected · ${status.data.latencyMs}ms · ${status.data.source === "env" ? "env fallback" : "org key"}`;
    }
    if (status.data?.error) return status.data.error;
    if (pdfMock) return "PDF parser uses mock extraction until a live key passes";
    if (activeKey) return `${activeKey.key_prefix}•••• · ${activeKey.name}`;
    return "Add a key to enable AI PDF extraction";
  })();

  return (
    <AdminShell>
      <div className="space-y-6">
        <PageHeader
          title="AI / PDF"
          description="Store LLM provider keys like dataset API keys (hash + prefix, rotate, revoke). Secrets are encrypted at rest and never re-shown."
          action={
            manage && (
              <div className="flex flex-wrap items-center gap-2">
                <ConnectionStatusBadge
                  connected={connected}
                  loading={statusLoading}
                  label={statusLabel}
                  detail={statusDetail}
                />
                <Button onClick={() => setOpen(true)}>
                  <Plus className="h-4 w-4" /> New LLM key
                </Button>
              </div>
            )
          }
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">PDF table parser</CardTitle>
            <CardDescription>
              AI extracts tables from PDFs into review drafts before publish. Mock mode uses fixture heuristics (no provider call).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Enable AI PDF parsing</div>
                <p className="text-xs text-muted-foreground">Upload, email, and connector PDF ingest.</p>
              </div>
              <Switch
                checked={pdfEnabled}
                disabled={!manage || savingSettings}
                onCheckedChange={(v) => savePdfSettings({ pdfParseEnabled: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Mock mode (no LLM call)</div>
                <p className="text-xs text-muted-foreground">
                  For demos without a provider key. Turn this off to use your configured LLM.
                </p>
                {envForcesMock ? (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    Server env PDF_PARSE_MOCK is on. Saving a live LLM key (or toggling this off) disables mock for this workspace.
                  </p>
                ) : null}
                {pdfMock ? (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    Mock mode is active — PDF uploads will not call your LLM until you turn this off.
                  </p>
                ) : null}
              </div>
              <Switch
                checked={pdfMock}
                disabled={!manage || savingSettings}
                onCheckedChange={(v) => savePdfSettings({ pdfParseMock: v })}
              />
            </div>
          </CardContent>
        </Card>

        {keys.length > 0 && (
          <div className="space-y-2">
            {keys.map((k) => {
              const isActive = !k.revoked_at && activeId === k.id;
              return (
                <Card key={k.id}>
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
                      <BrainCircuit className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium">{k.name}</div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <code className="font-mono">{k.key_prefix}••••••••</code>
                        <span>·</span>
                        <span>{providerLabel(k.provider)}</span>
                        {k.model && (
                          <>
                            <span>·</span>
                            <span>{k.model}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      {k.revoked_at ? (
                        <Badge variant="secondary">Revoked</Badge>
                      ) : isActive ? (
                        <Badge className="bg-success/20 text-success">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Stored</Badge>
                      )}
                      {k.last_used_at && (
                        <span className="hidden text-xs text-muted-foreground sm:inline">
                          Last used {new Date(k.last_used_at).toLocaleDateString()}
                        </span>
                      )}
                      {manage && !k.revoked_at && (
                        <>
                          {!isActive && (
                            <Button variant="outline" size="sm" onClick={() => setActive(k.id)}>
                              Use for PDF
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit connection"
                            onClick={() => openEdit(k)}
                          >
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Rotate key"
                            disabled={rotatingId === k.id}
                            onClick={() => {
                              setRotateOpen(k);
                              setRotateKey("");
                              setRotateVerified(false);
                            }}
                          >
                            {rotatingId === k.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCw className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                          <Button variant="ghost" size="icon" title="Revoke key" onClick={() => revoke(k.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) resetCreateForm();
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add LLM API key</DialogTitle>
              <DialogDescription>
                Enter provider and API key, test the connection, then pick a model from the live list.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="llm-name">Name</Label>
                <Input
                  id="llm-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Production OpenRouter"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => {
                    const next = v as LlmProvider;
                    setProvider(next);
                    if (next === "openrouter") setBaseUrl(OPENROUTER_BASE);
                    else if (next !== "openai_compatible" && next !== "ollama") setBaseUrl("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {provider === "openrouter" && (
                <p className="text-xs text-muted-foreground">
                  Base URL preconfigured: <code className="font-mono">{OPENROUTER_BASE}</code>
                </p>
              )}
              {(provider === "openai_compatible" || provider === "ollama") && (
                <div className="space-y-1.5">
                  <Label htmlFor="llm-base">Base URL</Label>
                  <Input
                    id="llm-base"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={provider === "ollama" ? "http://127.0.0.1:11434" : "https://api.example.com/v1"}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="llm-key">API key{provider === "ollama" ? " (optional)" : ""}</Label>
                <Input
                  id="llm-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    provider === "openrouter"
                      ? "sk-or-v1-…"
                      : provider === "openai"
                        ? "sk-…"
                        : "API key"
                  }
                />
              </div>
              {draftTestDetail && (
                <div
                  className={cn(
                    "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
                    draftVerified
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 h-2 w-2 shrink-0 rounded-full",
                      draftVerified ? "animate-pulse bg-emerald-500" : "animate-pulse bg-red-500",
                    )}
                  />
                  <span>{draftVerified ? `Verified · ${draftTestDetail}` : draftTestDetail}</span>
                </div>
              )}
              {draftVerified && availableModels.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Model</Label>
                  {availableModels.length > 12 && (
                    <Input
                      value={modelFilter}
                      onChange={(e) => setModelFilter(e.target.value)}
                      placeholder="Filter models…"
                      className="h-8"
                    />
                  )}
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger id="llm-model">
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {filteredModels.length === 0 ? (
                        <div className="px-2 py-3 text-xs text-muted-foreground">No models match</div>
                      ) : (
                        filteredModels.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.id === m.name ? m.id : `${m.name} (${m.id})`}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {availableModels.length} model{availableModels.length === 1 ? "" : "s"} available to this key
                    {provider === "openrouter" ? " (OpenRouter account filter)" : ""}
                  </p>
                </div>
              )}
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={testDraftCredentials}
                disabled={testingDraft || !name.trim() || (provider !== "ollama" && !apiKey.trim())}
              >
                {testingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Test connection
              </Button>
              <Button
                onClick={createKey}
                disabled={creating || !draftVerified || !name.trim() || !model.trim()}
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save key"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!rotateOpen} onOpenChange={(o) => !o && setRotateOpen(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rotate LLM key</DialogTitle>
              <DialogDescription>
                Test the new secret, then rotate. The old key is revoked immediately.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="rotate-key">New API key</Label>
              <Input
                id="rotate-key"
                type="password"
                autoComplete="off"
                value={rotateKey}
                onChange={(e) => setRotateKey(e.target.value)}
              />
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setRotateOpen(null)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={testRotateCredentials}
                disabled={!rotateKey.trim() || testingRotate}
              >
                {testingRotate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Test connection
              </Button>
              <Button onClick={confirmRotate} disabled={!rotateVerified || !!rotatingId}>
                {rotatingId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rotate"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editOpen} onOpenChange={(o) => !o && setEditOpen(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit connection</DialogTitle>
              <DialogDescription>
                Change name, model, or API key. Models are loaded for your account
                {editOpen?.provider === "openrouter" ? " via OpenRouter /models/user" : ""}.
                {editOpen?.provider === "openrouter" && (
                  <> Keys start with <code className="font-mono">sk-or-</code>.</>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                Provider: <span className="font-medium text-foreground">{editOpen ? providerLabel(editOpen.provider) : ""}</span>
                {editOpen?.key_prefix && (
                  <>
                    {" "}
                    · stored prefix <code className="font-mono">{editOpen.key_prefix}••••</code>
                  </>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-key">New API key (optional)</Label>
                <Input
                  id="edit-key"
                  type="password"
                  autoComplete="off"
                  value={editApiKey}
                  onChange={(e) => setEditApiKey(e.target.value)}
                  placeholder={editOpen?.provider === "openrouter" ? "sk-or-v1-…" : "Leave blank to keep current"}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label>Model</Label>
                  {testingEdit && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                    </span>
                  )}
                </div>
                {editModels.length > 1 && (
                  <Input
                    value={editModelFilter}
                    onChange={(e) => setEditModelFilter(e.target.value)}
                    placeholder="Filter models…"
                    className="h-8"
                  />
                )}
                {editModels.length > 0 ? (
                  <Select value={editModel} onValueChange={setEditModel}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {editFilteredModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.id === m.name ? m.id : `${m.name} (${m.id})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={editModel}
                    onChange={(e) => setEditModel(e.target.value)}
                    placeholder="Current model"
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  {editModels.length <= 1
                    ? "Loading full model list…"
                    : editOpen?.provider === "openrouter"
                      ? `${editModels.length} models available for this OpenRouter key.`
                      : `${editModels.length} models from your provider account.`}
                  {editVerified ? " Connection verified." : ""}
                </p>
              </div>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setEditOpen(null)}>
                Cancel
              </Button>
              <Button variant="outline" onClick={testEditConnection} disabled={testingEdit || !editName.trim()}>
                {testingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Test connection
              </Button>
              <Button
                onClick={saveEdit}
                disabled={
                  savingEdit ||
                  !editName.trim() ||
                  !editModel.trim() ||
                  (Boolean(editApiKey.trim()) && !editVerified)
                }
              >
                {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!savedNotice} onOpenChange={(o) => !o && setSavedNotice(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Key stored securely</DialogTitle>
              <DialogDescription>
                The full provider secret cannot be shown again — only the prefix is kept for identification.
              </DialogDescription>
            </DialogHeader>
            <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">{savedNotice}</p>
            <DialogFooter>
              <Button onClick={() => setSavedNotice(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminShell>
  );
}
