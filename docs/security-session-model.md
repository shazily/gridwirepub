# Session and authentication model

Gridwire uses **Supabase Auth (GoTrue)** with the JavaScript client in the browser.

## Where tokens live

| Token | Storage | Lifetime |
|-------|---------|----------|
| Access token (JWT) | **React memory** via Supabase client (`localStorage` persistence enabled) | Short-lived |
| Refresh token | Managed by Supabase client; persisted in **`localStorage`** by default | Rotated by GoTrue |

Gridwire does **not** use HttpOnly session cookies for the dashboard. Server functions receive the access token from the client on each call.

## Security tradeoffs

**XSS is the primary session threat.** Any script running in the portal origin can read `localStorage` and exfiltrate the Supabase session. Mitigations:

- Strict Content-Security-Policy at the reverse proxy (recommended for production)
- No third-party scripts on authenticated routes
- Keep dependencies patched (`npm audit`)

**CSRF against server functions** is reduced because mutations use `Authorization: Bearer <access_token>` from JavaScript memory, not ambient cookies. Direct PostgREST calls from the browser still send the anon key + user JWT — protect origins with CORS and avoid embedding the app in untrusted iframes.

## What this is not

- Not cookie-based SSO session fixation protection (no `SameSite=Strict` session cookie)
- Not server-side session revocation on tab close (refresh token persists until logout/expiry)

## Hardening options for self-hosters

1. Terminate TLS at Nginx with modern CSP headers
2. Restrict admin surfaces by IP (`portal_ip_allowlist` for public portal branding; extend at proxy for `/auth`)
3. Enable GoTrue MFA for owner/admin roles when your IdP supports it
4. Use short JWT expiry + refresh rotation (GoTrue defaults)

For regulated deployments requiring HttpOnly cookie sessions, a future auth gateway would need to proxy tokens — not supported in the current architecture.
