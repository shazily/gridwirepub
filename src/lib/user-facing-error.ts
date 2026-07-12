/**
 * Map technical / bundler / provider errors into short user-facing copy,
 * and emit readable structured server logs for operators.
 */

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || "Unknown error";
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

type PatternRule = {
  test: RegExp;
  message: string;
};

const USER_FACING_RULES: PatternRule[] = [
  {
    test: /fake worker|pdf\.worker|pdfjs-dist|Cannot find module.*pdf/i,
    message:
      "We couldn't open this PDF on the server (PDF reader failed to start). Try again, or contact your admin if it keeps failing.",
  },
  {
    test: /AI PDF parsing is disabled/i,
    message: "AI PDF parsing is turned off. An admin can enable it under Admin → AI / PDF.",
  },
  {
    test: /LLM_API_KEY is required|No active LLM|configure Admin → AI/i,
    message: "No AI connection is configured. Set one up under Admin → AI / PDF, then try again.",
  },
  {
    test: /AbortError|timed? ?out|TimeoutError|LLM_TIMEOUT/i,
    message: "The AI request timed out. Try a smaller PDF, fewer pages, or another model under Admin → AI / PDF.",
  },
  {
    test: /already has \d+ PDF parse job|AI parse limit|too large for AI parsing/i,
    message:
      "This PDF job was blocked to protect the server (size or concurrency limit). Wait for other jobs or split the file.",
  },
  {
    test: /does not support endpoint|INVALID_REQUEST_BODY/i,
    message:
      "This model cannot be used for chat/completions on OpenRouter. Pick another model under Admin → AI / PDF (try openrouter/free).",
  },
  {
    test: /response[_\s-]?format|json_object is not supported/i,
    message:
      "This AI model rejected JSON response mode. Try another model under Admin → AI / PDF (for example openrouter/free).",
  },
  {
    test: /LLM request failed \(401\)|Unauthorized|invalid.?api.?key|Incorrect API key/i,
    message: "The AI provider rejected the API key. Check the key under Admin → AI / PDF.",
  },
  {
    test: /LLM request failed \(403\)|forbidden/i,
    message: "The AI provider denied access for this key or model. Pick another model under Admin → AI / PDF.",
  },
  {
    test: /LLM request failed \(429\)|rate.?limit|too many requests/i,
    message: "The AI provider rate-limited this request. Wait a moment and try again, or switch models.",
  },
  {
    test: /LLM request failed \(5\d\d\)|bad gateway|service unavailable/i,
    message: "The AI provider is temporarily unavailable. Try again in a few minutes.",
  },
  {
    test: /LLM request failed|Could not list models|Anthropic request failed|Gemini request failed|Ollama request failed/i,
    message: "The AI provider request failed. Check Admin → AI / PDF (key, model, and connection test).",
  },
  {
    test: /returned invalid JSON|empty content/i,
    message: "The AI model returned an unusable response. Try another model under Admin → AI / PDF.",
  },
  {
    test: /PDF_PARSE_MOCK|mock JSON marker|pipe-delimited table/i,
    message:
      "PDF parsing is in mock/test mode (no AI call). Turn off Mock mode under Admin → AI / PDF, then upload again.",
  },
  {
    test: /found no tables|no tables|without usable headers/i,
    message: "No usable tables were found in this PDF. Try a clearer PDF, or review extraction settings.",
  },
  {
    test: /JSON object requested|multiple \(or no\) rows returned|PGRST116/i,
    message:
      "This PDF job hit a conflict (already finished or no longer in the expected state). Refresh, open Datasets → PDF reviews, or upload again.",
  },
  {
    test: /Malware scan failed|ClamAV/i,
    message: "This file failed the malware scan and was blocked.",
  },
  {
    test: /exceeds organization upload limit|File exceeds/i,
    message: "This file is larger than your organization's upload limit.",
  },
  {
    test: /ECONNREFUSED|ENOTFOUND|fetch failed|network|ETIMEDOUT/i,
    message: "Could not reach the AI provider. Check network access and the base URL under Admin → AI / PDF.",
  },
  {
    test: /\/app\/|\.output\/|node_modules\/|Cannot find module|ENOENT|EACCES/i,
    message: "Something went wrong while processing this file on the server. Try again, or contact your admin.",
  },
];

/** Short message safe to show in toasts / alerts. */
export function toUserFacingMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw = errorMessage(err).trim();
  if (!raw) return fallback;

  for (const rule of USER_FACING_RULES) {
    if (rule.test.test(raw)) return rule.message;
  }

  // Already written for humans (no stack frames / absolute paths).
  if (
    raw.length <= 220 &&
    !raw.includes("\n") &&
    !raw.includes(" at ") &&
    !/[A-Za-z]:\\/.test(raw) &&
    !raw.startsWith("/")
  ) {
    return raw;
  }

  return fallback;
}

export type ServerLogLevel = "info" | "warn" | "error";

/**
 * One readable line for Docker / journald, plus optional JSON context.
 * Example: [pdf-parse] error | Could not extract text from "report.pdf" | {"cause":"..."}
 */
export function logServer(
  scope: string,
  level: ServerLogLevel,
  summary: string,
  detail?: Record<string, unknown>,
): void {
  const prefix = `[${scope}] ${level} | ${summary}`;
  const payload =
    detail && Object.keys(detail).length > 0 ? ` | ${safeJson(detail)}` : "";
  const line = `${prefix}${payload}`;
  switch (level) {
    case "info":
      console.info(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
    default: {
      const _exhaustive: never = level;
      console.error(`[${scope}] ${_exhaustive} | ${summary}${payload}`);
    }
  }
}

export function logServerError(
  scope: string,
  summary: string,
  err: unknown,
  detail?: Record<string, unknown>,
): void {
  const cause = errorMessage(err);
  logServer(scope, "error", summary, {
    ...detail,
    cause,
    userMessage: toUserFacingMessage(err),
  });
  if (err instanceof Error && err.stack) {
    console.error(`[${scope}] stack | ${err.stack}`);
  }
}

function safeJson(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === "string" && v.length > 500) return `${v.slice(0, 500)}…`;
      return v;
    });
  } catch {
    return '{"error":"unserializable"}';
  }
}
