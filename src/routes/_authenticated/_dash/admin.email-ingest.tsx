import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { toast } from "sonner";
import {
  deleteEmailIngestTemplate,
  getEmailIngestSetup,
  testEmailIngest,
  updateEmailIngestTemplate,
  uploadEmailIngestTemplate,
} from "@/lib/email-ingest.functions";
import {
  INGEST_STATUS_LABELS,
  isPlaceholderIngestDomain,
  isValidIngestEmail,
  suggestIngestAddress,
} from "@/lib/ingest-email";
import {
  Check,
  Circle,
  Copy,
  FlaskConical,
  Mail,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";

const emailIngestTabSchema = z.object({
  tab: z
    .enum(["mailbox", "senders", "templates", "notify", "test"])
    .optional()
    .catch("mailbox"),
});

export const Route = createFileRoute("/_authenticated/_dash/admin/email-ingest")({
  validateSearch: (s: Record<string, unknown>) => emailIngestTabSchema.parse(s),
  component: AdminEmailIngestPage,
});

type ConfirmKind = "mailbox" | "sender" | "notify" | "template" | "activate" | "deactivate";

type ConfirmState = {
  kind: ConfirmKind;
  title: string;
  summary: { label: string; value: string }[];
  confirmLabel: string;
} | null;

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

function StepDot({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {done ? (
        <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
      ) : (
        <Circle className="h-3.5 w-3.5" aria-hidden />
      )}
      <span className={done ? "text-foreground" : undefined}>{label}</span>
    </div>
  );
}

function ConfirmSetupDialog({
  open,
  title,
  description,
  summary,
  confirmLabel,
  confirming,
  onConfirm,
  onEdit,
  onDiscard,
}: {
  open: boolean;
  title: string;
  description?: string;
  summary: { label: string; value: string }[];
  confirmLabel: string;
  confirming: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !confirming) onEdit();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <dl className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          {summary.map((row) => (
            <div key={row.label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {row.label}
              </dt>
              <dd className="mt-0.5 break-words font-medium text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" disabled={confirming} onClick={onDiscard}>
            Discard
          </Button>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button type="button" variant="outline" className="flex-1 sm:flex-none" disabled={confirming} onClick={onEdit}>
              Edit
            </Button>
            <Button type="button" className="flex-1 sm:flex-none" disabled={confirming} onClick={onConfirm}>
              {confirming ? "Saving…" : confirmLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdminEmailIngestPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const orgSlug = currentOrg?.slug ?? "";

  const [enabled, setEnabled] = useState(false);
  const [inboundAddress, setInboundAddress] = useState("");
  const [aliasDrafts, setAliasDrafts] = useState<string[]>([]);
  const [savedEnabled, setSavedEnabled] = useState(false);
  const [savedAddress, setSavedAddress] = useState("");
  const [savedAliases, setSavedAliases] = useState<string[]>([]);
  const [aliasInput, setAliasInput] = useState("");
  const [saving, setSaving] = useState(false);

  type TemplateRow = {
    id: string;
    name: string;
    subject_pattern: string | null;
    attachment_pattern: string | null;
    target_dataset_id: string | null;
    load_mode: string | null;
    active: boolean | null;
    template_file_name: string | null;
    schema_snapshot: unknown;
  };
  const [templateDetail, setTemplateDetail] = useState<TemplateRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editTargetDatasetId, setEditTargetDatasetId] = useState<string>("new");
  const [editLoadMode, setEditLoadMode] = useState<"full" | "incremental">("full");
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const editFileRef = useRef<HTMLInputElement>(null);

  const [senderEmail, setSenderEmail] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifySuccess, setNotifySuccess] = useState(true);
  const [notifyFailure, setNotifyFailure] = useState(true);

  const [templateName, setTemplateName] = useState("");
  const [subjectPattern, setSubjectPattern] = useState("");
  const [targetDatasetId, setTargetDatasetId] = useState<string>("new");
  const [templateLoadMode, setTemplateLoadMode] = useState<"full" | "incremental">("full");
  const [templateFile, setTemplateFile] = useState<File | null>(null);

  const [testing, setTesting] = useState(false);
  const [testFile, setTestFile] = useState<File | null>(null);
  const [testFrom, setTestFrom] = useState("");
  const [testSubject, setTestSubject] = useState("");

  const templateFileRef = useRef<HTMLInputElement>(null);
  const testFileRef = useRef<HTMLInputElement>(null);
  const mailboxHydratedForOrg = useRef<string | null>(null);

  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const navigate = Route.useNavigate();
  const { tab: tabParam } = Route.useSearch();
  const tab = tabParam ?? "mailbox";

  function setTab(next: string) {
    const parsed = emailIngestTabSchema.shape.tab.safeParse(next);
    void navigate({
      search: { tab: parsed.success && parsed.data ? parsed.data : "mailbox" },
      replace: true,
    });
  }
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

  const aliases = useQuery({
    queryKey: ["email-mailbox-aliases", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_ingest_mailbox_aliases")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
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
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
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
    if (mailbox.isLoading || aliases.isLoading) return;

    const domain = setup.data?.ingestDomain;
    const saved = mailbox.data?.inbound_address?.trim().toLowerCase() || "";
    const on = mailbox.data?.enabled ?? false;
    const aliasList = (aliases.data ?? []).map((a) => a.inbound_address.toLowerCase());

    if (mailboxHydratedForOrg.current !== orgId) {
      const addr = saved || suggestIngestAddress(orgSlug, orgId, domain);
      setEnabled(on);
      setSavedEnabled(on);
      setInboundAddress(addr);
      setSavedAddress(saved);
      setAliasDrafts(aliasList);
      setSavedAliases(aliasList);
      setTestFrom("");
      mailboxHydratedForOrg.current = orgId;
      return;
    }

    setSavedEnabled(on);
    setSavedAddress(saved);
    setSavedAliases(aliasList);
  }, [
    mailbox.data,
    mailbox.isLoading,
    aliases.data,
    aliases.isLoading,
    orgId,
    orgSlug,
    setup.data?.ingestDomain,
  ]);

  // Upgrade unsaved placeholder suggestion once real ingest domain is known.
  useEffect(() => {
    if (!orgId || savedAddress) return;
    const domain = setup.data?.ingestDomain;
    if (!domain || isPlaceholderIngestDomain(domain)) return;
    setInboundAddress((prev) => {
      const host = prev.split("@")[1] ?? "";
      if (!isPlaceholderIngestDomain(host)) return prev;
      return suggestIngestAddress(orgSlug, orgId, domain);
    });
  }, [orgId, orgSlug, savedAddress, setup.data?.ingestDomain]);

  useEffect(() => {
    if (testFrom.trim() || !(senders.data ?? []).length) return;
    const first = senders.data![0]!.email_pattern;
    if (first.startsWith("@")) return;
    setTestFrom(first);
  }, [senders.data, testFrom]);

  const normalizedAliasDrafts = useMemo(
    () =>
      [...new Set(aliasDrafts.map((a) => a.trim().toLowerCase()).filter(Boolean))].sort(),
    [aliasDrafts],
  );
  const normalizedSavedAliases = useMemo(
    () => [...new Set(savedAliases.map((a) => a.trim().toLowerCase()).filter(Boolean))].sort(),
    [savedAliases],
  );

  const mailboxDirty =
    inboundAddress.trim().toLowerCase() !== savedAddress.trim().toLowerCase() ||
    enabled !== savedEnabled ||
    JSON.stringify(normalizedAliasDrafts) !== JSON.stringify(normalizedSavedAliases);

  const checklist = useMemo(
    () => ({
      address: !!savedAddress && isValidIngestEmail(savedAddress),
      senders: (senders.data ?? []).length > 0,
      templates: (templates.data ?? []).some((t) => t.active !== false),
      enabled: savedEnabled,
    }),
    [savedAddress, savedEnabled, senders.data, templates.data],
  );

  const subjectRuleHints = useMemo(() => {
    return (templates.data ?? [])
      .filter((t) => t.active !== false && t.subject_pattern?.trim())
      .map((t) => ({ name: t.name, pattern: t.subject_pattern!.trim() }));
  }, [templates.data]);

  async function ensureMailboxRow(addr: string, isEnabled: boolean) {
    if (!orgId) throw new Error("No organization");
    const { error } = await supabase.from("email_ingest_mailboxes").upsert({
      org_id: orgId,
      inbound_address: addr,
      enabled: isEnabled,
    });
    if (error) throw error;
  }

  async function syncMailboxAliases(primary: string, nextAliases: string[]) {
    if (!orgId) throw new Error("No organization");
    const primaryNorm = primary.trim().toLowerCase();
    const desired = [
      ...new Set(
        nextAliases
          .map((a) => a.trim().toLowerCase())
          .filter((a) => isValidIngestEmail(a) && a !== primaryNorm),
      ),
    ];

    const { data: existing, error: listErr } = await supabase
      .from("email_ingest_mailbox_aliases")
      .select("id, inbound_address")
      .eq("org_id", orgId);
    if (listErr) throw listErr;

    const existingNorm = new Map(
      (existing ?? []).map((row) => [row.inbound_address.toLowerCase(), row.id]),
    );

    for (const [addr, id] of existingNorm) {
      if (!desired.includes(addr)) {
        const { error } = await supabase
          .from("email_ingest_mailbox_aliases")
          .delete()
          .eq("id", id)
          .eq("org_id", orgId);
        if (error) throw error;
      }
    }

    for (const addr of desired) {
      if (existingNorm.has(addr)) continue;
      const { error } = await supabase.from("email_ingest_mailbox_aliases").insert({
        org_id: orgId,
        inbound_address: addr,
      });
      if (error) throw error;
    }

    return desired;
  }

  function addAliasDraft() {
    const addr = aliasInput.trim().toLowerCase();
    if (!isValidIngestEmail(addr)) {
      toast.error("Enter a valid alias email");
      return;
    }
    if (addr === inboundAddress.trim().toLowerCase()) {
      toast.error("Alias cannot match the primary address");
      return;
    }
    if (aliasDrafts.some((a) => a.toLowerCase() === addr)) {
      toast.error("Alias already listed");
      return;
    }
    setAliasDrafts((prev) => [...prev, addr]);
    setAliasInput("");
  }

  function openMailboxConfirm() {
    const addr = inboundAddress.trim().toLowerCase();
    if (!isValidIngestEmail(addr)) {
      toast.error("Enter a valid workspace ingest email before saving");
      return;
    }
    for (const alias of normalizedAliasDrafts) {
      if (!isValidIngestEmail(alias)) {
        toast.error(`Invalid alias: ${alias}`);
        return;
      }
      if (alias === addr) {
        toast.error("Remove aliases that duplicate the primary address");
        return;
      }
    }
    setConfirm({
      kind: "mailbox",
      title: "Save mailbox settings?",
      confirmLabel: "Confirm save",
      summary: [
        { label: "Primary ingest address", value: addr },
        {
          label: "Aliases",
          value: normalizedAliasDrafts.length
            ? normalizedAliasDrafts.join(", ")
            : "None",
        },
        { label: "Accept inbound mail", value: enabled ? "On — mail will be processed" : "Off — mail will be rejected" },
      ],
    });
  }

  function openActivateConfirm(next: boolean) {
    const addr = inboundAddress.trim().toLowerCase() || savedAddress || suggestIngestAddress(orgSlug, orgId ?? "");
    if (!isValidIngestEmail(addr)) {
      toast.error("Save a valid ingest address before activating");
      setTab("mailbox");
      return;
    }
    if (next && (senders.data ?? []).length === 0) {
      toast.error("Add at least one allowed sender before activating");
      setTab("senders");
      return;
    }
    if (next && !(templates.data ?? []).some((t) => t.active !== false)) {
      toast.error("Add an active ingest template before activating");
      setTab("templates");
      return;
    }
    setEnabled(next);
    setConfirm({
      kind: next ? "activate" : "deactivate",
      title: next ? "Activate email ingest?" : "Pause email ingest?",
      confirmLabel: next ? "Activate" : "Pause",
      summary: [
        { label: "Ingest address", value: addr },
        {
          label: "Effect",
          value: next
            ? "Inbound webhook messages matching this workspace will be accepted and processed."
            : "Inbound mail for this workspace will be rejected until you activate again.",
        },
        { label: "Allowed senders", value: String((senders.data ?? []).length) },
        {
          label: "Active templates",
          value: String((templates.data ?? []).filter((t) => t.active !== false).length),
        },
      ],
    });
  }

  function openSenderConfirm() {
    const pattern = senderEmail.trim().toLowerCase();
    if (!pattern) {
      toast.error("Enter a sender email or @domain.com pattern");
      return;
    }
    setConfirm({
      kind: "sender",
      title: "Add allowed sender?",
      confirmLabel: "Confirm add",
      summary: [
        { label: "Sender pattern", value: pattern },
        {
          label: "Meaning",
          value: pattern.startsWith("@")
            ? `Any address ending with ${pattern}`
            : "Only this exact email address",
        },
      ],
    });
  }

  function openNotifyConfirm() {
    const email = notifyEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Enter a valid notification email");
      return;
    }
    setConfirm({
      kind: "notify",
      title: "Add notification recipient?",
      confirmLabel: "Confirm add",
      summary: [
        { label: "Email", value: email },
        { label: "Notify on success", value: notifySuccess ? "Yes" : "No" },
        { label: "Notify on failure", value: notifyFailure ? "Yes" : "No" },
      ],
    });
  }

  function openTemplateConfirm() {
    if (!templateName.trim()) {
      toast.error("Enter a template name");
      return;
    }
    if (!templateFile) {
      toast.error("Choose an Excel or CSV template file");
      return;
    }
    const target =
      targetDatasetId === "new"
        ? "Create new dataset (from template name)"
        : `Existing dataset: ${(datasets.data ?? []).find((d) => d.id === targetDatasetId)?.name ?? targetDatasetId}`;
    setConfirm({
      kind: "template",
      title: "Save ingest template?",
      confirmLabel: "Confirm save",
      summary: [
        { label: "Name", value: templateName.trim() },
        { label: "Template file", value: templateFile.name },
        {
          label: "Subject rule",
          value: subjectPattern.trim() ? `Subject contains “${subjectPattern.trim()}”` : "Any subject",
        },
        { label: "Destination", value: target },
        {
          label: "Load mode",
          value:
            templateLoadMode === "full"
              ? "Full replace"
              : "Incremental (needs key columns on target dataset)",
        },
        { label: "Status after save", value: "Active (can deactivate later)" },
      ],
    });
  }

  function openTemplateDetail(t: TemplateRow) {
    setTemplateDetail(t);
    setEditName(t.name);
    setEditSubject(t.subject_pattern ?? "");
    setEditTargetDatasetId(t.target_dataset_id ?? "new");
    setEditLoadMode((t.load_mode === "incremental" ? "incremental" : "full") as "full" | "incremental");
    setEditFile(null);
    if (editFileRef.current) editFileRef.current.value = "";
  }

  async function saveTemplateEdits() {
    if (!orgId || !templateDetail) return;
    if (!editName.trim()) {
      toast.error("Enter a template name");
      return;
    }
    setEditSaving(true);
    try {
      const fileBase64 = editFile ? await fileToBase64(editFile) : undefined;
      await updateEmailIngestTemplate({
        data: {
          orgId,
          templateId: templateDetail.id,
          name: editName.trim(),
          subjectPattern: editSubject.trim() || null,
          targetDatasetId: editTargetDatasetId === "new" ? null : editTargetDatasetId,
          loadMode: editLoadMode,
          fileName: editFile?.name,
          fileBase64,
        },
      });
      void templates.refetch();
      setTemplateDetail(null);
      toast.success("Template updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update template");
    } finally {
      setEditSaving(false);
    }
  }

  function discardConfirm() {
    if (!confirm) return;
    if (confirm.kind === "mailbox") {
      setInboundAddress(savedAddress);
      setEnabled(savedEnabled);
      setAliasDrafts(savedAliases);
      setAliasInput("");
    } else if (confirm.kind === "activate" || confirm.kind === "deactivate") {
      setEnabled(savedEnabled);
    } else if (confirm.kind === "sender") {
      setSenderEmail("");
    } else if (confirm.kind === "notify") {
      setNotifyEmail("");
      setNotifySuccess(true);
      setNotifyFailure(true);
    } else if (confirm.kind === "template") {
      setTemplateName("");
      setSubjectPattern("");
      setTargetDatasetId("new");
      setTemplateLoadMode("full");
      setTemplateFile(null);
      if (templateFileRef.current) templateFileRef.current.value = "";
    }
    setConfirm(null);
  }

  async function runConfirm() {
    if (!confirm || !orgId) return;
    setSaving(true);
    try {
      switch (confirm.kind) {
        case "mailbox":
        case "activate":
        case "deactivate": {
          const addr = inboundAddress.trim().toLowerCase();
          const nextEnabled =
            confirm.kind === "activate" ? true : confirm.kind === "deactivate" ? false : enabled;
          await ensureMailboxRow(addr, nextEnabled);
          const syncedAliases =
            confirm.kind === "mailbox"
              ? await syncMailboxAliases(addr, normalizedAliasDrafts)
              : await syncMailboxAliases(addr, savedAliases);
          setSavedAddress(addr);
          setSavedEnabled(nextEnabled);
          setEnabled(nextEnabled);
          setInboundAddress(addr);
          setAliasDrafts(syncedAliases);
          setSavedAliases(syncedAliases);
          void mailbox.refetch();
          void aliases.refetch();
          toast.success(
            confirm.kind === "activate"
              ? "Email ingest activated"
              : confirm.kind === "deactivate"
                ? "Email ingest paused"
                : "Mailbox settings saved",
          );
          break;
        }
        case "sender": {
          const pattern = senderEmail.trim().toLowerCase();
          await ensureMailboxRow(
            savedAddress || inboundAddress.trim().toLowerCase() || suggestIngestAddress(orgSlug, orgId),
            savedEnabled,
          );
          const { error } = await supabase.from("email_ingest_sender_allowlist").insert({
            org_id: orgId,
            email_pattern: pattern,
          });
          if (error) throw error;
          setSenderEmail("");
          void senders.refetch();
          toast.success("Sender allowlisted");
          break;
        }
        case "notify": {
          const email = notifyEmail.trim().toLowerCase();
          const { error } = await supabase.from("email_ingest_notification_recipients").insert({
            org_id: orgId,
            email,
            notify_on_success: notifySuccess,
            notify_on_failure: notifyFailure,
          });
          if (error) throw error;
          setNotifyEmail("");
          setNotifySuccess(true);
          setNotifyFailure(true);
          void notifyRecipients.refetch();
          toast.success("Notification recipient added");
          break;
        }
        case "template": {
          if (!templateFile) throw new Error("Template file missing");
          const fileBase64 = await fileToBase64(templateFile);
          const result = await uploadEmailIngestTemplate({
            data: {
              orgId,
              name: templateName.trim(),
              subjectPattern: subjectPattern.trim() || undefined,
              fileName: templateFile.name,
              fileBase64,
              targetDatasetId: targetDatasetId === "new" ? undefined : targetDatasetId,
              loadMode: templateLoadMode,
            },
          });
          setTemplateName("");
          setSubjectPattern("");
          setTargetDatasetId("new");
          setTemplateLoadMode("full");
          setTemplateFile(null);
          if (templateFileRef.current) templateFileRef.current.value = "";
          void templates.refetch();
          toast.success(`Template saved (${result.schema.columns.length} columns)`);
          break;
        }
        default: {
          const _exhaustive: never = confirm.kind;
          void _exhaustive;
          break;
        }
      }
      setConfirm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function removeSender(id: string) {
    if (!orgId) return;
    const { error } = await supabase
      .from("email_ingest_sender_allowlist")
      .delete()
      .eq("id", id)
      .eq("org_id", orgId);
    if (error) return toast.error(error.message);
    void senders.refetch();
    toast.success("Sender removed");
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

  async function setTemplateActive(templateId: string, active: boolean) {
    if (!orgId) return;
    const { error } = await supabase
      .from("email_ingest_templates")
      .update({ active })
      .eq("id", templateId)
      .eq("org_id", orgId);
    if (error) return toast.error(error.message);
    void templates.refetch();
    toast.success(active ? "Template activated" : "Template deactivated");
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
        toast.error(
          `Rejected: ${INGEST_STATUS_LABELS[result.status] ?? result.status}${result.detail ? ` — ${result.detail}` : ""}`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  const confirmOpen = confirm !== null;

  return (
    <AdminShell>
      <PageHeader
        title="Email ingest"
        description="Route spreadsheet attachments from your mail gateway into versioned datasets — one clear setup path."
        backTo="/admin"
        backLabel="Admin"
        crumbs={[{ label: "Admin", to: "/admin" }, { label: "Email ingest" }]}
      />

      <ConfirmSetupDialog
        open={confirmOpen}
        title={confirm?.title ?? ""}
        description="Review the summary, then confirm to apply, edit to go back, or discard to clear the draft."
        summary={confirm?.summary ?? []}
        confirmLabel={confirm?.confirmLabel ?? "Confirm"}
        confirming={saving}
        onConfirm={() => void runConfirm()}
        onEdit={() => {
          if (confirm?.kind === "activate" || confirm?.kind === "deactivate") {
            setEnabled(savedEnabled);
          }
          setConfirm(null);
        }}
        onDiscard={discardConfirm}
      />

      <Dialog
        open={templateDetail !== null}
        onOpenChange={(open) => {
          if (!open && !editSaving) setTemplateDetail(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ingest template</DialogTitle>
            <DialogDescription>
              Review match rules and expected columns. Save to update this setup.
            </DialogDescription>
          </DialogHeader>
          {templateDetail && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-template-name">Name</Label>
                <Input
                  id="edit-template-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={editSaving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-subject">Subject contains (optional)</Label>
                <Input
                  id="edit-subject"
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  placeholder="Leave blank to match any subject"
                  disabled={editSaving}
                />
              </div>
              <div className="space-y-2 rounded-lg border border-border p-3">
                <Label>Where should matching emails go?</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={editTargetDatasetId === "new" ? "default" : "outline"}
                    disabled={editSaving}
                    onClick={() => setEditTargetDatasetId("new")}
                  >
                    Create new dataset
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={editTargetDatasetId !== "new" ? "default" : "outline"}
                    disabled={editSaving}
                    onClick={() => {
                      const first = datasets.data?.[0]?.id;
                      if (first) setEditTargetDatasetId(first);
                      else toast.error("No existing datasets yet — create new instead");
                    }}
                  >
                    Use existing dataset
                  </Button>
                </div>
                {editTargetDatasetId === "new" ? (
                  <p className="text-xs text-muted-foreground">
                    First successful email creates a dataset named after this template.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <Select
                      modal={false}
                      value={editTargetDatasetId}
                      onValueChange={setEditTargetDatasetId}
                      disabled={editSaving}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose dataset" />
                      </SelectTrigger>
                      <SelectContent>
                        {(datasets.data ?? []).map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-200">
                      Columns in the template file must match this dataset’s published contract.
                      Wrong target = import failure after validation.
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label>Load mode</Label>
                  <HelpTip title="Full vs incremental">
                    Full replace publishes a new complete snapshot each time. Incremental upserts
                    rows using key columns already marked on the target dataset (set when publishing
                    in the portal). Prefer Full replace unless the destination dataset already has
                    keys.
                  </HelpTip>
                </div>
                <Select
                  modal={false}
                  value={editLoadMode}
                  onValueChange={(v) => setEditLoadMode(v as "full" | "incremental")}
                  disabled={editSaving}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full replace (recommended)</SelectItem>
                    <SelectItem value="incremental">
                      Incremental (needs key columns on target dataset)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
                <p className="font-medium text-foreground">Template spreadsheet</p>
                <p className="mt-1 break-all font-mono text-sm text-foreground">
                  {templateDetail.template_file_name ?? "— no file name stored —"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Attachment match: {templateDetail.attachment_pattern ?? "*.xlsx"}
                </p>
                <p className="mt-2 font-medium text-foreground">Expected columns</p>
                <p className="mt-1 break-words text-muted-foreground">
                  {(
                    (templateDetail.schema_snapshot as { columns?: { api_name: string }[] } | null)
                      ?.columns ?? []
                  )
                    .map((c) => c.api_name)
                    .join(", ") || "None"}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-template-file">Replace template spreadsheet (optional)</Label>
                <Input
                  id="edit-template-file"
                  ref={editFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  disabled={editSaving}
                  onChange={(e) => setEditFile(e.target.files?.[0] ?? null)}
                />
                {editFile ? (
                  <p className="text-xs text-muted-foreground">
                    Will re-learn columns from: {editFile.name}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Leave empty to keep the current column schema.
                  </p>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={editSaving}
              onClick={() => setTemplateDetail(null)}
            >
              Close
            </Button>
            <Button type="button" disabled={editSaving} onClick={() => void saveTemplateEdits()}>
              {editSaving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status / activate */}
      <Card className="mb-6 border-primary/20">
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={savedEnabled ? "default" : "secondary"}>
                {savedEnabled ? "Active" : "Paused"}
              </Badge>
              <HelpTip title="Activate vs save" learnMoreHref="/help#email-ingest">
                Save mailbox settings (primary address + aliases) separately from activating. Activation turns
                on acceptance of inbound webhooks for this workspace. Individual ingest templates can also be
                activated or paused.
              </HelpTip>
            </div>
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              {savedAddress ? (
                <>
                  <span>
                    Ingest address: <code className="text-foreground">{savedAddress}</code>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    aria-label="Copy ingest address"
                    onClick={() => void copyText("Ingest address", savedAddress)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  {savedAliases.length > 0 ? (
                    <span className="ml-0.5">
                      (+{savedAliases.length} alias{savedAliases.length === 1 ? "" : "es"})
                    </span>
                  ) : null}
                </>
              ) : (
                "No ingest address saved yet — start on the Mailbox tab."
              )}
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <StepDot done={checklist.address} label="Address" />
              <StepDot done={checklist.senders} label="Senders" />
              <StepDot done={checklist.templates} label="Template" />
              <StepDot done={checklist.enabled} label="Activated" />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {savedEnabled ? (
              <Button type="button" variant="outline" onClick={() => openActivateConfirm(false)}>
                <PauseCircle className="mr-2 h-4 w-4" />
                Pause ingest
              </Button>
            ) : (
              <Button type="button" onClick={() => openActivateConfirm(true)}>
                <PlayCircle className="mr-2 h-4 w-4" />
                Activate ingest
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="mailbox">1. Mailbox</TabsTrigger>
          <TabsTrigger value="senders">2. Senders</TabsTrigger>
          <TabsTrigger value="templates">3. Templates</TabsTrigger>
          <TabsTrigger value="notify">4. Notifications</TabsTrigger>
          <TabsTrigger value="test">5. Test &amp; log</TabsTrigger>
        </TabsList>

        <TabsContent value="mailbox" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4" />
                Workspace mailbox
              </CardTitle>
              <CardDescription>
                Set the address your gateway forwards to, then save. Activation is a separate step above.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ingest-address">Primary workspace ingest email</Label>
                <Input
                  id="ingest-address"
                  value={inboundAddress}
                  onChange={(e) => setInboundAddress(e.target.value)}
                  placeholder="reports@mail.yourdomain.com"
                />
                <p className="text-xs text-muted-foreground">
                  This must be a real address your mail gateway receives. Gridwire does not host IMAP/SMTP —
                  the gateway POSTs parsed JSON to the webhook below.
                </p>
                {(setup.data?.ingestDomainIsPlaceholder ||
                  isPlaceholderIngestDomain(inboundAddress.split("@")[1] ?? "")) && (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                    <code>@ingest.local</code> (and other <code>.local</code> domains) are placeholders only —
                    they are not deliverable on the public internet. Set{" "}
                    <code>INGEST_EMAIL_DOMAIN</code> / use your real domain (e.g.{" "}
                    <code>gptlab-dpdu@mail.gptlab.ae</code>) and configure MX/inbound on that domain.
                  </p>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <Label>Additional inbox aliases</Label>
                  <span className="text-xs text-muted-foreground">Saved with mailbox settings</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Aliases are extra To addresses that route to this same workspace. Gridwire will match any
                  syntactically valid address you list — but mail only arrives if <em>you control delivery</em>{" "}
                  for that domain (your MX, forwarding, or a Postmark inbound domain you verified). You cannot
                  invent an alias on a domain you do not own and expect the public internet to deliver it here.
                  When the webhook arrives, we match <code>OriginalRecipient</code> / <code>To</code> against
                  the primary address or any alias, then apply the same senders, templates, and activation
                  state.
                </p>
                {aliasDrafts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No aliases — only the primary address routes here.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {aliasDrafts.map((alias) => (
                      <li
                        key={alias}
                        className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                      >
                        <code className="truncate">{alias}</code>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove alias ${alias}`}
                          onClick={() => setAliasDrafts((prev) => prev.filter((a) => a !== alias))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value)}
                    placeholder="another@mail.yourdomain.com"
                    className="min-w-[14rem] flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addAliasDraft();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={addAliasDraft}>
                    <Plus className="mr-1 h-4 w-4" />
                    Add alias
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <Label htmlFor="ingest-enabled-draft">Accept mail when activated</Label>
                  <p className="text-xs text-muted-foreground">
                    Draft preference saved with mailbox settings. Use Activate / Pause for live control.
                  </p>
                </div>
                <Switch id="ingest-enabled-draft" checked={enabled} onCheckedChange={setEnabled} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={openMailboxConfirm} disabled={!mailboxDirty}>
                  Save mailbox settings
                </Button>
                {mailboxDirty ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>
                ) : (
                  <span className="text-xs text-muted-foreground">All mailbox changes saved</span>
                )}
              </div>
              {setup.data && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
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
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Webhook for your mail gateway</CardTitle>
                <CardDescription>Copy once into Postmark Inbound / similar — read-only reference.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
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
                {setup.data.webhookIsLoopback ? (
                  <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    This webhook points at a loopback/LAN host (<code>{setup.data.publicAppUrl}</code>). External
                    mail gateways cannot reach it — that is why portal Test ingest works but real email does
                    not. Set Authentication → Public app URL and server PUBLIC_APP_URL to your public origin
                    (e.g. https://gridwire.gptlab.ae), then point the gateway at the updated webhook.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Public base: <code>{setup.data.publicAppUrl}</code>
                    {setup.data.ingestDomain === "inbound.postmarkapp.com" ? (
                      <>
                        {" "}
                        · Postmark inbound URL should be{" "}
                        <code className="break-all">
                          https://user:INBOUND_WEBHOOK_SECRET@{new URL(setup.data.publicAppUrl).host}
                          /api/public/inbound/postmark
                        </code>
                      </>
                    ) : null}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">{setup.data.webhookSchemaNote}</p>
                {setup.data.webhookAuthConfigured ? (
                  <p className="text-xs text-muted-foreground">{setup.data.webhookAuthNote}</p>
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400">{setup.data.webhookAuthNote}</p>
                )}
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium text-foreground">Gateway setup steps</summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-4">
                    {setup.data.inboundWebhookSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </details>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="senders">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Allowed senders</CardTitle>
              <CardDescription>
                Only these addresses (or domains) can submit files. Add → review → confirm.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(senders.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No senders yet — inbound mail will be rejected.</p>
              ) : (
                <ul className="space-y-2">
                  {(senders.data ?? []).map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <code>{s.email_pattern}</code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${s.email_pattern}`}
                        onClick={() => void removeSender(s.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="reports@company.com or @company.com"
                  value={senderEmail}
                  onChange={(e) => setSenderEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openSenderConfirm();
                  }}
                />
                <Button type="button" onClick={openSenderConfirm}>
                  <Plus className="mr-1 h-4 w-4" />
                  Review &amp; add
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Upload className="h-4 w-4" />
                Ingest templates
              </CardTitle>
              <CardDescription>
                Saved setups that match inbound subject/filename and validate columns. Click a template to
                view details and edit. Deactivate to stop matching without deleting.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(templates.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No templates yet.</p>
              ) : (
                (templates.data ?? []).map((t) => {
                  const schema = t.schema_snapshot as { columns?: { api_name: string }[] } | null;
                  const cols = schema?.columns?.map((c) => c.api_name).join(", ") ?? "no schema";
                  const target = (datasets.data ?? []).find((d) => d.id === t.target_dataset_id);
                  const isActive = t.active !== false;
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openTemplateDetail(t as TemplateRow)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openTemplateDetail(t as TemplateRow);
                        }
                      }}
                      className="flex cursor-pointer flex-col gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-muted/40 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{t.name}</span>
                          <Badge variant={isActive ? "default" : "secondary"}>
                            {isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <p className="break-all text-xs">
                          <span className="text-muted-foreground">File: </span>
                          <span className="font-mono text-foreground">
                            {t.template_file_name ?? "— not recorded —"}
                          </span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">Columns: {cols}</p>
                        <p className="text-xs text-muted-foreground">
                          Destination:{" "}
                          {target
                            ? `Existing dataset “${target.name}”`
                            : "Create new dataset on first import"}{" "}
                          · {(t.load_mode ?? "full") === "incremental" ? "Incremental" : "Full replace"}
                        </p>
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Match: subject
                          {t.subject_pattern ? ` contains “${t.subject_pattern}”` : " (any)"}
                          {" · "}
                          attachment {t.attachment_pattern ?? "*.xlsx"}
                        </p>
                      </div>
                      <div
                        className="flex shrink-0 items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => openTemplateDetail(t as TemplateRow)}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <label className="flex items-center gap-2 text-xs">
                          <Switch
                            checked={isActive}
                            onCheckedChange={(v) => void setTemplateActive(t.id, v)}
                          />
                          {isActive ? "On" : "Off"}
                        </label>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => void removeTemplate(t.id)}
                          aria-label="Delete template"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add ingest template</CardTitle>
              <CardDescription>
                Upload a sample spreadsheet Gridwire will match. Prefer creating a{" "}
                <strong className="font-medium text-foreground">new dataset</strong> unless you are
                sure an existing dataset has the same columns.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="template-name">Template name</Label>
                <Input
                  id="template-name"
                  placeholder="e.g. Monthly sales report"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="subject-pattern">Subject contains (optional)</Label>
                <Input
                  id="subject-pattern"
                  placeholder="Leave blank to match any subject"
                  value={subjectPattern}
                  onChange={(e) => setSubjectPattern(e.target.value)}
                />
              </div>

              <div className="space-y-2 rounded-lg border border-border p-3">
                <Label>Where should matching emails go?</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={targetDatasetId === "new" ? "default" : "outline"}
                    onClick={() => setTargetDatasetId("new")}
                  >
                    Create new dataset
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={targetDatasetId !== "new" ? "default" : "outline"}
                    onClick={() => {
                      const first = datasets.data?.[0]?.id;
                      if (first) setTargetDatasetId(first);
                      else toast.error("No existing datasets yet — create new instead");
                    }}
                  >
                    Use existing dataset
                  </Button>
                </div>
                {targetDatasetId === "new" ? (
                  <p className="text-xs text-muted-foreground">
                    First successful email creates a dataset named after this template. Columns come
                    from the spreadsheet you upload below. Recommended for new file layouts.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <Select modal={false} value={targetDatasetId} onValueChange={setTargetDatasetId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose dataset" />
                      </SelectTrigger>
                      <SelectContent>
                        {(datasets.data ?? []).map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-200">
                      The email file’s columns must match this dataset’s published API contract. Choosing
                      the wrong dataset (different columns) causes import failures after validation —
                      that is what happened when pointing card data at the complaints “test” dataset.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label>Load mode</Label>
                  <HelpTip title="Full vs incremental">
                    Full replace publishes a new complete snapshot each time. Incremental upserts
                    rows using key columns already marked on the target dataset (set when publishing
                    in the portal). Email templates do not define keys — use Full replace for new
                    datasets, or Incremental only when importing into an existing dataset that already
                    has key columns.
                  </HelpTip>
                </div>
                <Select
                  modal={false}
                  value={templateLoadMode}
                  onValueChange={(v) => setTemplateLoadMode(v as "full" | "incremental")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full replace (recommended)</SelectItem>
                    <SelectItem value="incremental">
                      Incremental (needs key columns on target dataset)
                    </SelectItem>
                  </SelectContent>
                </Select>
                {templateLoadMode === "incremental" && targetDatasetId === "new" ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Incremental on a brand-new dataset has no key columns yet — prefer Full replace,
                    or choose an existing dataset that already has keys configured.
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="template-file">Template spreadsheet</Label>
                <Input
                  id="template-file"
                  ref={templateFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => setTemplateFile(e.target.files?.[0] ?? null)}
                />
                {templateFile && (
                  <p className="text-xs text-muted-foreground">Selected: {templateFile.name}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  This file teaches Gridwire which columns to expect. Inbound attachments must match
                  these headers (and the subject rule above).
                </p>
              </div>
              <Button type="button" onClick={openTemplateConfirm}>
                Review &amp; save template
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notify">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ingest notification emails</CardTitle>
              <CardDescription>
                Ops receivers for success/failure (platform mailer). Rejected senders also get an automatic
                rejection email.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(notifyRecipients.data ?? []).map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
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
                      type="button"
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
              <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="notify-email">Recipient email</Label>
                  <Input
                    id="notify-email"
                    placeholder="ops@company.com"
                    value={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={notifySuccess} onCheckedChange={setNotifySuccess} />
                    Notify on success
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={notifyFailure} onCheckedChange={setNotifyFailure} />
                    Notify on failure
                  </label>
                </div>
                <Button type="button" onClick={openNotifyConfirm}>
                  <Plus className="mr-1 h-4 w-4" />
                  Review &amp; add
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="test" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FlaskConical className="h-4 w-4" />
                Test ingest
              </CardTitle>
              <CardDescription>
                Simulate an inbound email without an external gateway. Subject and filename must match an{" "}
                <strong className="text-foreground">active</strong> template.
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
                />
                {subjectRuleHints.length > 0 ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Active template rules:{" "}
                    {subjectRuleHints
                      .map((h) => `“${h.name}” needs subject containing “${h.pattern}”`)
                      .join(" · ")}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">No subject rules on active templates.</p>
                )}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="test-attachment">Attachment</Label>
                <Input
                  id="test-attachment"
                  ref={testFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  disabled={testing}
                  onChange={(e) => setTestFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="button" onClick={() => void runTestIngest()} disabled={testing || !testFile}>
                  {testing ? "Running test…" : "Run test ingest"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent messages</CardTitle>
              <CardDescription>
                Accepted and rejected mail. Full history also appears in{" "}
                <Link to="/logs" search={{ tab: "audit" }} className="text-primary hover:underline">
                  Audit log
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(messages.data ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No inbound messages yet.</p>
              )}
              {(messages.data ?? []).map((m) => (
                <div key={m.id} className="rounded-lg border border-border px-3 py-2 text-xs">
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
                  {m.ingest_error && <p className="mt-1 text-destructive">{m.ingest_error}</p>}
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
        </TabsContent>
      </Tabs>
    </AdminShell>
  );
}
