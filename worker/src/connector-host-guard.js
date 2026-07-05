/**
 * SSRF guard for connector hosts — resolves DNS and blocks private/link-local ranges.
 * Set ALLOW_INTERNAL_CONNECTOR_HOSTS=true to permit RFC1918 targets (on-prem only).
 */
import dns from "node:dns/promises";
import net from "node:net";

function allowInternalHosts() {
  return process.env.ALLOW_INTERNAL_CONNECTOR_HOSTS === "true";
}

function ipv4ToLong(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function isBlockedIpv4(ip) {
  const n = ipv4ToLong(ip);
  if (n === null) return true;
  const mask = (bits) => (n & bits) >>> 0;
  if (mask(0xff000000) === 0x0a000000) return true; // 10.0.0.0/8
  if (mask(0xfff00000) === 0xac100000) return true; // 172.16.0.0/12
  if (mask(0xffff0000) === 0xc0a80000) return true; // 192.168.0.0/16
  if (mask(0xff000000) === 0x7f000000) return true; // 127.0.0.0/8
  if (mask(0xffff0000) === 0xa9fe0000) return true; // 169.254.0.0/16
  if (mask(0xff000000) === 0) return true; // 0.0.0.0/8
  return false;
}

function isBlockedIpv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    if (net.isIPv4(mapped)) return isBlockedIpv4(mapped);
  }
  return false;
}

function assertIpAllowed(address) {
  if (net.isIPv4(address)) {
    if (isBlockedIpv4(address)) {
      throw new Error(`connector host resolves to blocked IPv4 address: ${address}`);
    }
    return;
  }
  if (net.isIPv6(address)) {
    if (isBlockedIpv6(address)) {
      throw new Error(`connector host resolves to blocked IPv6 address: ${address}`);
    }
  }
}

/**
 * @param {string | undefined} host
 */
export async function assertConnectorHostAllowed(host) {
  if (!host?.trim()) {
    throw new Error("connector host is required");
  }
  if (allowInternalHosts()) return;

  const trimmed = host.trim();
  if (net.isIP(trimmed)) {
    assertIpAllowed(trimmed);
    return;
  }

  const results = await dns.lookup(trimmed, { all: true, verbatim: true });
  if (!results.length) {
    throw new Error(`connector host could not be resolved: ${trimmed}`);
  }
  for (const { address } of results) {
    assertIpAllowed(address);
  }
}
