# gridwire-worker

The **companion ingestion worker** for [Gridwire](../README.md). The portal runs
on an edge runtime that can't hold long-lived SFTP connections or mount network
filesystems, so source polling is delegated to this small Node service.

## What it does

On a schedule (default every 5 minutes) it:

1. Calls the portal's `GET /api/public/worker/connectors` (authenticated with a
   shared `WORKER_INGEST_TOKEN`) to discover enabled connectors and any queued
   **test** runs.
2. For each connector, lists files at the source:
   - **SFTP** — connects with credentials from `SFTP_SECRETS` and lists the path.
   - **NFS / network share** — read from the mount path (mount it into the
     container; it's handled like a folder).
   - **Watched folder** — reads a local/mounted directory.
3. Skips files it has already ingested (tracked by content hash in `STATE_FILE`).
4. Pushes new/changed files to `POST /api/public/worker/ingest`, which parses
   them and publishes a new version of the connector's **target dataset**.
5. Reports each run (success/error, files found/ingested) to
   `POST /api/public/worker/report`, visible in the portal under
   **Connectors → Logs**.

Credentials never leave the worker — the portal only stores non-secret config
(host, path, schedule, target dataset).

## Configuration

Copy `.env.example` to `.env` and fill it in:

| Variable | Description |
| --- | --- |
| `PORTAL_URL` | Base URL of your Gridwire portal (no trailing slash) |
| `WORKER_INGEST_TOKEN` | Must match the portal's `WORKER_INGEST_TOKEN` secret |
| `POLL_CRON` | Poll schedule (cron). Default `*/5 * * * *` |
| `STATE_FILE` | Path for ingest-state JSON. Default `/data/state.json` |
| `SFTP_SECRETS` | JSON map of `{ "<connector-id>": { "password"\|"privateKey" } }` |

## Run with Docker

```bash
docker build -t gridwire-worker .
docker run -d --name gridwire-worker \
  --env-file .env \
  -v gridwire-state:/data \
  -v /mnt/shares:/mnt/shares:ro \
  gridwire-worker
```

Or use the root `docker-compose.yml` which runs the portal and worker together.

## Run locally

```bash
npm install
PORTAL_URL=http://localhost:3000 WORKER_INGEST_TOKEN=... npm start
```

## Testing a connector

In the portal, open **Connectors → Test**. This queues a test run; the worker
picks it up on its next tick, attempts to connect/list the source, and reports
the result back to **Connectors → Logs**.
