# Connector credential migration

Gridwire **never stores SFTP passwords or private keys** in `connectors.config`. The companion worker reads credentials from its `SFTP_SECRETS` environment variable only.

## If you previously stored credentials in the database

1. **Apply the migration** (strips credential keys from JSONB):

   ```powershell
   .\scripts\deploy.ps1 migrate
   ```

   Migration: `20260705220000_strip_connector_credentials_from_config.sql`

2. **Before migrating**, export any passwords from existing rows if you no longer have them elsewhere:

   ```sql
   SELECT id, name, config->>'password' AS password_hint
   FROM public.connectors
   WHERE config ? 'password' OR config ? 'privateKey';
   ```

3. **Add each connector** to the worker `SFTP_SECRETS` JSON in `.env` or your secrets manager:

   ```json
   {
     "<connector-uuid>": {
       "password": "your-sftp-password"
     }
   }
   ```

   Or with a private key:

   ```json
   {
     "<connector-uuid>": {
       "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
     }
   }
   ```

4. **Restart the worker** after updating `SFTP_SECRETS`.

5. **Queue a Test** from Admin → Connectors to confirm connectivity.

## Finding connector IDs

Admin → Connectors lists each connector; the ID is shown in the SFTP secrets dialog after creating a new connector, or query:

```sql
SELECT id, name, type FROM public.connectors WHERE org_id = '<your-org-id>';
```

## Internal SFTP hosts (on-prem only)

By default the worker blocks connections to private IP ranges (SSRF protection). For legitimate internal SFTP servers, set on the **worker**:

```env
ALLOW_INTERNAL_CONNECTOR_HOSTS=true
```

Do not enable this on internet-exposed worker deployments unless every connector host is trusted.
