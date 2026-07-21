#!/usr/bin/env node
/**
 * Gridwire companion ingestion worker
 * --------------------------------------------------------------------------
 * Polls the Gridwire portal for enabled connectors, fetches new/changed files
 * from SFTP / NFS / watched folders, and pushes them into the portal's ingest
 * pipeline. Also executes queued "test" runs and reports results back.
 *
 * Credentials live ONLY here (in env / the connectors map below) — never in the
 * portal database. The portal stores non-secret config (host, path, schedule).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import cron from "node-cron";
import SftpClient from "ssh2-sftp-client";
import { assertSafeConnectorPath, safeJoinUnderDir } from "./connector-path-guard.js";
import { assertConnectorHostAllowed } from "./connector-host-guard.js";

const PORTAL_URL = (process.env.PORTAL_URL || "").replace(/\/$/, "");
const WORKER_TOKEN = process.env.WORKER_INGEST_TOKEN || "";
const POLL_CRON = process.env.POLL_CRON || "*/5 * * * *";
const STATE_FILE = process.env.STATE_FILE || "/data/state.json";
// Health/readiness HTTP port (liveness: /healthz, readiness: /readyz). Set 0 to disable.
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 8080);

// Rolling health state, surfaced on the health endpoints and used by k8s probes.
const health = {
  startedAt: Date.now(),
  lastTickAt: 0, // last time a poll cycle finished
  lastOkAt: 0, // last time the portal was reachable
  lastError: null,
};

// Cumulative counters, exported in Prometheus format on /metrics.
const metrics = {
  pollCyclesTotal: 0,
  pollErrorsTotal: 0, // cycles where the portal was unreachable
  connectorsProcessedTotal: 0,
  filesIngestedTotal: 0,
  jobErrorsTotal: 0, // per-connector processing failures
  testRunsTotal: 0,
  lastTickDurationMs: 0,
};

// Per-connector secrets, keyed by connector id. Supply via SFTP_SECRETS env as
// JSON: { "<connector-id>": { "password": "...", "privateKey": "..." } }
const SFTP_SECRETS = JSON.parse(process.env.SFTP_SECRETS || "{}");

if (!PORTAL_URL || !WORKER_TOKEN) {
  console.error("[gridwire-worker] PORTAL_URL and WORKER_INGEST_TOKEN are required.");
  process.exit(1);
}

// ---- tiny local state (which files we've already ingested) -----------------
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { seen: {} };
  }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
