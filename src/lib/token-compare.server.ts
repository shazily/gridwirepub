import { timingSafeEqual } from "crypto";

/** Constant-time comparison for bearer/worker/metrics tokens. */
export function safeTokenEqual(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
