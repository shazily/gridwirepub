import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";

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
};

export type OrgStorageContext = {
  orgId: string;
  profile: StorageProfile;
};

const PLATFORM_BUCKET = process.env.STORAGE_BUCKET ?? "gridwire";
const PLATFORM_ENDPOINT = process.env.STORAGE_ENDPOINT ?? "http://minio:9000";
const PLATFORM_ACCESS_KEY = process.env.STORAGE_ACCESS_KEY ?? "gridwire";
const PLATFORM_SECRET_KEY = process.env.STORAGE_SECRET_KEY ?? "";
const PLATFORM_REGION = process.env.STORAGE_REGION ?? "us-east-1";

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

function objectKey(orgId: string, profile: StorageProfile, ...parts: string[]): string {
  const prefix = (profile.prefix ?? `orgs/${orgId}`).replace(/\/$/, "");
  return [prefix, ...parts].filter(Boolean).join("/");
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
): Promise<string> {
  const profile = resolveProfile(ctx.profile);
  if (!profile.bucket) throw new Error("Storage bucket not configured");
  await ensureBucket(profile);
  const key = objectKey(ctx.orgId, profile, ...parts);
  const client = clientFor(profile);
  await client.send(
    new PutObjectCommand({
      Bucket: profile.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return `s3://${profile.bucket}/${key}`;
}

export async function getObjectBytes(fileRef: string, profile: StorageProfile): Promise<Buffer> {
  const resolved = resolveProfile(profile);
  const match = fileRef.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Invalid file ref: ${fileRef}`);
  const [, bucket, key] = match;
  const client = clientFor(resolved);
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Uint8Array[] = [];
  const stream = resp.Body;
  if (!stream || typeof stream === "string") throw new Error("Empty object body");
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function testStorageConnection(profile: StorageProfile): Promise<{ ok: boolean; message: string }> {
  try {
    const resolved = resolveProfile(profile.provider === "platform" ? {} : profile);
    await ensureBucket(resolved);
    const testKey = `healthcheck/${Date.now()}.txt`;
    await putObject(
      { orgId: "healthcheck", profile: resolved },
      [testKey],
      Buffer.from("ok"),
      "text/plain",
    );
    return { ok: true, message: `Connected to ${resolved.endpoint} bucket ${resolved.bucket}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Storage connection failed" };
  }
}

export function storageEnabled(): boolean {
  return Boolean(PLATFORM_SECRET_KEY || process.env.STORAGE_ACCESS_KEY);
}
