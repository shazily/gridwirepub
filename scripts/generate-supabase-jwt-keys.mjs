#!/usr/bin/env node
/**
 * Generate Supabase-compatible anon and service_role JWTs for self-hosted GoTrue/PostgREST.
 * Usage: node scripts/generate-supabase-jwt-keys.mjs <JWT_SECRET>
 */
import crypto from "node:crypto";

const secret = process.argv[2];
if (!secret || secret.length < 32) {
  console.error("Usage: node scripts/generate-supabase-jwt-keys.mjs <JWT_SECRET(min 32 chars)>");
  process.exit(1);
}

function signJwt(role) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 10 * 365 * 24 * 60 * 60;
  const payload = Buffer.from(
    JSON.stringify({
      role,
      iss: "supabase",
      iat,
      exp,
    }),
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const anon = signJwt("anon");
const service = signJwt("service_role");
console.log(JSON.stringify({ anon_key: anon, service_role_key: service }));
