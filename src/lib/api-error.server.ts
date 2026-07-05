/** Safe API error payloads — suppress internal details in production. */

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Returns err.message in development; undefined in production. */
export function exposeErrorDetail(err: unknown): string | undefined {
  if (isProductionRuntime()) return undefined;
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return undefined;
}

/** Merge a user-safe error body with optional dev-only detail. */
export function publicErrorBody(
  body: Record<string, unknown>,
  err?: unknown,
): Record<string, unknown> {
  const detail = exposeErrorDetail(err);
  return detail ? { ...body, detail } : body;
}
