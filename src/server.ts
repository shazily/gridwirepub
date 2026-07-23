import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  isRestOpenApiRoot,
  normalizeProxyPathname,
  proxyRateBucketForPath,
  shouldProxyBackend,
} from "./lib/backend-proxy.server";
import { checkPublicEndpointRateLimit } from "./lib/public-endpoint-guard.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

/**
 * When the Cloudflare tunnel (or any single public hostname) only reaches the
 * portal, browsers still need /auth/v1 and /rest/v1. Proxy those paths to the
 * in-compose Kong gateway (SUPABASE_URL), so VITE_SUPABASE_URL can be the
 * public site origin instead of 127.0.0.1:3040.
 */
function backendProxyBase(): string | null {
  const raw = (process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  if (!raw) return null;
  const publicOrigin = (process.env.PUBLIC_APP_URL || process.env.SITE_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (publicOrigin && raw === publicOrigin) return null;
  return raw;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "forwarded",
]);

async function proxyToBackend(request: Request): Promise<Response> {
  const base = backendProxyBase();
  if (!base) {
    return new Response(JSON.stringify({ error: "Backend proxy not configured (SUPABASE_URL)" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  const incoming = new URL(request.url);
  const pathname = normalizeProxyPathname(incoming.pathname);

  if (isRestOpenApiRoot(pathname)) {
    return new Response(JSON.stringify({ error: "Not found", code: "rest_root_disabled" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const bucket = proxyRateBucketForPath(pathname);
  const limited = checkPublicEndpointRateLimit(request, bucket.endpoint, {
    perMin: bucket.perMin,
    burst: bucket.burst,
  });
  if (limited) return limited;

  const target = `${base}${pathname}${incoming.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    headers.set(key, value);
  });

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  try {
    const upstream = await fetch(target, init);
    const outHeaders = new Headers(upstream.headers);
    outHeaders.delete("access-control-allow-origin");
    outHeaders.delete("access-control-allow-credentials");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  } catch (err) {
    console.error("[backend-proxy]", target, err);
    return new Response(JSON.stringify({ error: "Backend unreachable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const pathname = normalizeProxyPathname(new URL(request.url).pathname);
      if (shouldProxyBackend(pathname)) {
        return await proxyToBackend(request);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
