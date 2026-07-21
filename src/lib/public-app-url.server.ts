/**
 * Canonical public site URL for auth emails (password reset, invites).
 * Prefer non-localhost deployment URLs; fall back to a client-provided https origin
 * so marketing/tunnel hosts work even when .env still has 127.0.0.1.
 */

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1";
}

export function isLoopbackUrl(value: string): boolean {
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return true;
  }
}

/** Env-configured public app URL (may still be loopback in local .env). */
export function configuredPublicAppUrl(): string | null {
  const raw = process.env.PUBLIC_APP_URL?.trim() || process.env.SITE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

/**
 * Resolve the URL used in password-reset / invite emails.
 * Order: explicitOverride → non-loopback PUBLIC_APP_URL/SITE_URL → preferredRedirect origin → env/loopback fallback.
 */
export function resolvePublicAppUrl(opts?: {
  explicitOverride?: string | null;
  preferredRedirect?: string | null;
}): string {
  const override = opts?.explicitOverride?.trim().replace(/\/$/, "");
  if (override && !isLoopbackUrl(override)) return override;

  const fromEnv = configuredPublicAppUrl();
  if (fromEnv && !isLoopbackUrl(fromEnv)) return fromEnv;

  const preferred = opts?.preferredRedirect?.trim();
  if (preferred) {
    try {
      const origin = new URL(preferred).origin;
      if (!isLoopbackUrl(origin)) return origin;
    } catch {
      /* ignore */
    }
  }

  if (override) return override;
  return fromEnv || "http://127.0.0.1:3020";
}

/** Allow only http(s) redirect targets on the same resolved public origin (path under /reset-password). */
export function sanitizePasswordResetRedirect(
  candidate: string | undefined,
  publicOrigin: string,
): string {
  const fallback = `${publicOrigin.replace(/\/$/, "")}/reset-password`;
  if (!candidate?.trim()) return fallback;
  try {
    const url = new URL(candidate.trim());
    const origin = new URL(publicOrigin);
    if (url.origin !== origin.origin) return fallback;
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    if (!url.pathname.startsWith("/reset-password")) return fallback;
    return `${url.origin}/reset-password`;
  } catch {
    return fallback;
  }
}

/** Portal-hosted recovery URL (token_hash + type) — never points at Kong/localhost auth host. */
export function buildPortalRecoveryLink(hashedToken: string, publicOrigin: string): string {
  const base = publicOrigin.replace(/\/$/, "");
  const params = new URLSearchParams({
    token_hash: hashedToken,
    type: "recovery",
  });
  return `${base}/reset-password?${params.toString()}`;
}
