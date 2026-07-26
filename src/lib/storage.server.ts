import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

export type StorageProvider = "minio" | "s3" | "platform";

export type StorageProfile = {
  provider?: StorageProvider;
  endpoint?: string;
  bucket?: string;
  prefix?: string;
  region?: string;
  access_key_id?: string;
  secret_access_key?: string;
  use_ssl?: boolean;
  /** Optional SSE-S3 (AES256) when the backend supports it (AWS S3 / MinIO with SSE). */
  sse?: "AES256" | null;
};

export type OrgStorageContext = {
  orgId: string;
  profile: StorageProfile;
};

export type PutObjectOptions = {
  /** Original untrusted filename — stored only in object metadata, never used as the key leaf. */
  originalFileName?: string;
  orgId?: string;
  datasetId?: string;
};

const PLATFORM_BUCKET = process.env.STORAGE_BUCKET ?? "gridwire";
const PLATFORM_ENDPOINT = process.env.STORAGE_ENDPOINT ?? "http://minio:9000";
const PLATFORM_ACCESS_KEY = process.env.STORAGE_ACCESS_KEY ?? "gridwire";
const PLATFORM_SECRET_KEY = process.env.STORAGE_SECRET_KEY ?? "";
const PLATFORM_REGION = process.env.STORAGE_REGION ?? "us-east-1";

const ENC_META_KEY = "gridwire-enc";
const ENC_VERSION = "v1";
const ORIGINAL_NAME_META = "gridwire-original-name";

export class UnsafeStoragePathError extends Error {
  readonly code = "UNSAFE_STORAGE_PATH" as const;
  readonly reason: string;
  readonly orgId?: string;
  readonly datasetId?: string;

  constructor(reason: string, message: string, ctx?: { orgId?: string; datasetId?: string }) {
    super(message);
    this.name = "UnsafeStoragePathError";
    this.reason = reason;
    this.orgId = ctx?.orgId;
    this.datasetId = ctx?.datasetId;
  }
}

function logRejectedPath(reason: string, input: string, ctx?: { orgId?: string; datasetId?: string }) {
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "storage_path_jail_rejected",
      reason,
      input_preview: String(input).slice(0, 120),
      org_id: ctx?.orgId ?? null,
      dataset_id: ctx?.datasetId ?? null,
    }),
  );
}

function rejectPath(reason: string, input: string, ctx?: { orgId?: string; datasetId?: string }): never {
  logRejectedPath(reason, input, ctx);
  throw new UnsafeStoragePathError(reason, `${reason}: rejected storage path`, ctx);
}

/**
 * Reject encoded traversal/null sequences in the raw string, then percent-decode
 * (up to 3 passes) before path-jail checks. Opaque keys alone must not be the
 * only control that "saves" a filter miss.
 */
export function canonicalizeUntrustedPathInput(
  rawInput: string,
  ctx?: { orgId?: string; datasetId?: string },
): string {
  const raw = (rawInput ?? "").toString();
  if (!raw.trim()) rejectPath("empty_input", raw, ctx);

  if (/%00/i.test(raw)) rejectPath("encoded_null", raw, ctx);
  if (/%2e%2e/i.test(raw) || /%2e\./i.test(raw) || /\.%2e/i.test(raw)) {
    rejectPath("encoded_parent", raw, ctx);
  }
  if (/%2f/i.test(raw) || /%5c/i.test(raw)) rejectPath("encoded_separator", raw, ctx);
  if (/%252e/i.test(raw) || /%252f/i.test(raw) || /%255c/i.test(raw) || /%2500/i.test(raw)) {
    rejectPath("double_encoded_traversal", raw, ctx);
  }

  let decoded = raw;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded.replace(/\+/g, "%20"));
      if (next === decoded) break;
      decoded = next;
    } catch {
      rejectPath("bad_encoding", raw, ctx);
    }
  }

  if (decoded.includes("\0")) rejectPath("null_byte", decoded, ctx);
  return decoded;
}

