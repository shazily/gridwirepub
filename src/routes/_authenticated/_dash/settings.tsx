import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canManage } from "@/hooks/use-org";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ShieldCheck, Sun, Moon, KeyRound } from "lucide-react";


export const Route = createFileRoute("/_authenticated/_dash/settings")({
  component: Settings,
});

function Settings() {
  const { currentOrg, role, refetch } = useOrg();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const manage = canManage(role);
  const [orgName, setOrgName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [recipients, setRecipients] = useState("");
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [mfaQr, setMfaQr] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const totp = data?.totp?.find((f) => f.status === "verified");
      setMfaEnrolled(Boolean(totp));
    });
  }, []);

  async function enrollMfa() {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (error) return toast.error(error.message);
    setMfaQr(data.totp?.qr_code ?? null);
    toast.success("Scan the QR code with Google or Microsoft Authenticator");
  }

  useEffect(() => {
    if (currentOrg) setOrgName(currentOrg.name);
  }, [currentOrg]);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("display_name").eq("id", user.id).single().then(({ data }) => {
      setDisplayName(data?.display_name ?? "");
    });
  }, [user]);

  useEffect(() => {
    if (!currentOrg) return;
    supabase.from("alerts").select("*").eq("org_id", currentOrg.id).eq("event_type", "ingestion").maybeSingle().then(({ data }) => {
      if (data) {
        setAlertEnabled(data.enabled);
        setRecipients((data.recipients ?? []).join(", "));
      }
    });
  }, [currentOrg]);

  async function saveOrg() {
    if (!currentOrg) return;
    const { error } = await supabase.from("organizations").update({ name: orgName }).eq("id", currentOrg.id);
    if (error) return toast.error(error.message);
    toast.success("Organization updated");
    refetch();
  }

  async function saveProfile() {
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", user.id);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
  }

  async function changePassword() {
    if (newPassword.length < 6) return toast.error("Password must be at least 6 characters");
    if (newPassword !== confirmPassword) return toast.error("Passwords do not match");
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) return toast.error(error.message);
    setNewPassword("");
    setConfirmPassword("");
    toast.success("Password updated");
  }



  async function saveAlerts() {
    if (!currentOrg) return;
    const list = recipients.split(",").map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase
      .from("alerts")
      .upsert(
        { org_id: currentOrg.id, event_type: "ingestion", enabled: alertEnabled, recipients: list },
        { onConflict: "org_id,event_type" },
      );
    if (error) return toast.error(error.message);
    toast.success("Alert preferences saved");
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Settings"
        description="Manage your profile, organization, and alerts."
        backTo="/dashboard"
        backLabel="Dashboard"
        crumbs={[{ label: "Settings" }]}
      />

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Your profile</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={user?.email ?? ""} disabled readOnly />
          </div>
          <div className="space-y-1.5">
            <Label>Display name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <Button onClick={saveProfile}>Save profile</Button>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Password</CardTitle>
          <CardDescription>Choose a strong password. Leaked-password protection is enforced.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>New password</Label>
            <Input
              type="password"
              value={newPassword}
              minLength={6}
              placeholder="••••••••"
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm new password</Label>
            <Input
              type="password"
              value={confirmPassword}
              minLength={6}
              placeholder="••••••••"
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <Button onClick={changePassword} disabled={savingPassword || !newPassword}>
            {savingPassword ? "Updating…" : "Update password"}
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> Two-factor authentication
          </CardTitle>
          <CardDescription>
            Protect your account with TOTP (Google Authenticator, Microsoft Authenticator).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {mfaEnrolled ? "TOTP is enrolled on this account." : "MFA is not enrolled yet."}
          </p>
          {!mfaEnrolled && (
            <Button variant="outline" onClick={enrollMfa}>
              Enroll authenticator app
            </Button>
          )}
          {mfaQr && (
            <div className="overflow-auto text-xs" dangerouslySetInnerHTML={{ __html: mfaQr }} />
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Choose how Gridwire looks on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              <div>
                <div className="text-sm font-medium">{theme === "dark" ? "Dark" : "Light"} mode</div>
                <p className="text-xs text-muted-foreground">Saved to this browser.</p>
              </div>
            </div>
            <Switch
              checked={theme === "dark"}
              onCheckedChange={(v) => setTheme(v ? "dark" : "light")}
            />
          </div>
        </CardContent>
      </Card>


      {manage && (
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">Organization</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} />
            </div>
            <Button onClick={saveOrg}>Save organization</Button>
          </CardContent>
        </Card>
      )}

      {manage && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Email alerts</CardTitle>
            <CardDescription>Notify recipients on ingestion success, errors, and baseline-format changes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Enable ingestion alerts</Label>
              <Switch checked={alertEnabled} onCheckedChange={setAlertEnabled} />
            </div>
            <div className="space-y-1.5">
              <Label>Recipients (comma-separated)</Label>
              <Input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="ops@company.com, data@company.com" />
            </div>
            <Button onClick={saveAlerts}>Save alerts</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Security posture</CardTitle>
          <CardDescription className="sr-only">How your data is protected</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5 text-sm">
          {[
            ["Encryption in transit", "All API and app traffic is served exclusively over TLS 1.2+ (HTTPS)."],
            ["Encryption at rest", "Database volumes use operator-managed disk encryption. Fields marked \u201cencrypt\u201d are sealed with AES-256-GCM at ingest before storage in Postgres."],
            ["Field-level protection", "Every field can be left clear, masked, hashed, or encrypted at ingest. API responses decrypt or apply masking according to field settings."],
            ["Selectable hashing", "Hashed fields let you choose the algorithm: SHA-256/512, SHA3-256/512, or keyed HMAC-SHA256/512 (peppered, not rainbow-table-able)."],
            ["Access control", "Row-level security scopes every record to your organization. Secure datasets are reachable only with a valid, non-revoked API token."],
            ["Auditability", "Data access and every access-control change are written to an owner/admin-only audit log."],
            ["Account security", "Leaked-password protection (HaveIBeenPwned) is enforced on sign-up and password changes."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-lg border border-border p-3">
              <div className="font-medium text-foreground">{title}</div>
              <p className="text-muted-foreground">{body}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
