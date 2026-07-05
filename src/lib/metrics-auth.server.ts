/**
 * Metrics endpoint authentication — fail-closed when token unset.
 */
import { safeTokenEqual } from "@/lib/token-compare.server";

export function validateMetricsToken(
  request: Request,
  requiredToken: string | undefined | null,
): boolean {
  const required = requiredToken?.trim() ?? "";
  if (!required) return false;

  const url = new URL(request.url);
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const provided = bearer || url.searchParams.get("token") || "";
  return safeTokenEqual(provided, required);
}
