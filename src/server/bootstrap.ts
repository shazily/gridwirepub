/**
 * Production fail-closed bootstrap for the Gridwire portal process.
 * Invoked from src/server.ts on startup and from /api/public/ready.
 */

import { assertFieldEncryptionProductionConfig } from "@/lib/field-protection.server";
import { assertSecurityBaselineProductionConfig } from "@/lib/secrets.server";

/** Literal fallbacks from docker-compose.backend.yml — forbidden in production. */
export const DEV_COMPOSE_WEAK_POSTGRES_PASSWORD = "postgres";
export const DEV_COMPOSE_WEAK_JWT_SECRET =
  "super-secret-jwt-token-with-at-least-32-characters-long";

function warnRateLimitReplicaTopology(): void {
  const replicas = Number(process.env.REPLICA_COUNT || process.env.PORTAL_REPLICA_COUNT || "1");
  if (!Number.isFinite(replicas) || replicas <= 1) return;
  const shared = (process.env.REDIS_URL || process.env.VALKEY_URL || "").trim();
  if (shared) return;
  console.warn(
    `[gridwire] rate limit topology: replica count is ${replicas} but REDIS_URL/VALKEY_URL is unset — in-memory rate limits do not aggregate across replicas`,
  );
}

/**
 * Hard fail in production when insecure-dev encryption is enabled, required
 * secrets are missing/invalid, or known docker-compose.backend.yml weak
 * fallback secrets are present.
 */
export function assertProductionSecurityBootstrap(): void {
  warnRateLimitReplicaTopology();

  if (process.env.NODE_ENV !== "production") return;

  if (process.env.FIELD_ENCRYPTION_ALLOW_INSECURE_DEV === "true") {
    throw new Error(
      "FIELD_ENCRYPTION_ALLOW_INSECURE_DEV=true is forbidden when NODE_ENV=production (fail-closed). Remove the flag and set a real FIELD_ENCRYPTION_KEY.",
    );
  }

  assertFieldEncryptionProductionConfig();
  assertSecurityBaselineProductionConfig();

  const postgresPassword = process.env.POSTGRES_PASSWORD ?? "";
  if (postgresPassword === DEV_COMPOSE_WEAK_POSTGRES_PASSWORD) {
    throw new Error(
      "Weak secret detected: POSTGRES_PASSWORD matches docker-compose.backend.yml fallback (\"postgres\"). Set a strong password before production.",
    );
  }

  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (
    jwtSecret === DEV_COMPOSE_WEAK_JWT_SECRET ||
    jwtSecret === "dev-only-weak-secret" ||
    /weak secret/i.test(jwtSecret)
  ) {
    throw new Error(
      "Weak secret detected: JWT_SECRET matches a docker-compose.backend.yml / known weak secret. Set a strong JWT_SECRET before production.",
    );
  }
}
