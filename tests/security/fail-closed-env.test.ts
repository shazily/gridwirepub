import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertProductionSecurityBootstrap,
  DEV_COMPOSE_WEAK_JWT_SECRET,
  DEV_COMPOSE_WEAK_POSTGRES_PASSWORD,
} from "../../src/server/bootstrap";

describe("production fail-closed behavior", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    process.env.FIELD_ENCRYPTION_KEY = "a".repeat(64);
    process.env.INBOUND_WEBHOOK_SECRET = "inbound-secret-value-32chars!!";
    process.env.WORKER_INGEST_TOKEN = "worker-token-value-32chars!!!!";
    process.env.METRICS_TOKEN = "metrics-token-value-32chars!!!";
    process.env.POSTGRES_PASSWORD = "strong-postgres-password-here";
    process.env.JWT_SECRET = "strong-jwt-secret-with-enough-entropy-here";
    delete process.env.FIELD_ENCRYPTION_ALLOW_INSECURE_DEV;
    delete process.env.REPLICA_COUNT;
    delete process.env.REDIS_URL;
    delete process.env.VALKEY_URL;
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("refuses to start if FIELD_ENCRYPTION_ALLOW_INSECURE_DEV=true", () => {
    process.env.FIELD_ENCRYPTION_ALLOW_INSECURE_DEV = "true";
    expect(() => assertProductionSecurityBootstrap()).toThrow(/FIELD_ENCRYPTION_ALLOW_INSECURE_DEV/);
  });

  it("refuses to start if FIELD_ENCRYPTION_KEY is missing", () => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    expect(() => assertProductionSecurityBootstrap()).toThrow(/FIELD_ENCRYPTION_KEY/);
  });

  it("refuses to start on known dev-compose weak secrets", () => {
    process.env.JWT_SECRET = DEV_COMPOSE_WEAK_JWT_SECRET;
    expect(() => assertProductionSecurityBootstrap()).toThrow(/weak secret/i);

    process.env.JWT_SECRET = "strong-jwt-secret-with-enough-entropy-here";
    process.env.POSTGRES_PASSWORD = DEV_COMPOSE_WEAK_POSTGRES_PASSWORD;
    expect(() => assertProductionSecurityBootstrap()).toThrow(/POSTGRES_PASSWORD/);
  });

  it("refuses to start on literal dev-only-weak-secret JWT", () => {
    process.env.JWT_SECRET = "dev-only-weak-secret";
    expect(() => assertProductionSecurityBootstrap()).toThrow(/weak secret/i);
  });

  it("passes with strong production secrets", () => {
    expect(() => assertProductionSecurityBootstrap()).not.toThrow();
  });
});

describe("rate limit topology awareness", () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
    vi.restoreAllMocks();
  });

  it("logs a startup warning when replica count > 1 and no shared store is configured", () => {
    process.env.NODE_ENV = "development";
    process.env.REPLICA_COUNT = "3";
    delete process.env.REDIS_URL;
    delete process.env.VALKEY_URL;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    assertProductionSecurityBootstrap();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/rate limit.*replica/i));
  });
});
