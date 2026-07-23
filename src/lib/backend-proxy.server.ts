/**
 * Path helpers for the portal → Kong backend proxy (auth + PostgREST).
 * Kept separate so security tests can cover without booting Nitro.
 */

/** Collapse `.` / `..` segments the way browsers/servers normalize request paths. */
export function normalizeProxyPathname(pathname: string): string {
  try {
    return new URL(pathname, "http://gridwire.invalid").pathname;
  } catch {
    return pathname;
  }
}

export function shouldProxyBackend(pathname: string): boolean {
  const path = normalizeProxyPathname(pathname);
  return (
    path === "/auth/v1" ||
    path.startsWith("/auth/v1/") ||
    path === "/rest/v1" ||
    path.startsWith("/rest/v1/")
  );
}

/** PostgREST OpenAPI document at the REST root — must not be public. */
export function isRestOpenApiRoot(pathname: string): boolean {
  const path = normalizeProxyPathname(pathname);
  return path === "/rest/v1" || path === "/rest/v1/";
}

export type ProxyRateBucket = {
  endpoint: string;
  perMin: number;
  burst: number;
};

/** Map proxied path → rate-limit bucket (credential stuffing surfaces are stricter). */
export function proxyRateBucketForPath(pathname: string): ProxyRateBucket {
  const path = normalizeProxyPathname(pathname).toLowerCase();
  if (path.startsWith("/auth/v1/token")) {
    return { endpoint: "proxy-auth-token", perMin: 20, burst: 10 };
  }
  if (path.startsWith("/auth/v1/signup")) {
    return { endpoint: "proxy-auth-signup", perMin: 10, burst: 5 };
  }
  if (path.startsWith("/auth/v1/recover") || path.startsWith("/auth/v1/otp")) {
    return { endpoint: "proxy-auth-recover", perMin: 10, burst: 5 };
  }
  if (path.startsWith("/auth/v1")) {
    return { endpoint: "proxy-auth", perMin: 60, burst: 30 };
  }
  return { endpoint: "proxy-rest", perMin: 120, burst: 60 };
}
