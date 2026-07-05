import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canManage } from "@/hooks/use-org";
import { generateApiKey, sha256Hex } from "@/lib/spreadsheet";
import { PageHeader } from "@/components/app-shell";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { logAuditEvent } from "@/lib/audit.functions";
import { KeyRound, Plus, Copy, Trash2, Loader2, RotateCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_dash/admin/api-keys")({
  component: ApiKeys,
});

function ApiKeys() {
  const { currentOrg, role } = useOrg();
  const orgId = currentOrg?.id;
  const queryClient = useQueryClient();
  const manage = canManage(role);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);

  const keys = useQuery({
    queryKey: ["api-keys", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_keys")
        .select("*")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function createKey() {
    if (!orgId || !name.trim()) return;
    setCreating(true);
    try {
      const key = generateApiKey();
      const key_hash = await sha256Hex(key);
      const key_prefix = key.slice(0, 11);
      const { data: inserted, error } = await supabase.from("api_keys").insert({
        org_id: orgId,
        name: name.trim(),
        key_hash,
        key_prefix,
        scopes: ["read"],
      }).select("id").single();
      if (error) throw error;
      try {
        await logAuditEvent({
          data: {
            orgId,
            action: "api_key.created",
            resourceType: "api_key",
            resourceId: inserted?.id ?? undefined,
            metadata: { name: name.trim(), key_prefix },
          },
        });
      } catch {
        /* best-effort */
      }
      setNewKey(key);
      setName("");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["api-keys", orgId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create key");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    const { error } = await supabase.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    if (orgId) {
      try {
        await logAuditEvent({
          data: { orgId, action: "api_key.revoked", resourceType: "api_key", resourceId: id },
        });
      } catch {
        /* best-effort */
      }
    }
    toast.success("Key revoked");
    queryClient.invalidateQueries({ queryKey: ["api-keys", orgId] });
  }

  async function rotate(k: { id: string; name: string; scopes: string[] }) {
    if (!orgId) return;
    setRotatingId(k.id);
    try {
      const key = generateApiKey();
      const key_hash = await sha256Hex(key);
      const key_prefix = key.slice(0, 11);
      const { data: inserted, error } = await supabase
        .from("api_keys")
        .insert({
          org_id: orgId,
          name: k.name,
          key_hash,
          key_prefix,
          scopes: k.scopes ?? ["read"],
        })
        .select("id")
        .single();
      if (error) throw error;
      const { error: revokeErr } = await supabase
        .from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", k.id);
      if (revokeErr) throw revokeErr;
      try {
        await logAuditEvent({
          data: {
            orgId,
            action: "api_key.rotated",
            resourceType: "api_key",
            resourceId: inserted?.id ?? undefined,
            metadata: { name: k.name, key_prefix, replaced_key_id: k.id },
          },
        });
      } catch {
        /* best-effort */
      }
      setNewKey(key);
      toast.success("Key rotated — the old key is now revoked");
      queryClient.invalidateQueries({ queryKey: ["api-keys", orgId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rotate key");
    } finally {
      setRotatingId(null);
    }
  }

  return (
    <AdminShell>
      <div>
      <PageHeader
        title="API Keys"
        description="Bearer tokens for consuming your dataset APIs. Keys are shown once and stored hashed."
        action={
          manage && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> New key
            </Button>
          )
        }
      />

      {keys.data && keys.data.length > 0 ? (
        <div className="space-y-2">
          {keys.data.map((k) => (
            <Card key={k.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
                  <KeyRound className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="font-medium">{k.name}</div>
                  <code className="font-mono text-xs text-muted-foreground">{k.key_prefix}••••••••</code>
                </div>
                <div className="ml-auto flex items-center gap-3">
                  {k.revoked_at ? (
                    <Badge variant="secondary">Revoked</Badge>
                  ) : (
                    <Badge className="bg-success/20 text-success">Active</Badge>
                  )}
                  {k.last_used_at && (
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      Last used {new Date(k.last_used_at).toLocaleDateString()}
                    </span>
                  )}
                  {manage && !k.revoked_at && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Rotate key"
                        disabled={rotatingId === k.id}
                        onClick={() => rotate(k)}
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
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15">
              <KeyRound className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">No API keys yet.</p>
            {manage && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Create a key</Button>}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>Give the key a descriptive name so you can identify its use.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="key-name">Name</Label>
            <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Production backend" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={createKey} disabled={creating || !name.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!newKey} onOpenChange={(o) => !o && setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your API key now</DialogTitle>
            <DialogDescription>
              This is the only time you'll see this key. Store it somewhere safe.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">{newKey}</code>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (newKey) navigator.clipboard.writeText(newKey);
                toast.success("Copied");
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </AdminShell>
  );
}
