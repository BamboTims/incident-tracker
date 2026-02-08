CREATE TABLE IF NOT EXISTS audit_log_events (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  trace_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_events_tenant_created_at
  ON audit_log_events(tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_events_actor_created_at
  ON audit_log_events(actor_user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_events_action_created_at
  ON audit_log_events(action, created_at DESC, id DESC);

ALTER TABLE audit_log_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_events_select ON audit_log_events;
DROP POLICY IF EXISTS audit_log_events_insert ON audit_log_events;

CREATE POLICY audit_log_events_select ON audit_log_events
FOR SELECT
USING (tenant_id = app.current_tenant_id());

CREATE POLICY audit_log_events_insert ON audit_log_events
FOR INSERT
WITH CHECK (tenant_id IS NULL OR tenant_id = app.current_tenant_id());
