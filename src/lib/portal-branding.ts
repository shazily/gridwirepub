export type PortalBranding = {
  slug: string;
  organization_name: string;
  platform_name: string;
  logo_url: string | null;
  auth_mode?: "local" | "sso" | "hybrid";
  sso_configured?: boolean;
};

export function portalPath(slug: string): string {
  return `/portal/${encodeURIComponent(slug)}`;
}

export function portalAuthSearch(slug: string): { org: string } {
  return { org: slug };
}

export async function fetchPortalBranding(slug: string): Promise<PortalBranding> {
  const res = await fetch(`/api/public/portal/${encodeURIComponent(slug)}`, {
    credentials: "same-origin",
  });
  if (res.status === 403) {
    throw new Error("portal_access_denied");
  }
  if (res.status === 404) {
    throw new Error("portal_not_found");
  }
  if (!res.ok) {
    throw new Error("portal_unavailable");
  }
  const body = (await res.json()) as { data?: PortalBranding };
  if (!body.data?.slug) {
    throw new Error("portal_not_found");
  }
  return body.data;
}
