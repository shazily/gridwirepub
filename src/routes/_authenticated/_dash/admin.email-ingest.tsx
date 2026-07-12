import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/use-org";
import { AdminShell } from "@/components/admin-shell";
import { PageHeader } from "@/components/app-shell";
import { HelpTip } from "@/components/help-tip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  deleteEmailIngestTemplate,
  getEmailIngestSetup,
  testEmailIngest,
  uploadEmailIngestTemplate,
} from "@/lib/email-ingest.functions";
import {
  INGEST_STATUS_LABELS,
  isValidIngestEmail,
  suggestIngestAddress,
} from "@/lib/ingest-email";
import { Mail, Plus, Trash2, FlaskConical, Upload, Copy, ShieldCheck, Server, HardDrive } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/admin/email-ingest")({
  component: AdminEmailIngestPage,
});

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1]! : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function copyText(label: string, value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy to clipboard");
  }
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "ingested") return "default";
  if (status.startsWith("accepted")) return "default";
  if (status === "ingest_failed" || status === "quarantined") return "destructive";
  return "secondary";
}

function AdminEmailIngestPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const orgSlug = currentOrg?.slug ?? "";
  const [enabled, setEnabled] = useState(false);
  const [inboundAddress, setInboundAddress] = useState("");
  const [savingAddress, setSavingAddress] = useState(false);
  const [senderEmail, setSenderEmail] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [subjectPattern, setSubjectPattern] = useState("");
  const [targetDatasetId, setTargetDatasetId] = useState<string>("new");
  const [templateLoadMode, setTemplateLoadMode] = useState<"full" | "incremental">("full");
  const [uploading, setUploading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testFile, setTestFile] = useState<File | null>(null);
  const templateFileRef = useRef<HTMLInputElement>(null);
  const testFileRef = useRef<HTMLInputElement>(null);
  const mailboxHydratedForOrg = useRef<string | null>(null);
  const [testFrom, setTestFrom] = useState("");
  const [testSubject, setTestSubject] = useState("");

  const mailbox = useQuery({
    queryKey: ["email-mailbox", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_ingest_mailboxes")
        .select("*")
        .eq("org_id", orgId!)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      return data;
    },
  });

  const senders = useQuery({
    queryKey: ["email-senders", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_ingest_sender_allowlist")
        .select("*")
        .eq("org_id", orgId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const notifyRecipients = useQuery({
    queryKey: ["email-ingest-notify-recipients", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_ingest_notification_recipients")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const templates = useQuery({
    queryKey: ["email-templates", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_ingest_templates")
        .select("*")
        .eq("org_id", orgId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const messages = useQuery({
    queryKey: ["email-messages", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_ingest_messages")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const datasets = useQuery({
    queryKey: ["datasets-ingest", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("datasets")
        .select("id, name")
        .eq("org_id", orgId!)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const setup = useQuery({
    queryKey: ["email-ingest-setup", orgId],
    enabled: !!orgId,
    queryFn: () => getEmailIngestSetup({ data: { orgId: orgId! } }),
  });

  useEffect(() => {
    if (!orgId) return;
    if (mailboxHydratedForOrg.current !== orgId) {
      mailboxHydratedForOrg.current = null;
    }
    if (mailbox.isLoading || mailboxHydratedForOrg.current === orgId) return;

    setEnabled(mailbox.data?.enabled ?? false);
    if (mailbox.data?.inbound_address) {
      setInboundAddress(mailbox.data.inbound_address);
    } else {
      setInboundAddress(suggestIngestAddress(orgSlug, orgId));
    }
    mailboxHydratedForOrg.current = orgId;
  }, [mailbox.data, mailbox.isLoading, orgId, orgSlug]);

  useEffect(() => {
    if (testFrom.trim() || !(senders.data ?? []).length) return;
    const first = senders.data![0]!.email_pattern;
    if (first.startsWith("@")) return;
    setTestFrom(first);
  }, [senders.data, testFrom]);

  const subjectRuleHints = useMemo(() => {
    const patterns = (templates.data ?? [])
      .filter((t) => t.subject_pattern?.trim())
      .map((t) => ({ name: t.name, pattern: t.subject_pattern!.trim() }));
    return patterns;
  }, [templates.data]);

  async function saveInboundAddress() {
    if (!orgId) return;
    const addr = inboundAddress.trim().toLowerCase();
    if (!isValidIngestEmail(addr)) {
      toast.error("Enter a valid email address for this workspace");
      return;
    }
    setSavingAddress(true);
    try {
      const { error } = await supabase.from("email_ingest_mailboxes").upsert({
        org_id: orgId,
        inbound_address: addr,
        enabled,
      });
      if (error) throw error;
      toast.success("Workspace ingest address saved");
      void mailbox.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save address");
    } finally {
      setSavingAddress(false);
    }
  }

  async function ensureMailbox() {
    if (!orgId) return;
    const addr = inboundAddress.trim().toLowerCase() || suggestIngestAddress(orgSlug, orgId);
    const { error } = await supabase.from("email_ingest_mailboxes").upsert({
      org_id: orgId,
      inbound_address: addr,
      enabled,
    });
    if (error) throw error;
  }

  async function toggleEnabled(value: boolean) {
    if (!orgId) return;
    try {
      setEnabled(value);
      await supabase.from("email_ingest_mailboxes").upsert({
        org_id: orgId,
        inbound_address: inboundAddress.trim().toLowerCase() || suggestIngestAddress(orgSlug, orgId),
        enabled: value,
      });
      toast.success(value ? "Email ingest enabled" : "Email ingest disabled");
      void mailbox.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function addSender() {
    if (!orgId || !senderEmail.trim()) return;
    try {
      await ensureMailbox();
      const { error } = await supabase.from("email_ingest_sender_allowlist").insert({
        org_id: orgId,
        email_pattern: senderEmail.trim().toLowerCase(),
      });
      if (error) throw error;
      setSenderEmail("");
      void senders.refetch();
      toast.success("Sender allowlisted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add sender");
    }
  }

  async function addNotifyRecipient() {
    if (!orgId || !notifyEmail.trim()) return;
    const email = notifyEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid email address");
      return;
    }
    try {
      const { error } = await supabase.from("email_ingest_notification_recipients").insert({
        org_id: orgId,
        email,
        notify_on_success: true,
        notify_on_failure: true,
      });
      if (error) throw error;
      setNotifyEmail("");
      void notifyRecipients.refetch();
      toast.success("Notification recipient added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add recipient");
    }
  }

  async function removeNotifyRecipient(id: string) {
    if (!orgId) return;
    const { error } = await supabase
      .from("email_ingest_notification_recipients")
      .delete()
      .eq("id", id)
      .eq("org_id", orgId);
    if (error) return toast.error(error.message);
    void notifyRecipients.refetch();
    toast.success("Recipient removed");
  }

  async function toggleNotifyFlag(
    id: string,
    field: "notify_on_success" | "notify_on_failure",
    value: boolean,
  ) {
    if (!orgId) return;
    const { error } = await supabase
      .from("email_ingest_notification_recipients")
      .update({ [field]: value })
      .eq("id", id)
      .eq("org_id", orgId);
    if (error) return toast.error(error.message);
    void notifyRecipients.refetch();
  }

  async function uploadTemplate(file: File) {
    if (!orgId || !templateName.trim()) {
      toast.error("Enter a template name first");
      return;
    }
    setUploading(true);
    try {
      const fileBase64 = await fileToBase64(file);
      const result = await uploadEmailIngestTemplate({
        data: {
          orgId,
          name: templateName.trim(),
          subjectPattern: subjectPattern.trim() || undefined,
          fileName: file.name,
          fileBase64,
          targetDatasetId: targetDatasetId === "new" ? undefined : targetDatasetId,
          loadMode: templateLoadMode,
        },
      });
      setTemplateName("");
      setSubjectPattern("");
      if (templateFileRef.current) templateFileRef.current.value = "";
      void templates.refetch();
      toast.success(
        `Template saved with ${result.schema.columns.length} expected columns (logged to audit trail)`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function runTestIngest() {
    if (!orgId || !testFrom.trim()) {
      toast.error("Enter a test sender address that is on the allowlist");
      return;
    }
    if (!testFile) {
      toast.error("Choose an attachment file first");
      return;
    }
    setTesting(true);
    try {
      const fileBase64 = await fileToBase64(testFile);
      const result = await testEmailIngest({
        data: {
          orgId,
          fromAddress: testFrom.trim(),
          subject: testSubject.trim() || "Test ingest",
          fileName: testFile.name,
          fileBase64,
        },
      });
      void messages.refetch();
      if (result.status === "ingested") {
        toast.success(`Imported to dataset — ${result.detail ?? "see Recent messages"}`);
      } else if (result.status === "accepted_pending_ingest") {
        toast.success("Validated — import in progress");
      } else {
        toast.error(`Rejected: ${INGEST_STATUS_LABELS[result.status] ?? result.status}${result.detail ? ` — ${result.detail}` : ""}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  async function removeTemplate(templateId: string) {
    if (!orgId) return;
    try {
      await deleteEmailIngestTemplate({ data: { orgId, templateId } });
      void templates.refetch();
      toast.success("Template removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <AdminShell>
      <PageHeader
        title="Email ingest"
        description="Upload Excel/CSV templates that define expected columns. Inbound attachments must match exactly or they are rejected and logged."
        backTo="/admin"
        backLabel="Admin"
        crumbs={[{ label: "Admin", to: "/admin" }, { label: "Email ingest" }]}
      />

      <Card className="mb-4 border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive className="h-4 w-4" />
            Where file data is stored
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Column templates</strong> — column schema in Postgres; the uploaded
            template file is saved to your workspace object store (Minio/S3) under{" "}
            <code className="text-xs">email-ingest/templates/…</code>.
          </p>
          <p>
            <strong className="text-foreground">Inbound email attachments</strong> — accepted files land in object
            storage, then import as dataset versions (rows in Postgres, Parquet snapshots in object storage).
          </p>
          <p>
            <strong className="text-foreground">Your own file server</strong> — attach corporate NFS, Samba/CIFS, or
            SFTP via{" "}
            <Link to="/admin/connectors" className="text-primary underline-offset-4 hover:underline">
              Admin → Connectors
            </Link>
            , or point blob storage to your Minio/S3 endpoint in{" "}
            <Link to="/admin/storage" className="text-primary underline-offset-4 hover:underline">
              Admin → Storage
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" />
            Inbound mailbox
            <HelpTip title="How email ingest works" learnMoreHref="/help#email-ingest">
              Upload a template spreadsheet first — its column headers become the schema. Your mail
              gateway POSTs parsed JSON to the inbound webhook. Every accept/reject is written to the
              audit log.
            </HelpTip>
          </CardTitle>
          <CardDescription>
            Webhook URL: <code className="text-xs">/api/public/inbound/webhook</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ingest-address">Workspace ingest email</Label>
            <div className="flex gap-2">
              <Input
                id="ingest-address"
                value={inboundAddress}
                onChange={(e) => setInboundAddress(e.target.value)}
                placeholder="reports@ingest.yourdomain.com"
              />
              <Button variant="outline" onClick={saveInboundAddress} disabled={savingAddress}>
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Route mail to this address via your organization&apos;s mail server or any inbound gateway.
              The gateway POSTs parsed JSON to the webhook above — Gridwire does not host a mailbox.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="ingest-enabled">Accept inbound email for this workspace</Label>
            <Switch id="ingest-enabled" checked={enabled} onCheckedChange={toggleEnabled} />
          </div>
          {setup.data && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge variant={setup.data.clamav.reachable ? "default" : "secondary"} className="gap-1">
                <ShieldCheck className="h-3 w-3" />
                ClamAV:{" "}
                {setup.data.clamav.configured
                  ? setup.data.clamav.reachable
                    ? "active"
                    : "unreachable"
                  : "not configured"}
              </Badge>
              <span className="text-xs text-muted-foreground">{setup.data.clamav.detail}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {setup.data && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4" />
              Inbound mail routing
            </CardTitle>
            <CardDescription>
              Gridwire receives mail via webhook — configure your inbound gateway once, then use the workspace ingest address above.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Inbound webhook URL</Label>
              <div className="flex gap-2">
                <Input readOnly value={setup.data.webhookUrl} className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Copy webhook URL"
                  onClick={() => void copyText("Webhook URL", setup.data!.webhookUrl)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{setup.data.webhookSchemaNote}</p>
              {setup.data.webhookAuthConfigured ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Webhook signing is enabled — your mail gateway must send header{" "}
                  <code className="text-[11px]">X-Gridwire-Webhook-Secret</code>.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{setup.data.webhookAuthNote}</p>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium">Inbound gateway</p>
                <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                  {setup.data.inboundWebhookSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Corporate mail (optional)</p>
                <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                  {setup.data.mailForwardSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Allowed senders</CardTitle>
            <CardDescription>Only these addresses can submit files by email.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(senders.data ?? []).map((s) => (
              <div key={s.id} className="text-sm">
                <code>{s.email_pattern}</code>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                placeholder="reports@company.com or @company.com"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
              />
              <Button variant="outline" onClick={addSender}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ingest notification emails</CardTitle>
            <CardDescription>
              Workspace receivers get emailed on success or failure (in addition to the in-app bell).
              On rejection, the original sender is also emailed automatically with the rejection reason.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(notifyRecipients.data ?? []).map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-2 rounded border border-border p-2 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <code className="truncate">{r.email}</code>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs">
                    <Switch
                      checked={r.notify_on_success}
                      onCheckedChange={(v) => void toggleNotifyFlag(r.id, "notify_on_success", v)}
                    />
                    Success
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Switch
                      checked={r.notify_on_failure}
                      onCheckedChange={(v) => void toggleNotifyFlag(r.id, "notify_on_failure", v)}
                    />
                    Failure
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${r.email}`}
                    onClick={() => void removeNotifyRecipient(r.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                placeholder="ops@company.com"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addNotifyRecipient();
                }}
              />
              <Button variant="outline" onClick={() => void addNotifyRecipient()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Add multiple addresses. Each can opt in to success and/or failure emails independently.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-1">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" />
              Column templates
            </CardTitle>
            <CardDescription>
              Upload the Excel or CSV file that defines expected columns. Real attachments must match.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(templates.data ?? []).map((t) => {
              const schema = t.schema_snapshot as { columns?: { api_name: string }[] } | null;
              const cols = schema?.columns?.map((c) => c.api_name).join(", ") ?? "no schema";
              const target = (datasets.data ?? []).find((d) => d.id === t.target_dataset_id);
              return (
                <div
                  key={t.id}
                  className="flex items-start justify-between gap-2 rounded border border-border p-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium">{t.name}</span>
                    {t.template_file_name && (
                      <span className="ml-2 text-xs text-muted-foreground">{t.template_file_name}</span>
                    )}
                    <p className="mt-1 truncate text-xs text-muted-foreground">{cols}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Target: {target ? target.name : "New dataset on first import"} · {t.load_mode ?? "full"} load
                      {(t as { template_storage_ref?: string | null }).template_storage_ref
                        ? " · file in object storage"
                        : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                      Match rules: subject{t.subject_pattern ? ` contains "${t.subject_pattern}"` : " (any)"}
                      {" · "}
                      attachment {t.attachment_pattern ?? "*.xlsx"}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => void removeTemplate(t.id)}
                    aria-label="Delete template"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            <Input
              placeholder="Template name (e.g. Monthly sales report)"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
            <Input
              placeholder="Subject contains (optional — leave blank to match any subject)"
              value={subjectPattern}
              onChange={(e) => setSubjectPattern(e.target.value)}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Import into dataset</Label>
                <Select modal={false} value={targetDatasetId} onValueChange={setTargetDatasetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Create new dataset" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Create new dataset from template name</SelectItem>
                    {(datasets.data ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Load mode</Label>
                <Select
                  modal={false}
                  value={templateLoadMode}
                  onValueChange={(v) => setTemplateLoadMode(v as "full" | "incremental")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full replace</SelectItem>
                    <SelectItem value="incremental">Incremental (when keys configured)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Input
              ref={templateFileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadTemplate(file);
              }}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" />
            Test ingest
          </CardTitle>
          <CardDescription>
            Simulate an inbound email without an external mail gateway. The test subject and attachment filename must match a template&apos;s
            rules (shown in amber on each template card).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="test-from">From (must be allowlisted)</Label>
            <Input
              id="test-from"
              value={testFrom}
              onChange={(e) => setTestFrom(e.target.value)}
              placeholder="reports@company.com"
              disabled={testing}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="test-subject">Subject</Label>
            <Input
              id="test-subject"
              value={testSubject}
              onChange={(e) => setTestSubject(e.target.value)}
              placeholder="Enter subject line to test"
              disabled={testing}
              autoComplete="off"
            />
            {subjectRuleHints.length > 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Template rules:{" "}
                {subjectRuleHints.map((h) => `"${h.name}" needs subject containing "${h.pattern}"`).join(" · ")}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">No subject rules — any subject matches.</p>
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="test-attachment">Attachment to validate</Label>
            <Input
              id="test-attachment"
              ref={testFileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={testing}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setTestFile(file);
              }}
            />
            {testFile && (
              <p className="text-xs text-muted-foreground">Selected: {testFile.name}</p>
            )}
          </div>
          <div className="sm:col-span-2">
            <Button type="button" onClick={() => void runTestIngest()} disabled={testing || !testFile}>
              {testing ? "Running test…" : "Run test ingest"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Recent messages</CardTitle>
          <CardDescription>Rejected and accepted inbound mail — details also appear in Audit log.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(messages.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No inbound messages yet.</p>
          )}
          {(messages.data ?? []).map((m) => (
            <div key={m.id} className="rounded border border-border px-3 py-2 text-xs">
              <div className="flex flex-wrap justify-between gap-2">
                <span>
                  {m.from_address} — {m.subject ?? "(no subject)"}
                </span>
                <Badge variant={statusBadgeVariant(m.status)}>
                  {INGEST_STATUS_LABELS[m.status] ?? m.status}
                </Badge>
              </div>
              {m.rejection_reason && (
                <p className="mt-1 text-muted-foreground">{m.rejection_reason}</p>
              )}
              {m.ingest_error && (
                <p className="mt-1 text-destructive">{m.ingest_error}</p>
              )}
              {m.scan_detail && (
                <p className="mt-0.5 text-muted-foreground">Scan: {m.scan_detail}</p>
              )}
              {m.attachment_name && (
                <p className="mt-0.5 text-muted-foreground">Attachment: {m.attachment_name}</p>
              )}
              {m.dataset_id && (
                <p className="mt-1">
                  <Link
                    to="/datasets/$datasetId"
                    params={{ datasetId: m.dataset_id }}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    View imported dataset
                  </Link>
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </AdminShell>
  );
}
