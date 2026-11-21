/** Map Gridwire HTTP failures to clear MCP tool errors (no stack traces). */

export class GridwireApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "GridwireApiError";
    this.status = status;
    this.code =
      code ??
      (status === 401
        ? "unauthorized"
        : status === 403
          ? "forbidden"
          : status === 404
            ? "not_found"
            : status === 429
              ? "rate_limited"
              : "api_error");
  }
}

export function formatToolError(err: unknown): string {
  if (err instanceof GridwireApiError) {
    switch (err.code) {
      case "unauthorized":
        return `Authentication failed (${err.status}): check GRIDWIRE_API_KEY. ${err.message}`;
      case "forbidden":
        return `Forbidden (${err.status}): ${err.message}`;
      case "not_found":
        return `Not found (${err.status}): dataset may be unpublished, wrong id, or outside this API key's workspace. ${err.message}`;
      case "rate_limited":
        return `Rate limited (${err.status}): slow down and retry. ${err.message}`;
      default:
        return `Gridwire API error (${err.status}): ${err.message}`;
    }
  }
  if (err instanceof Error) return err.message;
  return "Unexpected error calling Gridwire API";
}
