import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg, canManage } from "@/hooks/use-org";
import { PageHeader } from "@/components/app-shell";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { getOrgGovernance, updateOrgGovernance } from "@/lib/governance.functions";
import { ShieldAlert, KeyRound } from "lucide-react";
import { HelpTip } from "@/components/help-tip";

export const Route = createFileRoute("/_authenticated/_dash/admin/authentication")({
  component: AdminAuthentication,
});

function AdminAuthentication() {
  const { currentOrg, role } = useOrg();
  const manage = canManage(role);
  const orgId = currentOrg?.id;

  const [oidcIssuer, setOidcIssuer] = useState("");
  const [oidcClientId, setOidcClientId] = useState("");
  const [samlMetadataUrl, setSamlMetadataUrl] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smsProvider, setSmsProvider] = useState("");
  const [smsWebhook, setSmsWebhook] = useState("");
  const [mfaOwners, setMfaOwners] = useState(true);
  const [mfaAdmins, setMfaAdmins] = useState(true);

  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [mfaQr, setMfaQr] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || !manage) return;
    getOrgGovernance({ data: { orgId } }).then((data) => {
      const org = data.org as Record<string, unknown>;
      const auth = (org.auth_config ?? {}) as Record<string, string>;
      const smtp = (org.smtp_config ?? {}) as Record<string, string>;
      const sms = (org.sms_config ?? {}) as Record<string, string>;
      setOidcIssuer(auth.oidc_issuer ?? "");
      setOidcClientId(auth.oidc_client_id ?? "");
      setSamlMetadataUrl(auth.saml_metadata_url ?? "");
      setSmtpHost(smtp.host ?? "");
      setSmtpPort(smtp.port ?? "587");
      setSmtpUser(smtp.user ?? "");
      setSmtpFrom(smtp.from ?? "");
      setSmsProvider(sms.provider ?? "");
      setSmsWebhook(sms.webhook_url ?? "");
      const roles = (org.mfa_required_roles ?? []) as string[];
      setMfaOwners(roles.includes("owner"));
      setMfaAdmins(roles.includes("admin"));
    });
    supabase.auth.mfa.listFactors().then(({ data }) => {
      setMfaEnrolled((data?.totp?.length ?? 0) > 0);
    });
  }, [orgId, manage]);

  async function saveAuth() {
    if (!orgId) return;
    const mfaRequiredRoles: string[] = [];
    if (mfaOwners) mfaRequiredRoles.push("owner");
    if (mfaAdmins) mfaRequiredRoles.push("admin");
    try {
      await updateOrgGovernance({
        data: {
          orgId,
          authConfig: {
            oidc_issuer: oidcIssuer || undefined,
            oidc_client_id: oidcClientId || undefined,
            saml_metadata_url: samlMetadataUrl || undefined,
          },
          smtpConfig: {
            host: smtpHost || undefined,
            port: smtpPort,
            user: smtpUser || undefined,
            from: smtpFrom || undefined,
          },
          smsConfig: {
            provider: smsProvider || undefined,
            webhook_url: smsWebhook || undefined,
          },
          mfaRequiredRoles,
        },
      });
      toast.success("Authentication settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function enrollMfa() {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (error) return toast.error(error.message);
    setMfaQr(data.totp?.qr_code ?? null);
    toast.success("Scan the QR code with Google or Microsoft Authenticator");
  }

  if (!manage) {
    return (
    <AdminShell>
      <div>
        <PageHeader title="Authentication" />
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

  return (
    <AdminShell>
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Authentication"
        description="SSO, MFA policy, and org email/SMS for OTP delivery."
        backTo="/admin"
        backLabel="Admin"
        crumbs={[{ label: "Admin", to: "/admin" }, { label: "Authentication" }]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Single sign-on (OIDC / SAML)
            <HelpTip title="SSO setup" learnMoreHref="/help#authentication-email">
              Configure Azure AD, Okta, or any OIDC issuer. Test with a non-admin user before requiring MFA for all owners.
            </HelpTip>
          </CardTitle>
          <CardDescription>
            Configure your identity provider. Users sign in via Azure AD, Okta, or SAML metadata URL.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>OIDC issuer URL</Label>
            <Input value={oidcIssuer} onChange={(e) => setOidcIssuer(e.target.value)} placeholder="https://login.microsoftonline.com/{tenant}/v2.0" />
          </div>
          <div className="space-y-1.5">
            <Label>OIDC client ID</Label>
            <Input value={oidcClientId} onChange={(e) => setOidcClientId(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>SAML metadata URL</Label>
            <Input value={samlMetadataUrl} onChange={(e) => setSamlMetadataUrl(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Org email (SMTP)
            <HelpTip title="Org SMTP vs platform email" learnMoreHref="/help#authentication-email">
              Platform password reset uses Postmark HTTP (server .env). Org SMTP here is for OTP and alert mail from your own server — not forgot-password.
            </HelpTip>
          </CardTitle>
          <CardDescription>Used for OTP and alert delivery from your mail server.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>SMTP host</Label>
            <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Port</Label>
            <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>From address</Label>
            <Input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">SMS OTP</CardTitle>
          <CardDescription>Webhook or provider for SMS one-time codes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Input value={smsProvider} onChange={(e) => setSmsProvider(e.target.value)} placeholder="twilio | azure | webhook" />
          </div>
          <div className="space-y-1.5">
            <Label>Webhook URL</Label>
            <Input value={smsWebhook} onChange={(e) => setSmsWebhook(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" /> MFA policy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Require MFA for owners</Label>
            <Switch checked={mfaOwners} onCheckedChange={setMfaOwners} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Require MFA for admins</Label>
            <Switch checked={mfaAdmins} onCheckedChange={setMfaAdmins} />
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Your authenticator</p>
            <p className="text-xs text-muted-foreground">
              {mfaEnrolled ? "TOTP enrolled on this account." : "Not enrolled yet."}
            </p>
            {!mfaEnrolled && (
              <Button size="sm" className="mt-2" variant="outline" onClick={enrollMfa}>
                Enroll TOTP (Google / Microsoft Authenticator)
              </Button>
            )}
            {mfaQr && (
              <div className="mt-3 overflow-auto text-xs" dangerouslySetInnerHTML={{ __html: mfaQr }} />
            )}
          </div>
          <Button onClick={saveAuth}>Save authentication settings</Button>
        </CardContent>
      </Card>
      </div>
    </AdminShell>
  );
}
