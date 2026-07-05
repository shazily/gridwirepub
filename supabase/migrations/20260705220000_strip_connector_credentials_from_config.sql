-- Remove credential fields accidentally stored in connectors.config before SFTP_SECRETS enforcement.
-- Operators must migrate values into the worker SFTP_SECRETS env (see docs/connector-credentials-migration.md).

UPDATE public.connectors
SET config = config
  - 'password'
  - 'privateKey'
  - 'private_key'
  - 'pass'
  - 'secret'
  - 'token'
  - 'apiKey'
  - 'api_key'
  - 'credentials'
WHERE config ?| ARRAY[
  'password',
  'privateKey',
  'private_key',
  'pass',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'credentials'
];
