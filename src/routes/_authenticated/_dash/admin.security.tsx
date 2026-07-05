import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useOrg } from "@/hooks/use-org";
import { AdminShell } from "@/components/admin-shell";
import { PageHeader } from "@/components/app-shell";
import { HelpTip } from "@/components/help-tip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  addPortalIpRule,
  getPortalSecurity,
  removePortalIpRule,
  testMyPortalIp,
  updatePortalAccessEnforced,
} from "@/lib/security.functions";
import { Shield, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/admin/security")({
  component: AdminSecurityPage,
});

function AdminSecurityPage() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const [loading, setLoading] = useState(true);
  const [enforced, setEnforced] = useState(false);
  const [allowlist, setAllowlist] = useState<
    { id: string; cidr: string; label: string; is_system: boolean }[]
  >([]);
  const [myIp, setMyIp] = useState("");
  const [newCidr, setNewCidr] = useState("");
  const [newLabel, setNewLabel] = useState("");

  async function load() {
    if (!orgId) return;
    setLoading(true);
    try {
      const data = await getPortalSecurity({ data: { orgId } });
      setEnforced(Boolean(data.org?.portal_access_enforced));
      setAllowlist(data.allowlist as typeof allowlist);
      setMyIp(data.myIp);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load security settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function toggleEnforced(value: boolean) {
    if (!orgId) return;
    try {
      await updatePortalAccessEnforced({ data: { orgId, enforced: value } });
      setEnforced(value);
      toast.success(value ? "Portal IP allowlist enforced" : "Portal IP allowlist disabled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function addRule() {
    if (!orgId || !newCidr.trim()) return;
    try {
      await addPortalIpRule({ data: { orgId, cidr: newCidr.trim(), label: newLabel.trim() } });
      setNewCidr("");
      setNewLabel("");
      await load();
      toast.success("IP rule added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add rule");
    }
  }

  async function removeRule(ruleId: string) {
    if (!orgId) return;
    try {
      await removePortalIpRule({ data: { orgId, ruleId } });
      await load();
      toast.success("Rule removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove rule");
    }
  }

  async function testIp() {
    if (!orgId) return;
    try {
      const result = await testMyPortalIp({ data: { orgId } });
      toast.info(
        result.allowed
          ? `Your IP (${result.myIp}) is allowed`
          : `Your IP (${result.myIp}) would be blocked when enforcement is on`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    }
  }

  return (
    <AdminShell>
      <PageHeader
        title="Security"
        description="Control who can reach your public portal from the network."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            Portal IP allowlist
            <HelpTip title="Portal firewall" learnMoreHref="/help#portal-security">
              When enabled, only clients from listed CIDR ranges can load{" "}
              <code className="text-[10px]">/portal/your-slug</code>. Private RFC1918 and loopback
              ranges are pre-seeded. Add your office or VPN egress IP before enabling in production.
            </HelpTip>
          </CardTitle>
          <CardDescription>
            Your detected IP: <code className="text-xs">{myIp || "—"}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <Label htmlFor="enforce">Enforce IP allowlist on public portal</Label>
                  <p className="text-xs text-muted-foreground">
                    Off by default in local dev so you do not lock yourself out.
                  </p>
                </div>
                <Switch id="enforce" checked={enforced} onCheckedChange={toggleEnforced} />
              </div>
              <div className="space-y-2">
                {allowlist.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <div>
                      <code>{r.cidr}</code>
                      {r.label && (
                        <span className="ml-2 text-muted-foreground">{r.label}</span>
                      )}
                      {r.is_system && (
                        <span className="ml-2 text-[10px] text-muted-foreground">(system)</span>
                      )}
                    </div>
                    {!r.is_system && (
                      <Button size="icon" variant="ghost" onClick={() => removeRule(r.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="max-w-[180px]"
                  placeholder="203.0.113.0/24"
                  value={newCidr}
                  onChange={(e) => setNewCidr(e.target.value)}
                />
                <Input
                  className="max-w-[160px]"
                  placeholder="Label (optional)"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
                <Button variant="outline" onClick={addRule}>
                  Add IP / CIDR
                </Button>
                <Button variant="secondary" onClick={testIp}>
                  Test my IP
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </AdminShell>
  );
}
