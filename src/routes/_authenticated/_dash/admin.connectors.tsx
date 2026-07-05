import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canManage } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { sanitizeConnectorConfigForStorage, sftpSecretsEnvSnippet } from "@/lib/connector-config";
import {
  Cable,
  Plus,
  Server,
  FolderTree,
  HardDrive,
  Info,
  Trash2,
  PlayCircle,
  ScrollText,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/admin/connectors")({
  component: Connectors,
});

const typeMeta = {
  sftp: { label: "SFTP", icon: Server },
  nfs: { label: "NFS / Samba (mounted share)", icon: HardDrive },
  folder: { label: "Watched folder", icon: FolderTree },
} as const;

const statusMeta: Record<string, { icon: typeof CheckCircle2; className: string }> = {
  success: { icon: CheckCircle2, className: "text-emerald-500" },
  error: { icon: XCircle, className: "text-destructive" },
  running: { icon: Loader2, className: "text-primary animate-spin" },
  queued: { icon: Clock, className: "text-muted-foreground" },
};

function Connectors() {
  const { currentOrg, role } = useOrg();
  const orgId = currentOrg?.id;
  const manage = canManage(role);
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"sftp" | "nfs" | "folder">("sftp");
  const [host, setHost] = useState("");
  const [path, setPath] = useState("");
  const [username, setUsername] = useState("");
  const [schedule, setSchedule] = useState("0 * * * *");
  const [datasetId, setDatasetId] = useState<string>("none");
  const [logsFor, setLogsFor] = useState<{ id: string; name: string } | null>(null);
  const [secretsHint, setSecretsHint] = useState<{ id: string; name: string } | null>(null);

  const connectors = useQuery({
    queryKey: ["connectors", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from("connectors").select("*").eq("org_id", orgId!).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const datasets = useQuery({
    queryKey: ["datasets-min", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from("datasets").select("id, name").eq("org_id", orgId!).order("name");
      if (error) throw error;
      return data;
    },
  });

  const runs = useQuery({
    queryKey: ["connector-runs", logsFor?.id],
    enabled: !!logsFor,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("connector_runs")
        .select("*")
        .eq("connector_id", logsFor!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  async function createConnector() {
    if (!orgId || !name.trim()) return;
    const config = sanitizeConnectorConfigForStorage({ host, path, username });
    const { data, error } = await supabase
      .from("connectors")
      .insert({
        org_id: orgId,
        name: name.trim(),
        type,
        config,
        schedule,
        enabled: false,
        dataset_id: datasetId === "none" ? null : datasetId,
      })
      .select("id")
      .single();
    if (error) return toast.error(error.message);
    toast.success("Connector saved");
    setOpen(false);
    setName(""); setHost(""); setPath(""); setUsername(""); setDatasetId("none");
    queryClient.invalidateQueries({ queryKey: ["connectors", orgId] });
    if (type === "sftp" && data?.id) {
      setSecretsHint({ id: data.id, name: name.trim() });
    }
  }

  async function toggle(id: string, enabled: boolean) {
    const { error } = await supabase.from("connectors").update({ enabled }).eq("id", id);
    if (error) return toast.error(error.message);
    queryClient.invalidateQueries({ queryKey: ["connectors", orgId] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("connectors").delete().eq("id", id);
    if (error) return toast.error(error.message);
    queryClient.invalidateQueries({ queryKey: ["connectors", orgId] });
  }

  async function testConnector(id: string) {
    if (!orgId) return;
    const { error } = await supabase.from("connector_runs").insert({
      org_id: orgId,
      connector_id: id,
      kind: "test",
      status: "queued",
      message: "Test queued — the companion worker will execute it on its next poll.",
    });
    if (error) return toast.error(error.message);
    toast.success("Test queued for the worker");
    queryClient.invalidateQueries({ queryKey: ["connector-runs", id] });
  }

  return (
    <AdminShell>
      <div>
      <PageHeader
        title="Connectors"
        description="Pull spreadsheets automatically from SFTP, network shares, or watched folders."
        action={manage && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New connector</Button>}
      />

      <div className="mb-6 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 text-primary" />
        <span>
          Connectors define <em>where</em> to fetch files. Actual polling runs in the open-source{" "}
          <code className="font-mono text-xs">gridwire-worker</code> companion service (see the README), which reads
          these configs, fetches files, and pushes them into the target dataset. <strong>SFTP passwords and private keys
          are never stored in the database</strong> — add them to the worker&apos;s <code className="font-mono text-xs">SFTP_SECRETS</code>{" "}
          environment variable (see docs/connector-credentials-migration.md). Use <strong>Test</strong> to queue a connectivity check and{" "}
          <strong>Logs</strong> to see each run.
        </span>
      </div>

      {connectors.data && connectors.data.length > 0 ? (
        <div className="space-y-2">
          {connectors.data.map((c) => {
            const meta = typeMeta[c.type];
            const Icon = meta.icon;
            const cfg = (c.config ?? {}) as { host?: string; path?: string };
            const targetName = datasets.data?.find((d) => d.id === c.dataset_id)?.name;
            return (
              <Card key={c.id}>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium">{c.name}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {meta.label}{cfg.host ? ` · ${cfg.host}` : ""}{cfg.path ? `:${cfg.path}` : ""}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>→ {targetName ? `dataset: ${targetName}` : "no target dataset"}</span>
                      {c.last_status && (
                        <Badge variant={c.last_status === "error" ? "destructive" : "secondary"} className="text-[10px]">
                          last: {c.last_status}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-mono">{c.schedule}</Badge>
                    <Button variant="ghost" size="sm" onClick={() => setLogsFor({ id: c.id, name: c.name })}>
                      <ScrollText className="h-4 w-4" /> Logs
                    </Button>
                    {manage && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => testConnector(c.id)}>
                          <PlayCircle className="h-4 w-4" /> Test
                        </Button>
                        <div className="flex items-center gap-2">
                          <Switch checked={c.enabled} onCheckedChange={(v) => toggle(c.id, v)} />
                          <Button variant="ghost" size="icon" onClick={() => remove(c.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15">
              <Cable className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">No connectors configured.</p>
            {manage && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New connector</Button>}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New connector</DialogTitle>
            <DialogDescription>Define a source location. The worker uses this to fetch files on a schedule.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor SFTP" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sftp">SFTP</SelectItem>
                  <SelectItem value="nfs">NFS / network share</SelectItem>
                  <SelectItem value="folder">Watched folder</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Target dataset</Label>
              <Select value={datasetId} onValueChange={setDatasetId}>
                <SelectTrigger><SelectValue placeholder="Select dataset" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No target (configure later)</SelectItem>
                  {datasets.data?.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Fetched files publish a new version of this dataset.</p>
            </div>
            {type !== "folder" && (
              <div className="space-y-1.5">
                <Label>{type === "sftp" ? "Host" : "Mount / share address"}</Label>
                <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder={type === "sftp" ? "sftp.vendor.com" : "//nas/share"} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Path / pattern</Label>
              <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/exports/*.xlsx" />
            </div>
            {type === "sftp" && (
              <>
                <div className="space-y-1.5">
                  <Label>Username</Label>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="svc_gridwire" />
                </div>
                <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-muted-foreground">
                  After saving, copy the connector ID and add its password or private key to the worker{" "}
                  <code className="font-mono">SFTP_SECRETS</code> JSON in your deployment environment — not in this form.
                </p>
              </>
            )}
            <div className="space-y-1.5">
              <Label>Schedule (cron)</Label>
              <Input value={schedule} onChange={(e) => setSchedule(e.target.value)} className="font-mono" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={createConnector} disabled={!name.trim()}>Save connector</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!secretsHint} onOpenChange={(o) => !o && setSecretsHint(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure worker credentials</DialogTitle>
            <DialogDescription>
              SFTP secrets live only on the <code className="font-mono text-xs">gridwire-worker</code> container. Merge
              this entry into <code className="font-mono text-xs">SFTP_SECRETS</code> and restart the worker.
            </DialogDescription>
          </DialogHeader>
          {secretsHint && (
            <div className="space-y-2">
              <p className="text-sm">
                Connector <strong>{secretsHint.name}</strong>
              </p>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
                {`{\n  ${sftpSecretsEnvSnippet(secretsHint.id)}\n}`}
              </pre>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setSecretsHint(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!logsFor} onOpenChange={(o) => !o && setLogsFor(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Run logs · {logsFor?.name}</SheetTitle>
            <SheetDescription>Most recent connector polls and tests.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {runs.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {runs.data && runs.data.length === 0 && (
              <p className="text-sm text-muted-foreground">No runs yet. Queue a test or wait for the next poll.</p>
            )}
            {runs.data?.map((r) => {
              const sm = statusMeta[r.status] ?? statusMeta.queued;
              const SIcon = sm.icon;
              return (
                <div key={r.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <SIcon className={`h-4 w-4 ${sm.className}`} />
                    <span className="font-medium capitalize">{r.kind}</span>
                    <Badge variant="secondary" className="text-[10px]">{r.status}</Badge>
                    {"dead_letter_at" in r && r.dead_letter_at && (
                      <Badge variant="destructive" className="text-[10px]">dead letter</Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </span>
                  </div>
                  {r.message && <p className="mt-1.5 text-xs text-muted-foreground">{r.message}</p>}
                  {(r.files_found > 0 || r.files_ingested > 0) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.files_found} found · {r.files_ingested} ingested
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
      </div>
    </AdminShell>
  );
}
