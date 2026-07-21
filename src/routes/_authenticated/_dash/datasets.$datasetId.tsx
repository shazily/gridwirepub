import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canEdit, canManage } from "@/hooks/use-org";
import { slugify } from "@/lib/spreadsheet";
import {
  archiveDatasetFn,
  permanentlyDeleteDatasetFn,
  restoreDatasetFn,
} from "@/lib/dataset-lifecycle.functions";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit.functions";
import { toUserFacingMessage } from "@/lib/user-facing-error";
import {
  Copy,
  Upload,
  GitBranch,
  ShieldAlert,
  Eye,
  EyeOff,
  Globe,
  Lock,
  BookOpen,
  Activity,
  KeyRound,
  Network,
  Archive,
  ArchiveRestore,
  Trash2,
  Loader2,
} from "lucide-react";
import { LineageGraph } from "@/components/lineage-graph";

type Masking = "none" | "mask" | "hash" | "encrypt";
type HashAlgo = "sha256" | "sha512" | "sha3_256" | "sha3_512" | "hmac_sha256" | "hmac_sha512";

const HASH_ALGOS: { value: HashAlgo; label: string }[] = [
  { value: "sha256", label: "SHA-256" },
  { value: "sha512", label: "SHA-512" },
  { value: "sha3_256", label: "SHA3-256" },
  { value: "sha3_512", label: "SHA3-512" },
  { value: "hmac_sha256", label: "HMAC-SHA256" },
  { value: "hmac_sha512", label: "HMAC-SHA512" },
];

export const Route = createFileRoute("/_authenticated/_dash/datasets/$datasetId")({
  component: DatasetDetail,
});

function copy(text: string) {
  navigator.clipboard.writeText(text);
  toast.success("Copied to clipboard");
}

