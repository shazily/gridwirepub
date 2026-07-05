import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useOrg, canManage } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { getOrgGovernance, testOrgStorage, updateOrgGovernance, upsertTeam, allocateMemberStorage } from "@/lib/governance.functions";
import { HardDrive, ShieldAlert, Cable } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/admin/storage")({
  component: AdminStorage,
});

function formatBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function AdminStorage() {
  const { currentOrg, role } = useOrg();
  const manage = canManage(role);
  const orgId = currentOrg?.id;

  const [loading, setLoading] = useState(true);
  const [storageQuotaGb, setStorageQuotaGb] = useState("10");
  const [maxUploadMb, setMaxUploadMb] = useState("50");
  const [maxRowsPerSheet, setMaxRowsPerSheet] = useState("5000");
  const [apiRateLimit, setApiRateLimit] = useState("60");
  const [apiMonthlyQuota, setApiMonthlyQuota] = useState("");
  const [storageEndpoint, setStorageEndpoint] = useState("");
  const [storageBucket, setStorageBucket] = useState("");
  const [teams, setTeams] = useState<{ id: string; name: string; storage_quota_bytes: number | null; storage_used_bytes: number }[]>([]);
  const [members, setMembers] = useState<
    { user_id: string; role: string; team_id: string | null; storage_quota_bytes: number | null; profiles: { display_name: string | null } | null }[]
  >([]);
  const [newTeamName, setNewTeamName] = useState("");
  const [storageUsedBytes, setStorageUsedBytes] = useState(0);

  const [newTeamQuotaGb, setNewTeamQuotaGb] = useState("");

  useEffect(() => {
    if (!orgId || !manage) return;
    (async () => {
      setLoading(true);
      try {
        const data = await getOrgGovernance({ data: { orgId } });
        const org = data.org as Record<string, unknown>;
        setStorageQuotaGb(String(Math.round(Number(org.storage_quota_bytes ?? 0) / 1_073_741_824)));
        setMaxUploadMb(String(Math.round(Number(org.max_upload_bytes ?? 0) / 1_048_576)));
        setMaxRowsPerSheet(String(org.max_rows_per_sheet ?? 5000));
        setApiRateLimit(String(org.api_rate_limit_per_min ?? 60));
        setApiMonthlyQuota(org.api_monthly_quota != null ? String(org.api_monthly_quota) : "");
        const cfg = (org.storage_config ?? {}) as Record<string, string>;
        setStorageEndpoint(cfg.endpoint ?? "");
        setStorageBucket(cfg.bucket ?? "");
        setStorageUsedBytes(Number(org.storage_used_bytes ?? 0));
        setTeams(data.teams as typeof teams);
        setMembers(data.members as typeof members);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load storage settings");
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, manage]);

  if (!manage) {
    return (
    <AdminShell>
      <div>
        <PageHeader title="Storage & quotas" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Owner or admin access required.</p>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
    );
  }

  async function saveOrgLimits() {
    if (!orgId) return;
    try {
      await updateOrgGovernance({
        data: {
          orgId,
          storageQuotaBytes: Math.round(parseFloat(storageQuotaGb) * 1_073_741_824),
          maxUploadBytes: Math.round(parseFloat(maxUploadMb) * 1_048_576),
          maxRowsPerSheet: parseInt(maxRowsPerSheet, 10),
          apiRateLimitPerMin: parseInt(apiRateLimit, 10),
          apiMonthlyQuota: apiMonthlyQuota ? parseInt(apiMonthlyQuota, 10) : null,
          storageConfig: {
            provider: storageEndpoint ? "s3" : "platform",
            endpoint: storageEndpoint || undefined,
            bucket: storageBucket || undefined,
          },
        },
      });
      toast.success("Storage and API limits saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function testStorage() {
    if (!orgId) return;
    try {
      const result = await testOrgStorage({
        data: {
          orgId,
          storageConfig: {
            provider: storageEndpoint ? "s3" : "platform",
            endpoint: storageEndpoint || undefined,
            bucket: storageBucket || undefined,
          },
        },
      });
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    }
  }

  async function addTeam() {
    if (!orgId || !newTeamName.trim()) return;
    try {
      await upsertTeam({
        data: {
          orgId,
          name: newTeamName.trim(),
          storageQuotaBytes: newTeamQuotaGb
            ? Math.round(parseFloat(newTeamQuotaGb) * 1_073_741_824)
            : null,
        },
      });
      toast.success("Team created");
      setNewTeamName("");
      setNewTeamQuotaGb("");
      const data = await getOrgGovernance({ data: { orgId } });
      setTeams(data.teams as typeof teams);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create team");
    }
  }

  const usedBytes = storageUsedBytes;

  return (
    <AdminShell>
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Storage & quotas"
        description="Control where data is stored and how space is allocated across teams."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive className="h-4 w-4" /> Organization storage pool
          </CardTitle>
          <CardDescription>
            Raw uploads and Parquet snapshots are stored in S3-compatible object storage. Metadata stays in Postgres.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Storage quota (GB)</Label>
                  <Input value={storageQuotaGb} onChange={(e) => setStorageQuotaGb(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Used: {formatBytes(usedBytes)}</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Max upload size (MB)</Label>
                  <Input value={maxUploadMb} onChange={(e) => setMaxUploadMb(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Max rows per sheet</Label>
                  <Input value={maxRowsPerSheet} onChange={(e) => setMaxRowsPerSheet(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>API rate limit / min</Label>
                  <Input value={apiRateLimit} onChange={(e) => setApiRateLimit(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Monthly API quota (optional)</Label>
                  <Input value={apiMonthlyQuota} onChange={(e) => setApiMonthlyQuota(e.target.value)} placeholder="Unlimited" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Custom storage endpoint (optional)</Label>
                <Input value={storageEndpoint} onChange={(e) => setStorageEndpoint(e.target.value)} placeholder="https://minio.company.com" />
              </div>
              <div className="space-y-1.5">
                <Label>Bucket name</Label>
                <Input value={storageBucket} onChange={(e) => setStorageBucket(e.target.value)} placeholder="gridwire-prod" />
              </div>
              <div className="flex gap-2">
                <Button onClick={saveOrgLimits}>Save limits</Button>
                <Button variant="outline" onClick={testStorage}>
                  Test connection
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cable className="h-4 w-4" />
            Corporate file servers (NFS / Samba / SFTP)
          </CardTitle>
          <CardDescription>
            Pull spreadsheets from network shares into datasets — complementary to email ingest and manual upload.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Gridwire does not mount your file server inside the portal UI. Instead, the{" "}
            <strong className="text-foreground">companion worker</strong> reads from paths you mount into the worker
            container (NFS, Samba/CIFS, or local folders) or polls SFTP hosts.
          </p>
          <ol className="list-decimal space-y-1 pl-4">
            <li>
              Mount the share on the worker host, e.g.{" "}
              <code className="text-xs">//fileserver/finance → /mnt/corporate/finance</code>
            </li>
            <li>
              Add a volume in <code className="text-xs">docker-compose.onprem.yml</code> under{" "}
              <code className="text-xs">worker.volumes</code> mapping that mount path
            </li>
            <li>
              Create an <strong className="text-foreground">NFS / network share</strong> connector with path{" "}
              <code className="text-xs">/mnt/corporate/finance/*.xlsx</code>
            </li>
          </ol>
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin/connectors">Configure connectors</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Teams</CardTitle>
          <CardDescription>Allocate storage pools to teams. Members inherit team quotas unless overridden.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {teams.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
              <span className="font-medium">{t.name}</span>
              <span className="text-muted-foreground">
                {formatBytes(t.storage_used_bytes)}
                {t.storage_quota_bytes ? ` / ${formatBytes(t.storage_quota_bytes)}` : " (no cap)"}
              </span>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-[200px]" placeholder="Team name" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} />
            <Input className="max-w-[120px]" placeholder="Quota GB" value={newTeamQuotaGb} onChange={(e) => setNewTeamQuotaGb(e.target.value)} />
            <Button variant="outline" onClick={addTeam}>
              Add team
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Member storage caps</CardTitle>
          <CardDescription>Optional per-member upload limits within the org pool.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {members.map((m) => (
            <MemberStorageRow
              key={m.user_id}
              orgId={orgId!}
              member={m}
              teams={teams}
              onSaved={async () => {
                const data = await getOrgGovernance({ data: { orgId: orgId! } });
                setMembers(data.members as typeof members);
              }}
            />
          ))}
        </CardContent>
      </Card>
    </div>
    </AdminShell>
  );
}

function MemberStorageRow({
  orgId,
  member,
  teams,
  onSaved,
}: {
  orgId: string;
  member: { user_id: string; role: string; team_id: string | null; storage_quota_bytes: number | null; profiles: { display_name: string | null } | null };
  teams: { id: string; name: string }[];
  onSaved: () => Promise<void>;
}) {
  const [quotaGb, setQuotaGb] = useState(
    member.storage_quota_bytes ? String(Math.round(member.storage_quota_bytes / 1_073_741_824)) : "",
  );
  const [teamId, setTeamId] = useState(member.team_id ?? "");

  async function save() {
    try {
      await allocateMemberStorage({
        data: {
          orgId,
          userId: member.user_id,
          teamId: teamId || null,
          storageQuotaBytes: quotaGb ? Math.round(parseFloat(quotaGb) * 1_073_741_824) : null,
        },
      });
      toast.success("Member allocation updated");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
      <span className="min-w-[120px] font-medium">{member.profiles?.display_name ?? member.user_id.slice(0, 8)}</span>
      <span className="text-xs text-muted-foreground capitalize">{member.role}</span>
      <select
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={teamId}
        onChange={(e) => setTeamId(e.target.value)}
      >
        <option value="">No team</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <Input
        className="max-w-[100px]"
        placeholder="GB cap"
        value={quotaGb}
        onChange={(e) => setQuotaGb(e.target.value)}
      />
      <Button size="sm" variant="outline" onClick={save}>
        Save
      </Button>
    </div>
  );
}
