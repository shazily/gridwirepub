/**
 * Check whether a client IP is allowed to access an org portal.
 * Supports IPv4 CIDR entries stored in portal_ip_allowlist.
 */

function ipToLong(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

function parseCidr(cidr: string): { network: number; mask: number } | null {
  const [ipPart, bitsStr] = cidr.trim().split("/");
  if (!ipPart) return null;
  const ip = ipToLong(ipPart);
  if (ip === null) return null;
  const bits = bitsStr ? Number(bitsStr) : 32;
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { network: ip & mask, mask };
}

export function ipMatchesCidr(clientIp: string, cidr: string): boolean {
  if (cidr.includes(":")) {
    // IPv6: allow exact loopback ::1 only for common dev cases
    if (cidr === "::1/128" && clientIp === "::1") return true;
    return clientIp === cidr.split("/")[0];
  }
  const client = ipToLong(clientIp);
  const rule = parseCidr(cidr);
  if (client === null || rule === null) return false;
  return (client & rule.mask) === rule.network;
}

export function extractClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "127.0.0.1";
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "127.0.0.1";
}

export async function isPortalIpAllowed(orgId: string, clientIp: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("portal_access_enforced")
    .eq("id", orgId)
    .maybeSingle();
  if (!org?.portal_access_enforced) return true;

  const { data: rules } = await supabaseAdmin
    .from("portal_ip_allowlist")
    .select("cidr")
    .eq("org_id", orgId);
  if (!rules?.length) return false;
  return rules.some((r) => ipMatchesCidr(clientIp, r.cidr));
}
