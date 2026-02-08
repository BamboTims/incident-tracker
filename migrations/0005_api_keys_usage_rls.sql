CREATE TABLE IF NOT EXISTS service_accounts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES users(id),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, tenant_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  service_account_id UUID NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_api_keys_service_account
    FOREIGN KEY (service_account_id, tenant_id)
    REFERENCES service_accounts(id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT api_keys_scope_set_valid
    CHECK (
      cardinality(scopes) > 0
      AND scopes <@ ARRAY['read', 'write']::TEXT[]
    )
);

CREATE TABLE IF NOT EXISTS tenant_usage_quotas (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  daily_write_limit INTEGER NOT NULL CHECK (daily_write_limit > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  metric TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  route TEXT NOT NULL,
  trace_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_accounts_tenant_created_at
  ON service_accounts(tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_created_at
  ON api_keys(tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_service_account
  ON api_keys(service_account_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_last_used_at
  ON api_keys(last_used_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_metric_created_at
  ON usage_events(tenant_id, metric, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_usage_quotas_tenant_id
  ON tenant_usage_quotas(tenant_id);

ALTER TABLE service_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage_quotas FORCE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_accounts_select ON service_accounts;
DROP POLICY IF EXISTS service_accounts_write ON service_accounts;
DROP POLICY IF EXISTS api_keys_select ON api_keys;
DROP POLICY IF EXISTS api_keys_write ON api_keys;
DROP POLICY IF EXISTS tenant_usage_quotas_select ON tenant_usage_quotas;
DROP POLICY IF EXISTS tenant_usage_quotas_write ON tenant_usage_quotas;
DROP POLICY IF EXISTS usage_events_select ON usage_events;
DROP POLICY IF EXISTS usage_events_write ON usage_events;

CREATE POLICY service_accounts_select ON service_accounts
FOR SELECT
USING (tenant_id = app.current_tenant_id());

CREATE POLICY service_accounts_write ON service_accounts
FOR ALL
USING (tenant_id = app.current_tenant_id())
WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY api_keys_select ON api_keys
FOR SELECT
USING (
  tenant_id = app.current_tenant_id()
  OR key_hash = NULLIF(current_setting('app.api_key_hash', true), '')
);

CREATE POLICY api_keys_write ON api_keys
FOR ALL
USING (tenant_id = app.current_tenant_id())
WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_usage_quotas_select ON tenant_usage_quotas
FOR SELECT
USING (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_usage_quotas_write ON tenant_usage_quotas
FOR ALL
USING (tenant_id = app.current_tenant_id())
WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY usage_events_select ON usage_events
FOR SELECT
USING (tenant_id = app.current_tenant_id());

CREATE POLICY usage_events_write ON usage_events
FOR ALL
USING (tenant_id = app.current_tenant_id())
WITH CHECK (tenant_id = app.current_tenant_id());
