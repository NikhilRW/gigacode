-- Up Migration

CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  max_concurrent int NOT NULL DEFAULT 4,
  max_exec_per_min int NOT NULL DEFAULT 60,
  max_timeout_ms int NOT NULL DEFAULT 10000,
  max_memory_mb int NOT NULL DEFAULT 512,
  max_source_bytes int NOT NULL DEFAULT 1048576
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'member', 'platform_admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_tenant_idx ON users (tenant_id);

CREATE TABLE api_keys (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL UNIQUE,
  key_hash text NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_tenant_idx ON api_keys (tenant_id, created_at DESC);

CREATE TABLE executions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  idempotency_key text,
  request_hash text NOT NULL,
  language text NOT NULL,
  entry_file text NOT NULL,
  status text NOT NULL CHECK (status IN ('CREATED','QUEUED','DISPATCHED','STARTING','RUNNING','SUCCESS','FAILED','TIMEOUT','CANCELLED','DEAD_LETTERED')),
  priority int NOT NULL DEFAULT 0,
  limits jsonb NOT NULL,
  artifact_prefix text NOT NULL,
  attempt int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  available_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  exit_code int,
  term_signal text,
  failure_reason text,
  wall_ms int,
  cpu_ms bigint,
  peak_memory_bytes bigint,
  stdout_truncated boolean NOT NULL DEFAULT false,
  stderr_truncated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX executions_queue_idx ON executions (status, priority DESC, available_at, created_at) WHERE status = 'QUEUED';
CREATE INDEX executions_tenant_created_idx ON executions (tenant_id, created_at DESC, id DESC);
CREATE INDEX executions_lease_idx ON executions (lease_expires_at) WHERE status IN ('DISPATCHED', 'STARTING', 'RUNNING');
CREATE UNIQUE INDEX executions_idempotency_idx ON executions (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX executions_finished_idx ON executions (finished_at) WHERE finished_at IS NOT NULL;

CREATE TABLE execution_attempts (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  attempt int NOT NULL,
  worker_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text,
  exit_code int,
  result_prefix text,
  UNIQUE (execution_id, attempt)
);

CREATE TABLE execution_events (
  id bigserial PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  attempt int NOT NULL DEFAULT 0,
  from_status text,
  to_status text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  detail jsonb
);
CREATE INDEX execution_events_exec_idx ON execution_events (execution_id, id);

CREATE TABLE workers (
  id text PRIMARY KEY,
  hostname text NOT NULL,
  version text NOT NULL,
  slots int NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_concurrency (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  running int NOT NULL DEFAULT 0,
  last_dispatched_at timestamptz NOT NULL DEFAULT 'epoch'
);

-- Down Migration
DROP TABLE tenant_concurrency, workers, execution_events, execution_attempts, executions, api_keys, users, tenants;