function DatasetDetail() {
  const { datasetId } = Route.useParams();
  const { currentOrg, role } = useOrg();
  const navigate = useNavigate();
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const ds = useQuery({
    queryKey: ["dataset", datasetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("datasets")
        .select("*, dataset_versions(*)")
        .eq("id", datasetId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const currentVersionId = ds.data?.current_version_id;

  const fields = useQuery({
    queryKey: ["dataset-fields", currentVersionId],
    enabled: !!currentVersionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dataset_fields")
        .select("*")
        .eq("version_id", currentVersionId!)
        .order("position", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const sheetNames = useMemo(
    () => [...new Set((fields.data ?? []).map((f) => f.sheet_name))],
    [fields.data],
  );
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const sheet = activeSheet ?? sheetNames[0] ?? "";

  const rows = useQuery({
    queryKey: ["dataset-rows", currentVersionId, sheet],
    enabled: !!currentVersionId && !!sheet,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dataset_rows")
        .select("data")
        .eq("version_id", currentVersionId!)
        .eq("sheet_name", sheet)
        .order("row_index", { ascending: true })
        .limit(25);
      if (error) throw error;
      return data.map((r) => r.data as Record<string, unknown>);
    },
  });

  const qc = useQueryClient();
  const editable = canEdit(role);
  const manage = canManage(role);

  const lineage = useQuery({
    queryKey: ["dataset-lineage", datasetId],
    enabled: !!datasetId,
    queryFn: async () => {
      const res = await fetch(`/api/v1/datasets/${datasetId}/lineage.json`);
      if (!res.ok) throw new Error("Failed to load lineage");
      const json = (await res.json()) as {
        data: {
          nodes: { id: string; node_type: string; label: string; metadata?: Record<string, unknown> }[];
          edges: { id: string; from_node_id: string; to_node_id: string; relationship: string; metadata?: Record<string, unknown> }[];
        };
      };
      return json.data;
    },
  });

  const ownershipIds = useMemo(() => {
    const d = ds.data as { uploaded_by?: string | null; published_by?: string | null; data_steward_id?: string | null } | undefined;
    if (!d) return [];
    return [...new Set([d.uploaded_by, d.published_by, d.data_steward_id].filter(Boolean))] as string[];
  }, [ds.data]);

  const owners = useQuery({
    queryKey: ["dataset-owners", ownershipIds],
    enabled: ownershipIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, display_name").in("id", ownershipIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const access = useQuery({
    queryKey: ["dataset-access", datasetId],
    enabled: manage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_events")
        .select("id, action, actor_label, ip, metadata, created_at")
        .eq("dataset_id", datasetId)
        .in("action", ["api.data.read", "api.auth.failed"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as {
        id: number;
        action: string;
        actor_label: string | null;
        ip: string | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
      }[];
    },
  });

  const accessMut = useMutation({
    mutationFn: async (access: "secure" | "public") => {
      const { error } = await supabase.from("datasets").update({ api_access: access }).eq("id", datasetId);
      if (error) throw error;
      if (currentOrg) {
        try {
          await logAuditEvent({
            data: {
              orgId: currentOrg.id,
              action: "dataset.access.changed",
              resourceType: "dataset",
              resourceId: datasetId,
              datasetId,
              metadata: { access },
            },
          });
        } catch {
          /* best-effort */
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dataset", datasetId] });
      toast.success("API access updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update access"),
  });

  const fieldMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { masking?: Masking; hash_algo?: HashAlgo; included?: boolean } }) => {
      const { error } = await supabase.from("dataset_fields").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dataset-fields", currentVersionId] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to update field"),
  });

  const [lifecycleReason, setLifecycleReason] = useState("");
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const archiveMut = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error("Select an organization first");
      return archiveDatasetFn({
        data: { orgId: currentOrg.id, datasetId, reason: lifecycleReason || undefined },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dataset", datasetId] });
      qc.invalidateQueries({ queryKey: ["datasets"] });
      setArchiveOpen(false);
      setLifecycleReason("");
      toast.success("API unpublished — data kept. Event logged to Admin → Audit.");
    },
    onError: (e) => toast.error(toUserFacingMessage(e, "Failed to unpublish API")),
  });

  const restoreMut = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error("Select an organization first");
      return restoreDatasetFn({
        data: { orgId: currentOrg.id, datasetId, reason: lifecycleReason || undefined },
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["dataset", datasetId] });
      qc.invalidateQueries({ queryKey: ["datasets"] });
      setLifecycleReason("");
      toast.success(
        res.status === "published"
          ? "API restored — live again. Event logged to Admin → Audit."
          : "Dataset restored as draft. Event logged to Admin → Audit.",
      );
    },
    onError: (e) => toast.error(toUserFacingMessage(e, "Failed to restore API")),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error("Select an organization first");
      return permanentlyDeleteDatasetFn({
        data: {
          orgId: currentOrg.id,
          datasetId,
          confirmName: deleteConfirmName,
          reason: lifecycleReason || undefined,
        },
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["datasets"] });
      setDeleteOpen(false);
      toast.success(`Permanently deleted “${res.deleted.name}”. Full snapshot logged to Admin → Audit.`);
      navigate({ to: "/datasets" });
    },
    onError: (e) => toast.error(toUserFacingMessage(e, "Failed to delete dataset")),
  });

  if (ds.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!ds.data) return <p className="text-sm text-muted-foreground">Dataset not found.</p>;

  const isPublic = ds.data.api_access === "public";
  const isArchived = ds.data.status === "archived";
  const versions = (ds.data.dataset_versions ?? []).sort((a, b) => b.version_no - a.version_no);
  const sheetFields = (fields.data ?? []).filter((f) => f.sheet_name === sheet);
  const base = `${origin}/api/v1/datasets/${datasetId}`;
  const endpoint = `${base}/${slugify(sheet)}`;
  const authLine = isPublic ? "" : '-H "Authorization: Bearer YOUR_API_KEY" \\\n  ';
  const curlSnippet = `curl ${authLine}"${endpoint}?limit=20"`;
  const jsSnippet = isPublic
    ? `const res = await fetch("${endpoint}?limit=20");\nconst { data } = await res.json();`
    : `const res = await fetch(\n  "${endpoint}?limit=20",\n  { headers: { Authorization: "Bearer YOUR_API_KEY" } }\n);\nconst { data } = await res.json();`;

  const dsMeta = ds.data as typeof ds.data & {
    uploaded_by?: string | null;
    published_by?: string | null;
    data_steward_id?: string | null;
  };
  const ownerName = (id: string | null | undefined) =>
    owners.data?.find((p) => p.id === id)?.display_name ?? (id ? id.slice(0, 8) : "—");

  return (
    <div>
      <PageHeader
        title={ds.data.name}
        description={ds.data.description ?? undefined}
        backTo="/datasets"
        backLabel="Datasets"
        crumbs={[{ label: "Datasets", to: "/datasets" }, { label: ds.data.name }]}
        action={
          canEdit(role) && !isArchived ? (
            <Button variant="outline" onClick={() => navigate({ to: "/datasets/new", search: { datasetId } })}>
              <Upload className="h-4 w-4" /> Upload new version
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge
          variant={ds.data.status === "published" ? "default" : "secondary"}
          className={
            isArchived
              ? "border-warning/40 bg-warning/10 capitalize text-warning"
              : "capitalize"
          }
        >
          {isArchived ? "unpublished" : ds.data.status}
        </Badge>
        <Badge variant={isPublic ? "outline" : "default"} className="gap-1">
          {isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          {isPublic ? "public" : "secure"}
        </Badge>
        <Badge variant="secondary" className="capitalize">{ds.data.source_type}</Badge>
        {versions[0] && <Badge variant="secondary">v{versions[0].version_no}</Badge>}
        {versions[0]?.diff_summary &&
          (versions[0].diff_summary as { deviates?: boolean }).deviates && (
            <Badge variant="outline" className="gap-1 border-warning/50 text-warning">
              <ShieldAlert className="h-3 w-3" /> schema drift
            </Badge>
          )}
        {versions[0]?.has_macros && (
          <Badge variant="outline" className="gap-1 border-warning/50 text-warning">
            <ShieldAlert className="h-3 w-3" /> macros ignored
          </Badge>
        )}
        {(dsMeta.uploaded_by || dsMeta.published_by || dsMeta.data_steward_id) && (
          <Badge variant="outline" className="text-xs">
            Owner: {ownerName(dsMeta.data_steward_id ?? dsMeta.uploaded_by)}
          </Badge>
        )}
        {ds.data.status === "published" && (
          <Button variant="outline" size="sm" className="ml-auto" asChild>
            <a href={`/docs/${datasetId}`} target="_blank" rel="noreferrer"><BookOpen className="h-4 w-4" /> API reference</a>
          </Button>
        )}
      </div>

      {isArchived && (
        <Card className="mb-4 border-warning/40 bg-warning/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <Archive className="h-4 w-4 text-warning" />
            <div className="flex-1">
              <p className="font-medium">This API is unpublished</p>
              <p className="text-muted-foreground">
                The live endpoint is offline. All data and versions are kept. Restore to bring the API
                back, or permanently delete below if you truly need to remove it.
              </p>
            </div>
            {editable && (
              <Button
                variant="outline"
                size="sm"
                disabled={restoreMut.isPending}
                onClick={() => restoreMut.mutate()}
              >
                {restoreMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArchiveRestore className="h-4 w-4" />
                )}
                Restore
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {versions[0]?.diff_summary && (versions[0].diff_summary as { deviates?: boolean }).deviates && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <div className="font-medium text-warning">Schema drift detected</div>
          <p className="mt-1 text-xs text-muted-foreground">
            The latest version differs from the previous schema. Review the{" "}
            <a href={`${base}/contract.json`} className="underline" target="_blank" rel="noreferrer">
              data contract
            </a>{" "}
            and Versions tab before downstream consumers rely on this dataset.
          </p>
        </div>
      )}

      <Tabs defaultValue="api">
        <TabsList>
          <TabsTrigger value="api">API</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="fields">Fields</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="lineage" className="gap-1">
            <Network className="h-3.5 w-3.5" /> Lineage
          </TabsTrigger>
          {manage && <TabsTrigger value="access">Recent access</TabsTrigger>}
        </TabsList>

        {/* Sheet selector — only when workbook has multiple sheets */}
        {sheetNames.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Label className="text-xs text-muted-foreground">Sheet</Label>
            <Select value={sheet} onValueChange={setActiveSheet}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select sheet" />
              </SelectTrigger>
              <SelectContent>
                {sheetNames.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <TabsContent value="api" className="mt-4 space-y-4">
          {editable && !isArchived && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">API availability</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm">
                    <div className="font-medium">{isPublic ? "Public" : "Secure (API key required)"}</div>
                    <p className="text-xs text-muted-foreground">
                      {isPublic
                        ? "Anyone with the URL can read this data. Use only for non-sensitive open data."
                        : "Consumers must send a valid API key as a Bearer token."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-muted-foreground" />
                    <Switch
                      checked={isPublic}
                      onCheckedChange={(v) => accessMut.mutate(v ? "public" : "secure")}
                      disabled={accessMut.isPending}
                    />
                    <Globe className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <div className="text-sm">
                    <div className="font-medium">Unpublish API</div>
                    <p className="text-xs text-muted-foreground">
                      Takes the live API offline. Rows, versions, and field settings stay — nothing is
                      deleted. You can restore later.
                    </p>
                  </div>
                  <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Archive className="h-4 w-4" /> Unpublish
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Unpublish “{ds.data.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The API will stop serving immediately (clients get not published). All data and
                          versions remain in the portal. You can restore anytime. This is recorded in
                          Admin → Audit.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="space-y-1.5 py-1">
                        <Label htmlFor="unpublish-reason">Reason (optional)</Label>
                        <Textarea
                          id="unpublish-reason"
                          value={lifecycleReason}
                          onChange={(e) => setLifecycleReason(e.target.value)}
                          placeholder="e.g. Temporary hold · wrong access · superseded"
                          className="min-h-[72px]"
                        />
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={(e) => {
                            e.preventDefault();
                            archiveMut.mutate();
                          }}
                          disabled={archiveMut.isPending}
                        >
                          {archiveMut.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Unpublish (keep data)"
                          )}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          )}

          {editable && isArchived && (
            <Card className="border-warning/40">
              <CardHeader>
                <CardTitle className="text-base">API availability</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  <div className="font-medium">API is unpublished</div>
                  <p className="text-xs text-muted-foreground">
                    Data is retained. Restore to make the API live again with the same public/secure
                    setting.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={restoreMut.isPending}
                  onClick={() => restoreMut.mutate()}
                >
                  {restoreMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArchiveRestore className="h-4 w-4" />
                  )}
                  Restore API
                </Button>
              </CardContent>
            </Card>
          )}

          {!editable && !isArchived && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Access</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <div className="font-medium">{isPublic ? "Public" : "Secure (API key required)"}</div>
                <p className="text-xs text-muted-foreground">
                  {isPublic
                    ? "Anyone with the URL can read this data."
                    : "Consumers must send a valid API key as a Bearer token."}
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Endpoints</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <EndpointRow method="GET" label="Rows" url={endpoint} onCopy={copy} />
              <EndpointRow method="GET" label="Schema" url={`${endpoint}/schema`} onCopy={copy} />
              <EndpointRow method="GET" label="Dataset / poll" url={base} onCopy={copy} />
              <EndpointRow method="GET" label="OpenAPI spec" url={`${base}/openapi.json`} onCopy={copy} />
              <EndpointRow method="GET" label="Data contract (JSON)" url={`${base}/contract.json`} onCopy={copy} />
              <EndpointRow method="GET" label="Data contract (YAML)" url={`${base}/contract.yaml`} onCopy={copy} />
              <EndpointRow method="GET" label="Lineage graph" url={`${base}/lineage.json`} onCopy={copy} />
              <p className="text-xs text-muted-foreground">
                Query params on Rows: <code className="font-mono">limit</code>, <code className="font-mono">offset</code>,
                <code className="font-mono"> fields</code> (comma-separated), and any field name for equality filtering.
                Responses include <code className="font-mono">ETag</code> / <code className="font-mono">X-Dataset-Version</code>;
                send <code className="font-mono">If-None-Match</code> to poll cheaply (304 when unchanged).
              </p>
              <Snippet title="cURL" code={curlSnippet} />
              <Snippet title="JavaScript" code={jsSnippet} />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={`/docs/${datasetId}`} target="_blank" rel="noreferrer"><BookOpen className="h-4 w-4" /> Swagger UI</a>
                </Button>
                {!isPublic && (
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/api-keys">Manage API keys</Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="mt-4">
          <Card>
            <CardContent className="overflow-x-auto p-0">
              {rows.data && rows.data.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {sheetFields.map((f) => (
                        <th key={f.id} className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">
                          {f.api_name}
                          {f.masking !== "none" && <span className="ml-1 text-warning">·{f.masking}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.data.map((r, i) => (
                      <tr key={i} className="border-b border-border/50">
                        {sheetFields.map((f) => (
                          <td key={f.id} className="max-w-[16rem] truncate whitespace-nowrap px-3 py-2">
                            {formatCell(r[f.api_name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="p-6 text-sm text-muted-foreground">No rows.</p>
              )}
            </CardContent>
          </Card>
          <p className="mt-2 text-xs text-muted-foreground">Showing first 25 rows (unmasked preview). Masking applies on the public API.</p>
        </TabsContent>

        <TabsContent value="fields" className="mt-4">
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2">Original</th>
                    <th className="px-3 py-2">API field</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">PII</th>
                    <th className="px-3 py-2">Protection</th>
                    <th className="px-3 py-2">Hash algo</th>
                    <th className="px-3 py-2">Included</th>
                  </tr>
                </thead>
                <tbody>
                  {sheetFields.map((f) => (
                    <tr key={f.id} className="border-b border-border/50">
                      <td className="px-3 py-2 text-muted-foreground">{f.original_name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{f.api_name}</td>
                      <td className="px-3 py-2">{f.data_type}</td>
                      <td className="px-3 py-2">{f.is_pii ? <Eye className="h-4 w-4 text-warning" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}</td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <Select
                            value={f.masking}
                            onValueChange={(v) => fieldMut.mutate({ id: f.id, patch: { masking: v as Masking } })}
                          >
                            <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">none</SelectItem>
                              <SelectItem value="mask">mask</SelectItem>
                              <SelectItem value="hash">hash</SelectItem>
                              <SelectItem value="encrypt">encrypt</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="capitalize">{f.masking}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {f.masking === "hash" ? (
                          editable ? (
                            <Select
                              value={(f.hash_algo as HashAlgo) ?? "sha256"}
                              onValueChange={(v) => fieldMut.mutate({ id: f.id, patch: { hash_algo: v as HashAlgo } })}
                            >
                              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {HASH_ALGOS.map((a) => (
                                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="font-mono text-xs">{f.hash_algo ?? "sha256"}</span>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Switch
                          checked={f.included}
                          disabled={!editable || fieldMut.isPending}
                          onCheckedChange={(v) => fieldMut.mutate({ id: f.id, patch: { included: v } })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          {editable && (
            <p className="mt-2 text-xs text-muted-foreground">
              Changes apply immediately to the live API for this version. <strong>encrypt</strong> stores AES-256-GCM
              ciphertext at ingest (<code className="font-mono">enc:v1:…</code>); the API returns decrypted values for
              authorized consumers. <strong>hash</strong> stores a digest; <strong>mask</strong> partially redacts values.
            </p>
          )}
        </TabsContent>

        <TabsContent value="versions" className="mt-4 space-y-3">
          {versions.map((v) => {
            const diff = v.diff_summary as null | { added: string[]; removed: string[]; type_changed: { field: string; from: string; to: string }[]; row_delta: number; deviates: boolean };
            return (
              <Card key={v.id}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={v.id === currentVersionId ? "default" : "secondary"}>v{v.version_no}</Badge>
                    {v.is_baseline && <Badge variant="outline" className="gap-1"><GitBranch className="h-3 w-3" /> baseline</Badge>}
                    <span className="text-sm text-muted-foreground">{v.file_name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{v.row_count} rows · {v.sheet_count} sheets · {v.load_mode}</span>
                  </div>
                  {diff && diff.deviates && (
                    <div className="mt-3 space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
                      <div className="font-medium text-warning">
                        {v.is_baseline ? "Baseline schema" : "Changes since previous version"}
                      </div>
                      {diff.added.length > 0 && <div>Added: {diff.added.join(", ")}</div>}
                      {diff.removed.length > 0 && <div>Removed: {diff.removed.join(", ")}</div>}
                      {diff.type_changed.map((t) => <div key={t.field}>{t.field}: {t.from} → {t.to}</div>)}
                      <div>Row change: {diff.row_delta >= 0 ? "+" : ""}{diff.row_delta}</div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="lineage" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Data lineage</CardTitle>
            </CardHeader>
            <CardContent>
              {lineage.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading lineage…</p>
              ) : (lineage.data?.nodes.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No lineage recorded yet. Publish a version to populate the graph.</p>
              ) : (
                <div className="h-[420px] rounded-lg border border-border">
                  <LineageGraph
                    nodes={lineage.data!.nodes.map((n) => ({
                      id: n.id,
                      node_type: (n as { node_type?: string }).node_type ?? "dataset",
                      label: n.label,
                      metadata: n.metadata,
                    }))}
                    edges={lineage.data!.edges}
                  />
                </div>
              )}
              <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                <div><span className="font-medium text-foreground">Uploaded by:</span> {ownerName(dsMeta.uploaded_by)}</div>
                <div><span className="font-medium text-foreground">Published by:</span> {ownerName(dsMeta.published_by)}</div>
                <div><span className="font-medium text-foreground">Data steward:</span> {ownerName(dsMeta.data_steward_id)}</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {manage && (
          <TabsContent value="access" className="mt-4 space-y-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent API access</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Latest reads and failed authentication attempts against this dataset's API. Full history lives in the{" "}
                  <Link to="/logs" search={{ tab: "audit" }} className="underline">audit log</Link>.
                </p>
                {access.isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : (access.data ?? []).length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <Activity className="h-6 w-6 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No API access recorded yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {access.data!.map((e) => {
                      const failed = e.action === "api.auth.failed";
                      const rowCount = (e.metadata as { row_count?: number } | null)?.row_count;
                      const accessMode = (e.metadata as { access?: string } | null)?.access;
                      return (
                        <div key={e.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${failed ? "bg-destructive/15" : "bg-primary/15"}`}>
                            {failed ? <ShieldAlert className="h-4 w-4 text-destructive" /> : <KeyRound className="h-4 w-4 text-primary" />}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium">
                              {failed ? "Failed authentication" : "Data read"}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {e.actor_label || "Unknown"}
                              {e.ip ? ` · ${e.ip}` : ""}
                            </div>
                          </div>
                          <div className="ml-auto flex items-center gap-2">
                            {accessMode && (
                              <Badge variant="secondary" className="gap-1">
                                {accessMode === "public" ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                                {accessMode}
                              </Badge>
                            )}
                            {typeof rowCount === "number" && <Badge variant="secondary">{rowCount} rows</Badge>}
                            <span className="hidden text-xs text-muted-foreground sm:inline">
                              {new Date(e.created_at).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {(editable || manage) && (
        <Card className="mt-8 border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              To take the API offline without losing data, use{" "}
              <span className="font-medium text-foreground">Unpublish</span> under API availability
              above. Permanent delete cannot be undone.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="lifecycle-reason">Reason (optional, written to audit log)</Label>
              <Textarea
                id="lifecycle-reason"
                value={lifecycleReason}
                onChange={(e) => setLifecycleReason(e.target.value)}
                placeholder="e.g. compliance purge · duplicate"
                className="min-h-[72px]"
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {editable && isArchived && (
                <Button
                  variant="outline"
                  disabled={restoreMut.isPending}
                  onClick={() => restoreMut.mutate()}
                >
                  {restoreMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArchiveRestore className="h-4 w-4" />
                  )}
                  Restore API
                </Button>
              )}

              {manage && (
                <AlertDialog
                  open={deleteOpen}
                  onOpenChange={(open) => {
                    setDeleteOpen(open);
                    if (!open) setDeleteConfirmName("");
                  }}
                >
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <Trash2 className="h-4 w-4" /> Delete permanently
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Permanently delete “{ds.data.name}”?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes all versions, fields, and rows. Connectors and PDF drafts that pointed here
                        will be unlinked. This cannot be undone. A full snapshot is written to the audit log
                        before deletion.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-1.5 py-2">
                      <Label htmlFor="delete-confirm">
                        Type <span className="font-mono font-medium">{ds.data.name}</span> to confirm
                      </Label>
                      <Input
                        id="delete-confirm"
                        value={deleteConfirmName}
                        onChange={(e) => setDeleteConfirmName(e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className={buttonDestructiveClass}
                        disabled={
                          deleteMut.isPending || deleteConfirmName.trim() !== ds.data.name
                        }
                        onClick={(e) => {
                          e.preventDefault();
                          deleteMut.mutate();
                        }}
                      >
                        {deleteMut.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Delete forever"
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>

            {!manage && (
              <p className="text-xs text-muted-foreground">
                Permanent deletion requires owner or admin. Unpublish (keep data) is available above for
                anyone with edit access.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const buttonDestructiveClass =
  "bg-destructive text-destructive-foreground hover:bg-destructive/90";

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function EndpointRow({ method, label, url, onCopy }: { method: string; label: string; url: string; onCopy: (t: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
      <Badge className="bg-success/20 text-success">{method}</Badge>
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">{url}</code>
      <Button variant="ghost" size="icon" onClick={() => onCopy(url)}><Copy className="h-4 w-4" /></Button>
    </div>
  );
}

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copy(code)}><Copy className="h-3.5 w-3.5" /></Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">{code}</pre>
    </div>
  );
}