function assertNoTraversalInDecoded(
  input: string,
  ctx?: { orgId?: string; datasetId?: string },
): string {
  if (input.includes("\0")) rejectPath("null_byte", input, ctx);
  if (input.startsWith("/") || input.startsWith("\\")) rejectPath("absolute_path", input, ctx);
  if (/^[a-zA-Z]:[\\/]/.test(input)) rejectPath("drive_letter", input, ctx);
  if (input.includes("..")) rejectPath("parent_segment", input, ctx);

  const normalized = input.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (normalized.startsWith("/") || normalized.includes("..")) {
    rejectPath("normalized_escape", input, ctx);
  }
  for (const segment of normalized.split("/")) {
    if (!segment || segment === "." || segment === "..") {
      rejectPath("normalized_escape", input, ctx);
    }
    if (segment.includes("\0")) rejectPath("null_byte", input, ctx);
  }
  return normalized;
}

/** Normalize a tenant/org prefix used as the jail root for object keys. */
export function normalizeStorageTenantPrefix(tenantPrefix: string): string {
  const raw = (tenantPrefix ?? "").toString().trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!raw) throw new UnsafeStoragePathError("empty_prefix", "storage tenant prefix is required");
  if (raw.includes("\0")) throw new UnsafeStoragePathError("null_byte", "storage tenant prefix contains null byte");
  if (raw.includes("..")) throw new UnsafeStoragePathError("parent_segment", "storage tenant prefix must not contain ..");
  if (/^[a-zA-Z]:/.test(raw)) throw new UnsafeStoragePathError("drive_letter", "storage tenant prefix must not be a drive path");
  if (!/^[a-zA-Z0-9._/-]+$/.test(raw)) {
    throw new UnsafeStoragePathError("illegal_chars", "storage tenant prefix contains invalid characters");
  }
  return raw;
}

/**
 * Validate a single object-key segment (trusted structural parts like dataset ids).
 * Rejects traversal, absolute paths, drive letters, and null bytes.
 */
export function assertSafeStorageKeyPart(
  part: string,
  ctx?: { orgId?: string; datasetId?: string },
): string {
  const decoded = canonicalizeUntrustedPathInput(part, ctx);
  if (!decoded.trim()) rejectPath("empty_segment", part, ctx);
  if (decoded.includes("/") || decoded.includes("\\")) rejectPath("nested_segment", part, ctx);
  if (decoded === "." || decoded === "..") rejectPath("dot_segment", part, ctx);
  assertNoTraversalInDecoded(decoded, ctx);
  if (!/^[a-zA-Z0-9._@+-]+$/.test(decoded)) rejectPath("illegal_chars", part, ctx);
  return decoded;
}

function safeFileExtension(untrustedInput: string): string | null {
  const base = untrustedInput.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,16}$/.test(ext)) return null;
  return ext;
}

function sanitizeOriginalNameForMetadata(name: string): string {
  return name.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 200) || "upload.bin";
}

/**
 * Canonicalize-and-validate an untrusted relative path/filename into an opaque
 * object key under `tenantPrefix` (CBFS / path-jail for MinIO/S3 keys).
 *
 * The original filename is never used as the storage key leaf — only a random
 * opaque id (optional safe extension) is stored under the tenant prefix.
 */
export function resolveSafeStoragePath(
  tenantPrefix: string,
  untrustedInput: string,
  ctx?: { orgId?: string; datasetId?: string },
): string {
  const prefix = normalizeStorageTenantPrefix(tenantPrefix);
  const decoded = canonicalizeUntrustedPathInput(untrustedInput, ctx);
  const normalized = assertNoTraversalInDecoded(decoded, ctx);

  const opaque = randomBytes(16).toString("hex");
  const ext = safeFileExtension(normalized);
  const leaf = ext ? `${opaque}.${ext}` : opaque;
  const key = `${prefix}/${leaf}`;

  if (!key.startsWith(`${prefix}/`)) {
    rejectPath("prefix_mismatch", key, ctx);
  }
  if (key.includes("..") || key.includes("\\") || key.includes("\0")) {
    rejectPath("key_unsafe_after_build", key, ctx);
  }
  const originalBase = normalized.split("/").pop() ?? "";
  if (originalBase && key.toLowerCase().includes(originalBase.toLowerCase())) {
    const opaque2 = randomBytes(16).toString("hex");
    const leaf2 = ext ? `${opaque2}.${ext}` : opaque2;
    const key2 = `${prefix}/${leaf2}`;
    if (!key2.startsWith(`${prefix}/`)) rejectPath("prefix_mismatch", key2, ctx);
    return key2;
  }

  return key;
}

