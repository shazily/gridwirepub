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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { getOrgGovernance, updateOrgGovernance } from "@/lib/governance.functions";
import { parseGroupRoleMappings, type GroupRoleMapping, type OrgRole } from "@/lib/ad-group-role";
import { ShieldAlert, KeyRound, Plus, Trash2, Globe, Copy, UserPlus } from "lucide-react";
import { HelpTip } from "@/components/help-tip";
import { buildJoinUrl } from "@/lib/org-join";

export const Route = createFileRoute("/_authenticated/_dash/admin/authentication")({
  component: AdminAuthentication,
});

type AuthMode = "local" | "sso" | "hybrid";

const MAPPING_ROLES: OrgRole[] = ["admin", "member", "contributor", "viewer"];

function AdminAuthentication() {
  const { currentOrg, role } = useOrg();
  const manage = canManage(role);
  const orgId = currentOrg?.id;

  const [publicAppUrl, setPublicAppUrl] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("hybrid");
  const [oidcIssuer, setOidcIssuer] = useState("");
  const [oidcClientId, setOidcClientId] = useState("");
  const [samlMetadataUrl, setSamlMetadataUrl] = useState("");
  const [groupMappings, setGroupMappings] = useState<GroupRoleMapping[]>([]);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smsProvider, setSmsProvider] = useState("");
  const [smsWebhook, setSmsWebhook] = useState("");
  const [mfaOwners, setMfaOwners] = useState(true);
  const [mfaAdmins, setMfaAdmins] = useState(true);
  const [allowJoinByOrgId, setAllowJoinByOrgId] = useState(false);

  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [mfaQr, setMfaQr] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || !manage) return;
    getOrgGovernance({ data: { orgId } }).then((data) => {
      const org = data.org as Record<string, unknown>;
      const auth = (org.auth_config ?? {}) as Record<string, unknown>;
      const smtp = (org.smtp_config ?? {}) as Record<string, string>;
      const sms = (org.sms_config ?? {}) as Record<string, string>;
      setPublicAppUrl(typeof auth.public_app_url === "string" ? auth.public_app_url : "");
      const mode = auth.auth_mode;
      setAuthMode(mode === "local" || mode === "sso" || mode === "hybrid" ? mode : "hybrid");
      setOidcIssuer(typeof auth.oidc_issuer === "string" ? auth.oidc_issuer : "");
      setOidcClientId(typeof auth.oidc_client_id === "string" ? auth.oidc_client_id : "");
      setSamlMetadataUrl(typeof auth.saml_metadata_url === "string" ? auth.saml_metadata_url : "");
      setGroupMappings(parseGroupRoleMappings(auth.group_role_mappings));
      setAllowJoinByOrgId(auth.allow_join_by_org_id === true);
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
    const trimmedUrl = publicAppUrl.trim().replace(/\/$/, "");
    if (trimmedUrl) {
      try {
        const u = new URL(trimmedUrl);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          toast.error("Public app URL must be http(s)");
          return;
        }
      } catch {
        toast.error("Public app URL is not a valid URL");
        return;
      }
    }
    const mfaRequiredRoles: string[] = [];
    if (mfaOwners) mfaRequiredRoles.push("owner");
    if (mfaAdmins) mfaRequiredRoles.push("admin");
    try {
      await updateOrgGovernance({
        data: {
          orgId,
          authConfig: {
            public_app_url: trimmedUrl || undefined,
            auth_mode: authMode,
            allow_join_by_org_id: allowJoinByOrgId,
            oidc_issuer: oidcIssuer || undefined,
            oidc_client_id: oidcClientId || undefined,
            saml_metadata_url: samlMetadataUrl || undefined,
            group_role_mappings: groupMappings.filter((m) => m.group.trim()),
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
        description="Public URL, auth mode, SSO, MFA policy, and org email/SMS for OTP delivery."
        backTo="/admin"
        backLabel="Admin"
        crumbs={[{ label: "Admin", to: "/admin" }, { label: "Authentication" }]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4" />
            Public app URL
            <HelpTip title="Password reset links">
              Used in password-reset and invite emails so links open your Cloudflare / public hostname,
              not localhost. Leave blank to use PUBLIC_APP_URL / SITE_URL from the server .env, or the
              origin the user was on when they requested a reset.
            </HelpTip>
          </CardTitle>
          <CardDescription>
            Hostname users reach in a browser (e.g. https://data.your-company.com). Required for correct
            reset emails when the server .env still points at 127.0.0.1.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Public app URL</Label>
            <Input
              value={publicAppUrl}
              onChange={(e) => setPublicAppUrl(e.target.value)}
              placeholder="https://data.your-company.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Auth mode</Label>
            <Select value={authMode} onValueChange={(v) => setAuthMode(v as AuthMode)}>
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local accounts only (email + password)</SelectItem>
                <SelectItem value="sso">SSO only (OIDC / SAML)</SelectItem>
                <SelectItem value="hybrid">Hybrid (local + SSO)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Portal sign-in pages honor this when opened with your org portal slug. SSO-only hides password
              signup and forgot-password.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4" />
            Join by organization ID
            <HelpTip title="Self-join without invites" learnMoreHref="/help#join-by-org-id">
              When enabled, people who already have an account (or just signed up) can join this workspace as
              Viewer by entering the organization UUID, or by opening the shareable join link (portal slug or
              UUID). Use invite links when you need Contributor or higher. Join is off by default so orgs are
              not discoverable by guessing.
            </HelpTip>
          </CardTitle>
          <CardDescription>
            For on-prem deployments without Active Directory: allow Viewer self-join with the org UUID or join
            link. Disabled by default.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">Allow join by organization ID</p>
              <p className="text-xs text-muted-foreground">
                New joiners get the Viewer role. Promote them on Team &amp; access when needed.
              </p>
            </div>
            <Switch checked={allowJoinByOrgId} onCheckedChange={setAllowJoinByOrgId} />
          </div>
          {allowJoinByOrgId && orgId && (
            <div className="space-y-2">
              <Label>Shareable join link</Label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  readOnly
                  value={buildJoinUrl(
                    (publicAppUrl.trim() || (typeof window !== "undefined" ? window.location.origin : "")).replace(
                      /\/$/,
                      "",
                    ) || "https://your-host",
                    currentOrg?.portal_slug,
                    orgId,
                  )}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    const url = buildJoinUrl(
                      (publicAppUrl.trim() || window.location.origin).replace(/\/$/, ""),
                      currentOrg?.portal_slug,
                      orgId,
                    );
                    void navigator.clipboard.writeText(url);
                    toast.success("Join link copied");
                  }}
                >
                  <Copy className="mr-1 h-4 w-4" /> Copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Organization UUID (for the join form):{" "}
                <span className="font-mono text-foreground">{orgId}</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

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
          <CardTitle className="text-base">AD / IdP group → role mapping</CardTitle>
          <CardDescription>
            When SSO users sign in, matching groups can set their workspace role (owner is never auto-assigned).
            Full auto-provisioning runs when the IdP connector webhook is enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {groupMappings.map((row, idx) => (
            <div key={idx} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1 space-y-1.5">
                <Label>Group id / name</Label>
                <Input
                  value={row.group}
                  onChange={(e) => {
                    const next = [...groupMappings];
                    next[idx] = { ...row, group: e.target.value };
                    setGroupMappings(next);
                  }}
                  placeholder="Finance-Users or group object id"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select
                  value={row.role}
                  onValueChange={(v) => {
                    const next = [...groupMappings];
                    next[idx] = { ...row, role: v as OrgRole };
                    setGroupMappings(next);
                  }}
                >
                  <SelectTrigger className="w-40 capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MAPPING_ROLES.map((r) => (
                      <SelectItem key={r} value={r} className="capitalize">
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setGroupMappings(groupMappings.filter((_, i) => i !== idx))}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setGroupMappings([...groupMappings, { group: "", role: "member" }])}
          >
            <Plus className="h-4 w-4" /> Add mapping
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Org email (SMTP)
            <HelpTip title="Org SMTP vs platform email" learnMoreHref="/help#authentication-email">
              Platform password reset and alert emails use Postmark or SMTP from the server .env (POSTMARK_API_TOKEN or
              SMTP_HOST) — not these fields. Org SMTP/SMS here are saved for future org-owned mail/OTP and are not
              used by the mailer yet.
            </HelpTip>
          </CardTitle>
          <CardDescription>
            Saved on the organization for future OTP/org mail. Does not send forgot-password or alert mail today.
          </CardDescription>
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
