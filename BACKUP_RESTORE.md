# Gridwire backup & restore runbook

All durable state lives in **one place: the backend Postgres database**. The
portal and worker are stateless (the worker's ingest-state file is a
convenience cache, not a source of truth). Back up Postgres and the field
encryption key and you have backed up everything.

> **Two things must survive a disaster together:**
> 1. A recent Postgres dump (data + schema).
> 2. `FIELD_ENCRYPTION_KEY` — encrypted field values are **unrecoverable**
>    without it. Store it in your secrets manager, backed up separately from
>    the database dump.

Scripts referenced below live in [`deploy/scripts/`](./deploy/scripts).

---

## 1. What to back up

| Item | Where | How |
| --- | --- | --- |
| Database (all app data, schema, RLS) | Backend Postgres | `pg_dump` (§2) |
| `FIELD_ENCRYPTION_KEY` | Secrets manager | Separate, encrypted-at-rest backup |
| Other secrets (`WORKER_INGEST_TOKEN`, service-role key) | Secrets manager | Same |
| Migrations | `supabase/migrations/` (in git) | Already versioned |

The worker's `STATE_FILE` does **not** need backing up — if lost, the worker
re-ingests source files on the next poll.

---

## 2. Manual backup with `pg_dump`

Use the **custom** format (`-Fc`): compressed, parallelizable, and restorable
selectively.

```bash
export DATABASE_URL="postgresql://postgres:$POSTGRES_PASSWORD@BACKEND_HOST:5432/postgres"

pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner --no-privileges \
  --file="gridwire-$(date +%F_%H%M).dump"
```

Or use the helper:

```bash
DATABASE_URL="postgresql://..." BACKUP_DIR=/var/backups/gridwire \
  ./deploy/scripts/backup.sh
```

The helper writes a timestamped `.dump`, verifies it is non-empty, prunes
backups older than `RETENTION_DAYS` (default 14), and exits non-zero on failure
so your scheduler alerts you.

**Verify a dump is valid without restoring it:**

```bash
pg_restore --list gridwire-2026-01-01_0300.dump >/dev/null && echo "dump OK"
```

---

## 3. Scheduled snapshots

Pick the option matching how you run Gridwire. Always store copies **off-host**
(object storage, another datacentre, or tape) and monitor that the job ran.

### 3.1 cron (VM / Docker Compose host)

```cron
# /etc/cron.d/gridwire-backup — nightly at 03:00
0 3 * * *  gridwire  DATABASE_URL="postgresql://postgres:PW@localhost:5432/postgres" BACKUP_DIR=/var/backups/gridwire /opt/gridwire/deploy/scripts/backup.sh >> /var/log/gridwire-backup.log 2>&1
```

### 3.2 systemd timer

See [`deploy/scripts/gridwire-backup.service`](./deploy/scripts/gridwire-backup.service)
and [`deploy/scripts/gridwire-backup.timer`](./deploy/scripts/gridwire-backup.timer):

```bash
sudo cp deploy/scripts/gridwire-backup.{service,timer} /etc/systemd/system/
sudo systemctl enable --now gridwire-backup.timer
systemctl list-timers gridwire-backup.timer
```

### 3.3 Kubernetes CronJob

[`deploy/kubernetes/backup-cronjob.yaml`](./deploy/kubernetes/backup-cronjob.yaml)
runs `pg_dump` nightly into a PVC (swap in your object-storage upload as needed):

```bash
kubectl -n gridwire apply -f deploy/kubernetes/backup-cronjob.yaml
kubectl -n gridwire get cronjob gridwire-backup
```

The CronJob reads `DATABASE_URL` from a Secret key `database-url`; create it:

```bash
kubectl -n gridwire create secret generic gridwire-backup \
  --from-literal=database-url='postgresql://postgres:PW@BACKEND_HOST:5432/postgres'
```

### 3.4 Point-in-time recovery (advanced)

For RPO measured in seconds rather than a day, enable **WAL archiving** on
Postgres (`archive_mode = on`, `archive_command = ...`) and take periodic base
backups with `pg_basebackup`. Logical `pg_dump` snapshots remain useful for
long-term retention and selective restores.

---

## 4. Restore with `pg_restore`

> Restoring is destructive to the target database. Practice on a scratch
> database first (§5).

```bash
export DATABASE_URL="postgresql://postgres:$POSTGRES_PASSWORD@BACKEND_HOST:5432/postgres"

# 1. Stop the portal + worker so nothing writes during restore.
docker compose stop portal worker      # or: kubectl -n gridwire scale deploy --all --replicas=0

# 2. Restore (clean drops existing objects first).
pg_restore \
  --clean --if-exists \
  --no-owner --no-privileges \
  --dbname="$DATABASE_URL" \
  gridwire-2026-01-01_0300.dump

# 3. Restore/confirm FIELD_ENCRYPTION_KEY is the SAME value as when the dump
#    was taken, then start services back up.
docker compose start portal worker     # or scale deployments back up
```

Helper:

```bash
DATABASE_URL="postgresql://..." ./deploy/scripts/restore.sh gridwire-2026-01-01_0300.dump
```

**After restore, verify:**

```bash
psql "$DATABASE_URL" -c "select count(*) from public.datasets;"
curl -fsS https://data.your-company.com/api/public/ready   # expect status: ready
```

---

## 5. Tested recovery drill (do this quarterly)

A backup you have never restored is not a backup. Run this end-to-end:

1. **Provision a scratch database** (empty Postgres, e.g. a throwaway container):
   ```bash
   docker run -d --name pg-drill -e POSTGRES_PASSWORD=drill -p 55432:5432 postgres:16
   ```
2. **Restore the latest dump into it:**
   ```bash
   DATABASE_URL="postgresql://postgres:drill@localhost:55432/postgres" \
     ./deploy/scripts/restore.sh /var/backups/gridwire/$(ls -t /var/backups/gridwire | head -1)
   ```
3. **Validate row counts and integrity** against production expectations:
   ```bash
   psql "postgresql://postgres:drill@localhost:55432/postgres" \
     -c "select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc limit 10;"
   ```
4. **Point a disposable portal at the scratch DB** and hit `/api/public/ready`
   and a known dataset endpoint to confirm the app boots and reads real data.
5. **Confirm encrypted fields decrypt** using the archived `FIELD_ENCRYPTION_KEY`
   (fetch a record with an `encrypt`-protected field via the API).
6. **Record** the drill date, dump timestamp, restore duration, and any issues.
   Tear down the scratch resources:
   ```bash
   docker rm -f pg-drill
   ```

**Recovery objectives to document for your org:**
- **RPO** (max acceptable data loss) → drives snapshot frequency (§3).
- **RTO** (max acceptable downtime) → measured by your drill in step 4.

---

## 6. Checklist

- [ ] Nightly `pg_dump` running and shipping copies off-host.
- [ ] Backups monitored — a failed/absent job raises an alert.
- [ ] `FIELD_ENCRYPTION_KEY` and other secrets backed up in a secrets manager,
      separately from the database dump.
- [ ] Retention policy set (`RETENTION_DAYS`) and old dumps pruned.
- [ ] Restore tested end-to-end within the last quarter, with the date recorded.
- [ ] RPO/RTO documented and met by current backup cadence.