/**
 * Validate an already-built object key stays under the expected tenant prefix
 * (used on reads to reject crafted s3:// refs).
 */
export function assertObjectKeyUnderPrefix(
  key: string,
  tenantPrefix: string,
  ctx?: { orgId?: string; datasetId?: string },
): string {
  const prefix = normalizeStorageTenantPrefix(tenantPrefix);
  const normalized = (key ?? "").toString().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.startsWith(`${prefix}/`) && normalized !== prefix) {
    rejectPath("key_outside_prefix", key, ctx);
  }
  if (normalized.includes("..") || normalized.includes("\0")) {
    rejectPath("key_traversal", key, ctx);
  }
  return normalized;
}

function resolveProfile(orgProfile: StorageProfile | null | undefined): StorageProfile {
  if (orgProfile?.provider && orgProfile.provider !== "platform" && orgProfile.endpoint && orgProfile.bucket) {
    return orgProfile;
  }
  return {
    provider: "platform",
    endpoint: PLATFORM_ENDPOINT,
    bucket: PLATFORM_BUCKET,
    prefix: orgProfile?.prefix ?? "",
    region: PLATFORM_REGION,
    access_key_id: PLATFORM_ACCESS_KEY,
    secret_access_key: PLATFORM_SECRET_KEY,
    use_ssl: PLATFORM_ENDPOINT.startsWith("https"),
    sse: orgProfile?.sse ?? null,
  };
}

function clientFor(profile: StorageProfile): S3Client {
  const endpoint = profile.endpoint!;
  return new S3Client({
    region: profile.region ?? "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: profile.access_key_id ?? PLATFORM_ACCESS_KEY,
      secretAccessKey: profile.secret_access_key ?? PLATFORM_SECRET_KEY,
    },
  });
}

function tenantPrefixFor(orgId: string, profile: StorageProfile): string {
  const configured = (profile.prefix ?? "").trim();
  if (configured) return normalizeStorageTenantPrefix(configured);
  return normalizeStorageTenantPrefix(`orgs/${orgId}`);
}

function objectKey(orgId: string, profile: StorageProfile, ...parts: string[]): string {
  const ctx = { orgId };
  const prefix = tenantPrefixFor(orgId, profile);
  const safeParts = parts.map((p) => assertSafeStorageKeyPart(p, ctx));
  const key = [prefix, ...safeParts].filter(Boolean).join("/");
  return assertObjectKeyUnderPrefix(key, prefix, ctx);
}

/** 32-byte key from STORAGE_ENCRYPTION_KEY (hex) or FIELD_ENCRYPTION_KEY fallback. */
export function storageEncryptionKey(): Buffer | null {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.FIELD_ENCRYPTION_ALLOW_INSECURE_DEV === "true"
  ) {
    throw new Error(
      "FIELD_ENCRYPTION_ALLOW_INSECURE_DEV=true is forbidden when NODE_ENV=production",
    );
  }
  const raw =
    process.env.STORAGE_ENCRYPTION_KEY?.trim() ||
    process.env.FIELD_ENCRYPTION_KEY?.trim() ||
    "";
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  if (process.env.NODE_ENV === "production") {
    return null;
  }
  if (process.env.FIELD_ENCRYPTION_ALLOW_INSECURE_DEV === "true" && raw.length > 0) {
    return createHash("sha256").update(`gridwire-storage-dev:${raw}`).digest();
  }
  if (process.env.FIELD_ENCRYPTION_ALLOW_INSECURE_DEV === "true") {
    return createHash("sha256").update("gridwire-storage-insecure-dev").digest();
  }
  return null;
}

export function blobEncryptionEnabled(): boolean {
  return storageEncryptionKey() !== null;
}

