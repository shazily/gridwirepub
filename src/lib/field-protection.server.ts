import { createHash, createDecipheriv, createCipheriv, createHmac, randomBytes } from "crypto";
import type { HashAlgo } from "@/lib/api-serve.server";

export type FieldMasking = "none" | "mask" | "hash" | "encrypt";

function isPlaceholderEncryptionKey(raw: string): boolean {
  return !raw.trim() || raw.includes("replace-with");
}

function isValidHexKey(raw: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(raw);
}

function devInsecureEncryptionAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.FIELD_ENCRYPTION_ALLOW_INSECURE_DEV === "true"
  );
}

/** Throws when production lacks a valid FIELD_ENCRYPTION_KEY. */
export function assertFieldEncryptionProductionConfig(): void {
  if (process.env.NODE_ENV !== "production") return;
  const raw = process.env.FIELD_ENCRYPTION_KEY ?? "";
  if (!isValidHexKey(raw)) {
    throw new Error(
      "FIELD_ENCRYPTION_KEY must be set to a 64-character hex value in production (openssl rand -hex 32).",
    );
  }
}

function encryptionKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY ?? "";

  if (isValidHexKey(raw)) return Buffer.from(raw, "hex");

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "FIELD_ENCRYPTION_KEY must be set to a 64-character hex value in production (openssl rand -hex 32).",
    );
  }

  if (devInsecureEncryptionAllowed()) {
    if (isPlaceholderEncryptionKey(raw)) {
      console.warn(
        "[field-protection] FIELD_ENCRYPTION_ALLOW_INSECURE_DEV=true — using derived key from empty/placeholder material. Do not use in production.",
      );
    }
    return createHash("sha256").update(raw).digest();
  }

  throw new Error(
    "FIELD_ENCRYPTION_KEY must be a 64-character hex value, or set FIELD_ENCRYPTION_ALLOW_INSECURE_DEV=true for local development only.",
  );
}

export function encryptValueAtRest(v: unknown): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(v ?? ""), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const b64 = (b: Buffer) => b.toString("base64url");
  return `enc:v1:${b64(iv)}.${b64(tag)}.${b64(ct)}`;
}

export function decryptValueAtRest(stored: string): string {
  if (!stored.startsWith("enc:v1:")) return stored;
  const parts = stored.slice(7).split(".");
  if (parts.length !== 3) throw new Error("Invalid encrypted value format");
  const [ivB64, tagB64, ctB64] = parts;
  const key = encryptionKey();
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const ct = Buffer.from(ctB64, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function isEncryptedAtRest(v: unknown): boolean {
  return typeof v === "string" && v.startsWith("enc:v1:");
}

function maskValue(v: unknown): string {
  const s = String(v ?? "");
  if (s.length <= 4) return "****";
  return `${s.slice(0, 2)}${"*".repeat(Math.max(4, s.length - 4))}${s.slice(-2)}`;
}

function hashValue(v: unknown, algo: HashAlgo = "sha256"): string {
  const input = String(v ?? "");
  switch (algo) {
    case "sha512":
      return createHash("sha512").update(input).digest("hex");
    case "sha3_256":
      return createHash("sha3-256").update(input).digest("hex");
    case "sha3_512":
      return createHash("sha3-512").update(input).digest("hex");
    case "hmac_sha256":
      return createHmac("sha256", encryptionKey()).update(input).digest("hex");
    case "hmac_sha512":
      return createHmac("sha512", encryptionKey()).update(input).digest("hex");
    default:
      return createHash("sha256").update(input).digest("hex");
  }
}

export type ProtectionField = {
  api_name: string;
  masking: FieldMasking;
  hash_algo?: HashAlgo;
};

/** Apply protection before persisting row data to the database. */
export function applyProtectionAtIngest(
  row: Record<string, unknown>,
  fields: ProtectionField[],
): Record<string, unknown> {
  const out = { ...row };
  for (const f of fields) {
    if (!(f.api_name in out)) continue;
    const v = out[f.api_name];
    if (v === null || v === undefined) continue;
    switch (f.masking) {
      case "mask":
        out[f.api_name] = maskValue(v);
        break;
      case "hash":
        out[f.api_name] = hashValue(v, f.hash_algo ?? "sha256");
        break;
      case "encrypt":
        out[f.api_name] = encryptValueAtRest(v);
        break;
      default:
        break;
    }
  }
  return out;
}

/** Decrypt at-rest encrypted fields when serving API responses. */
export function revealProtectedValue(
  value: unknown,
  masking: FieldMasking,
  hashAlgo: HashAlgo = "sha256",
): unknown {
  if (value === null || value === undefined) return null;
  if (masking === "encrypt" && isEncryptedAtRest(value)) {
    try {
      return decryptValueAtRest(String(value));
    } catch {
      return null;
    }
  }
  if (masking === "hash" || masking === "mask") return value;
  return value;
}