function safeTokenEqual(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---- portal API ------------------------------------------------------------
const headers = { "x-worker-token": WORKER_TOKEN, "Content-Type": "application/json" };

async function fetchConnectors() {
  const res = await fetch(`${PORTAL_URL}/api/public/worker/connectors`, { headers });
  if (!res.ok) throw new Error(`connectors ${res.status}: ${await res.text()}`);
  return (await res.json()).connectors ?? [];
}

async function report(body) {
  const res = await fetch(`${PORTAL_URL}/api/public/worker/report`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error("[report] failed:", res.status, await res.text());
}

async function ingest(connectorId, fileName, buf, runId) {
  const res = await fetch(`${PORTAL_URL}/api/public/worker/ingest`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      connector_id: connectorId,
      file_name: fileName,
      content_base64: buf.toString("base64"),
      run_id: runId,
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `ingest ${res.status}`);
  return out;
}

// ---- source readers --------------------------------------------------------
function matchPattern(name, pattern) {
  if (!pattern || pattern === "*") return true;
  const base = pattern.split("/").pop() || "*";
  const re = new RegExp("^" + base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i");
  return re.test(name);
}

// Returns [{ name, buf }] for files found at the source.
async function readFolder(cfg) {
  const raw = cfg.path || ".";
  const pattern = raw.split("/").pop();
  const dir = assertSafeConnectorPath(
    raw.replace(/\/[^/]*\*[^/]*$/, "") || raw,
    process.env.CONNECTOR_ALLOWED_ROOT,
  );
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && matchPattern(e.name, pattern))
    .map((e) => ({
      name: e.name,
      buf: fs.readFileSync(safeJoinUnderDir(dir, e.name)),
    }));
}

async function readSftp(connector) {
  const cfg = connector.config || {};
  const secret = SFTP_SECRETS[connector.id] || {};
  if (!secret.password && !secret.privateKey) {
    throw new Error(
      `SFTP credentials missing for connector ${connector.id}. Add an entry to the worker SFTP_SECRETS env.`,
    );
  }
  await assertConnectorHostAllowed(cfg.host);
  const sftp = new SftpClient();
  const rawPath = cfg.path || ".";
  if (String(rawPath).includes("..")) {
    throw new Error("SFTP path must not contain parent-directory segments");
  }
  const dir = rawPath.replace(/\/[^/]*\*[^/]*$/, "") || rawPath || ".";
  const pattern = rawPath.split("/").pop();
  try {
    await sftp.connect({
      host: cfg.host,
      port: cfg.port || 22,
      username: cfg.username,
      password: secret.password,
      privateKey: secret.privateKey,
    });
    const list = await sftp.list(dir);
    const out = [];
    for (const item of list) {
      if (item.type !== "-" || !matchPattern(item.name, pattern)) continue;
      if (item.name.includes("..") || item.name.includes("/") || item.name.includes("\\")) continue;
      const remotePath = `${dir.replace(/\/$/, "")}/${item.name}`;
      const buf = await sftp.get(remotePath);
      out.push({ name: item.name, buf: Buffer.isBuffer(buf) ? buf : Buffer.from(buf) });
    }
    return out;
  } finally {
    sftp.end().catch(() => {});
  }
}

async function readSource(connector) {
  // NFS / network shares are expected to be mounted into the container as a
  // local path, so they are handled the same way as watched folders.
  if (connector.type === "sftp") return readSftp(connector);
  return readFolder(connector.config || {});
}

// ---- core loop -------------------------------------------------------------
const MAX_CONNECTOR_RETRIES = Number(process.env.CONNECTOR_MAX_RETRIES || 3);
const RETRY_DELAYS_MS = [1000, 5000, 15000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processConnector(connector, state) {
  const isTest = Boolean(connector.queued_test_run_id);
  const runId = connector.queued_test_run_id || undefined;
  let lastErr = null;

  for (let attempt = 0; attempt <= MAX_CONNECTOR_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
        console.log(`[${connector.name}] retry ${attempt}/${MAX_CONNECTOR_RETRIES} in ${delay}ms`);
        await sleep(delay);
      }
      await report({
        connector_id: connector.id,
        run_id: runId,
        kind: isTest ? "test" : "poll",
        status: "running",
        retry_count: attempt,
      });
      const files = await readSource(connector);

      if (isTest) {
        metrics.testRunsTotal++;
        await report({
          connector_id: connector.id,
          run_id: runId,
          kind: "test",
          status: "success",
          message: `Connectivity OK. ${files.length} file(s) visible at source.`,
          files_found: files.length,
          retry_count: attempt,
        });
        return;
      }

      let ingested = 0;
      for (const f of files) {
        const fp = fingerprint(f.buf);
        const key = `${connector.id}:${f.name}`;
        if (state.seen[key] === fp) continue;
        await ingest(connector.id, f.name, f.buf);
        state.seen[key] = fp;
        ingested++;
      }
      metrics.filesIngestedTotal += ingested;
      saveState(state);
      await report({
        connector_id: connector.id,
        kind: "poll",
        status: "success",
        message: ingested ? `Ingested ${ingested} new/changed file(s).` : "No new files.",
        files_found: files.length,
        files_ingested: ingested,
        retry_count: attempt,
      });
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_CONNECTOR_RETRIES) continue;
    }
  }

  metrics.jobErrorsTotal++;
  console.error(`[${connector.name}]`, lastErr?.message);
  await report({
    connector_id: connector.id,
    run_id: runId,
    kind: isTest ? "test" : "poll",
    status: "error",
    message: lastErr?.message?.slice(0, 1900),
    retry_count: MAX_CONNECTOR_RETRIES,
    dead_letter: true,
  });
}

async function tick() {
  const tickStart = Date.now();
  metrics.pollCyclesTotal++;
  const state = loadState();
  let connectors;
  try {
    connectors = await fetchConnectors();
    health.lastOkAt = Date.now();
    health.lastError = null;
  } catch (e) {
    metrics.pollErrorsTotal++;
    health.lastError = e.message;
    console.error("[gridwire-worker] cannot reach portal:", e.message);
    return;
  } finally {
    health.lastTickAt = Date.now();
    metrics.lastTickDurationMs = Date.now() - tickStart;
  }
  // Always run enabled connectors and any connector with a queued test.
  const todo = connectors.filter((c) => c.enabled || c.queued_test_run_id);
  console.log(`[gridwire-worker] ${new Date().toISOString()} — processing ${todo.length} connector(s)`);
  for (const c of todo) {
    await processConnector(c, state);
    metrics.connectorsProcessedTotal++;
  }
  metrics.lastTickDurationMs = Date.now() - tickStart;
}