/** AES-256-GCM: iv(12) || tag(16) || ciphertext */
export function encryptBlobAtRest(plain: Buffer | Uint8Array): Buffer {
  const key = storageEncryptionKey();
  if (!key) throw new Error("Storage encryption key not configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plain)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

export function decryptBlobAtRest(packed: Buffer): Buffer {
  const key = storageEncryptionKey();
  if (!key) throw new Error("Storage encryption key not configured");
  if (packed.length < 28) throw new Error("Encrypted blob too short");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ct = packed.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export async function ensureBucket(profile: StorageProfile): Promise<void> {
  const client = clientFor(profile);
  try {
    await client.send(new HeadBucketCommand({ Bucket: profile.bucket! }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: profile.bucket! }));
  }
}

export async function putObject(
  ctx: OrgStorageContext,
  parts: string[],
  body: Buffer | Uint8Array,
  contentType: string,
  options?: PutObjectOptions,
): Promise<string> {
  const profile = resolveProfile(ctx.profile);
  if (!profile.bucket) throw new Error("Storage bucket not configured");
  await ensureBucket(profile);

  const auditCtx = {
    orgId: options?.orgId ?? ctx.orgId,
    datasetId: options?.datasetId,
  };
  const prefix = tenantPrefixFor(ctx.orgId, profile);

  let key: string;
  if (options?.originalFileName) {
    const dirParts = parts.slice(0, Math.max(0, parts.length - 1)).map((p) =>
      assertSafeStorageKeyPart(p, auditCtx),
    );
    const dirPrefix = [prefix, ...dirParts].filter(Boolean).join("/");
    key = resolveSafeStoragePath(dirPrefix, options.originalFileName, auditCtx);
  } else {
    key = objectKey(ctx.orgId, profile, ...parts);
  }

  const client = clientFor(profile);
  const keyBuf = storageEncryptionKey();
  let payload: Buffer = Buffer.from(body);
  const metadata: Record<string, string> = {};
  if (keyBuf) {
    payload = encryptBlobAtRest(payload);
    metadata[ENC_META_KEY] = ENC_VERSION;
  }
  if (options?.originalFileName) {
    metadata[ORIGINAL_NAME_META] = sanitizeOriginalNameForMetadata(options.originalFileName);
  }

  await client.send(
    new PutObjectCommand({
      Bucket: profile.bucket,
      Key: key,
      Body: payload,
      ContentType: keyBuf ? "application/octet-stream" : contentType,
      Metadata: Object.keys(metadata).length ? metadata : undefined,
      ...(profile.sse === "AES256" ? { ServerSideEncryption: "AES256" as const } : {}),
    }),
  );
  return `s3://${profile.bucket}/${key}`;
}

export async function getObjectBytes(fileRef: string, profile: StorageProfile): Promise<Buffer> {
  const resolved = resolveProfile(profile);
  const match = fileRef.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Invalid file ref: ${fileRef}`);
  const [, bucket, keyRaw] = match;
  const key = (keyRaw ?? "").replace(/\\/g, "/");
  if (key.includes("..") || key.includes("\0") || key.startsWith("/")) {
    rejectPath("read_key_traversal", key, undefined);
  }

  const client = clientFor(resolved);
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Uint8Array[] = [];
  const stream = resp.Body;
  if (!stream || typeof stream === "string") throw new Error("Empty object body");
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const packed = Buffer.concat(chunks);
  const encMeta = resp.Metadata?.[ENC_META_KEY] ?? resp.Metadata?.["Gridwire-Enc"];
  if (encMeta === ENC_VERSION) {
    return decryptBlobAtRest(packed);
  }
  // Legacy plaintext objects remain readable until re-uploaded.
  return packed;
}

export async function testStorageConnection(profile: StorageProfile): Promise<{ ok: boolean; message: string }> {
  try {
    const resolved = resolveProfile(profile.provider === "platform" ? {} : profile);
    await ensureBucket(resolved);
    const stamp = `${Date.now()}.txt`;
    const ref = await putObject(
      { orgId: "healthcheck", profile: resolved },
      ["healthcheck", stamp],
      Buffer.from("ok"),
      "text/plain",
      { originalFileName: "healthcheck.txt", orgId: "healthcheck" },
    );
    const roundTrip = await getObjectBytes(ref, resolved);
    if (roundTrip.toString("utf8") !== "ok") {
      return { ok: false, message: "Storage connected but encrypted round-trip failed" };
    }
    const enc = blobEncryptionEnabled() ? "blob encryption on" : "blob encryption off (set STORAGE_ENCRYPTION_KEY)";
    return {
      ok: true,
      message: `Connected to ${resolved.endpoint} bucket ${resolved.bucket} (${enc})`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Storage connection failed" };
  }
}

export function storageEnabled(): boolean {
  return Boolean(PLATFORM_SECRET_KEY || process.env.STORAGE_ACCESS_KEY);
}
