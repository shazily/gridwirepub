/**
 * Live smoke: unpublish keeps rows, API goes offline, restore brings API back.
 * Usage: node scripts/smoke-lifecycle.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=\s][^=]*)=(.*)$/);
    if (!m) continue;
    env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "sheet";
}

const env = loadEnv();
const portal = `http://127.0.0.1:${env.GRIDWIRE_HOST_PORT || "3020"}`;
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (/kong|:8000\b/.test(url) && !/127\.0\.0\.1|localhost/.test(url)) {
  console.error("Use a host-reachable Supabase URL (VITE_SUPABASE_URL), not the in-compose kong hostname.");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: ds, error } = await sb
  .from("datasets")
  .select("id, name, status, api_access, current_version_id, org_id")
  .eq("status", "published")
  .not("current_version_id", "is", null)
  .order("updated_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (error || !ds) {
  console.error("No published dataset to test:", error?.message);
  process.exit(1);
}

const { data: fields } = await sb
  .from("dataset_fields")
  .select("sheet_name")
  .eq("version_id", ds.current_version_id)
  .limit(1);
const sheet = fields?.[0]?.sheet_name ?? "data";
const endpoint = `${portal}/api/v1/datasets/${ds.id}/${slugify(sheet)}?limit=1`;

const { count: rowsBefore } = await sb
  .from("dataset_rows")
  .select("id", { count: "exact", head: true })
  .eq("version_id", ds.current_version_id);

async function hit() {
  const res = await fetch(endpoint);
  const body = await res.text();
  return { status: res.status, body: body.slice(0, 200) };
}

const before = await hit();
if (before.status !== 200) {
  console.error("FAIL: expected 200 before unpublish", before);
  process.exit(1);
}

const archivedAt = new Date().toISOString();
const { error: archErr } = await sb
  .from("datasets")
  .update({ status: "archived", updated_at: archivedAt })
  .eq("id", ds.id);
if (archErr) {
  console.error("FAIL archive:", archErr.message);
  process.exit(1);
}

const mid = await hit();
if (mid.status !== 404) {
  console.error("FAIL: expected 404 while unpublished", mid);
  await sb.from("datasets").update({ status: "published" }).eq("id", ds.id);
  process.exit(1);
}
if (!/not published/i.test(mid.body)) {
  console.error("FAIL: expected not published message", mid.body);
  await sb.from("datasets").update({ status: "published" }).eq("id", ds.id);
  process.exit(1);
}

const { count: rowsMid } = await sb
  .from("dataset_rows")
  .select("id", { count: "exact", head: true })
  .eq("version_id", ds.current_version_id);

if (rowsMid !== rowsBefore) {
  console.error("FAIL: row count changed after archive", { rowsBefore, rowsMid });
  process.exit(1);
}

const { error: restErr } = await sb
  .from("datasets")
  .update({ status: "published", updated_at: new Date().toISOString() })
  .eq("id", ds.id);
if (restErr) {
  console.error("FAIL restore:", restErr.message);
  process.exit(1);
}

const after = await hit();
if (after.status !== 200) {
  console.error("FAIL: expected 200 after restore", after);
  process.exit(1);
}

const { data: published } = await sb
  .from("datasets")
  .select("id, api_access")
  .eq("org_id", ds.org_id)
  .eq("status", "published");
const publicN = (published ?? []).filter((d) => d.api_access === "public").length;
const secureN = (published ?? []).filter((d) => d.api_access !== "public").length;

console.log(
  JSON.stringify(
    {
      ok: true,
      dataset: ds.name,
      sheet,
      rowsKept: rowsBefore,
      apiBefore: before.status,
      apiUnpublished: mid.status,
      apiRestored: after.status,
      publishedStats: { total: published?.length ?? 0, public: publicN, secure: secureN },
    },
    null,
    2,
  ),
);