// ---- Prometheus metrics ----------------------------------------------------
// Cumulative counters + a couple of gauges, in the text exposition format.
function renderMetrics() {
  const now = Date.now();
  const ready = health.lastOkAt > 0 && now - health.lastOkAt < 5 * 60 * 1000 * 2 ? 1 : 0;
  const lines = [
    "# HELP gridwire_worker_up Worker process is running.",
    "# TYPE gridwire_worker_up gauge",
    "gridwire_worker_up 1",
    "# HELP gridwire_worker_ready Portal was reachable within the last two poll intervals.",
    "# TYPE gridwire_worker_ready gauge",
    `gridwire_worker_ready ${ready}`,
    "# HELP gridwire_worker_uptime_seconds Seconds since the worker started.",
    "# TYPE gridwire_worker_uptime_seconds gauge",
    `gridwire_worker_uptime_seconds ${Math.round((now - health.startedAt) / 1000)}`,
    "# HELP gridwire_worker_last_tick_duration_ms Duration of the most recent poll cycle.",
    "# TYPE gridwire_worker_last_tick_duration_ms gauge",
    `gridwire_worker_last_tick_duration_ms ${metrics.lastTickDurationMs}`,
    "# HELP gridwire_worker_poll_cycles_total Poll cycles started.",
    "# TYPE gridwire_worker_poll_cycles_total counter",
    `gridwire_worker_poll_cycles_total ${metrics.pollCyclesTotal}`,
    "# HELP gridwire_worker_poll_errors_total Poll cycles where the portal was unreachable.",
    "# TYPE gridwire_worker_poll_errors_total counter",
    `gridwire_worker_poll_errors_total ${metrics.pollErrorsTotal}`,
    "# HELP gridwire_worker_connectors_processed_total Connectors processed across all cycles.",
    "# TYPE gridwire_worker_connectors_processed_total counter",
    `gridwire_worker_connectors_processed_total ${metrics.connectorsProcessedTotal}`,
    "# HELP gridwire_worker_files_ingested_total Files ingested into the portal.",
    "# TYPE gridwire_worker_files_ingested_total counter",
    `gridwire_worker_files_ingested_total ${metrics.filesIngestedTotal}`,
    "# HELP gridwire_worker_job_errors_total Per-connector processing failures.",
    "# TYPE gridwire_worker_job_errors_total counter",
    `gridwire_worker_job_errors_total ${metrics.jobErrorsTotal}`,
    "# HELP gridwire_worker_test_runs_total Connector connectivity test runs.",
    "# TYPE gridwire_worker_test_runs_total counter",
    `gridwire_worker_test_runs_total ${metrics.testRunsTotal}`,
  ];
  return lines.join("\n") + "\n";
}

// ---- health / readiness server ---------------------------------------------
// Liveness (/healthz): the process is running. Readiness (/readyz): the portal
// was reachable within the last two poll intervals, so the worker is useful.
// Metrics (/metrics): Prometheus-compatible counters/gauges.
function startHealthServer() {
  if (!HEALTH_PORT) return;
  const cronMs = 5 * 60 * 1000; // conservative default window
  const metricsToken = process.env.METRICS_TOKEN || "";
  const server = http.createServer((req, res) => {
    const now = Date.now();
    const url = new URL(req.url, "http://localhost");
    const body = {
      status: "ok",
      uptime_s: Math.round((now - health.startedAt) / 1000),
      last_tick_at: health.lastTickAt ? new Date(health.lastTickAt).toISOString() : null,
      last_ok_at: health.lastOkAt ? new Date(health.lastOkAt).toISOString() : null,
      last_error: health.lastError,
    };
    if (url.pathname === "/metrics") {
      if (metricsToken) {
        const header = req.headers["authorization"] || "";
        const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
        const provided = bearer || url.searchParams.get("token") || "";
        if (!safeTokenEqual(provided, metricsToken)) {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("Unauthorized");
          return;
        }
      }
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(renderMetrics());
      return;
    }
    if (url.pathname === "/readyz") {
      // Ready once we've had at least one successful portal contact recently.
      const ready = health.lastOkAt > 0 && now - health.lastOkAt < cronMs * 2;
      res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...body, status: ready ? "ready" : "not-ready" }));
      return;
    }
    // /healthz and anything else → liveness
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  server.listen(HEALTH_PORT, () => {
    console.log(`[gridwire-worker] health server on :${HEALTH_PORT} (/healthz, /readyz, /metrics)`);
  });
}

console.log(`[gridwire-worker] started · portal=${PORTAL_URL} · schedule="${POLL_CRON}"`);
startHealthServer();
tick();
cron.schedule(POLL_CRON, tick);
