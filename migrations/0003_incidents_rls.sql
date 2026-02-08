DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_severity') THEN
    CREATE TYPE incident_severity AS ENUM ('SEV1', 'SEV2', 'SEV3', 'SEV4');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_status') THEN
    CREATE TYPE incident_status AS ENUM (
      'declared',
      'investigating',
      'mitigating',
      'monitoring',
      'resolved',
      'closed'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE task_status AS ENUM ('open', 'in_progress', 'completed');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_update_audience') THEN
    CREATE TYPE status_update_audience AS ENUM ('internal', 'external');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  severity incident_severity NOT NULL,
  status incident_status NOT NULL DEFAULT 'declared',
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  declared_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT incidents_start_before_end CHECK (end_time IS NULL OR end_time >= start_time),
  UNIQUE (id, tenant_id)
);

CREATE TABLE IF NOT EXISTS incident_services (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  incident_id UUID NOT NULL,
  service_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (incident_id, service_name),
  CONSTRAINT fk_incident_services_incident
    FOREIGN KEY (incident_id, tenant_id)
    REFERENCES incidents(id, tenant_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  incident_id UUID NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_timeline_events_incident
    FOREIGN KEY (incident_id, tenant_id)
    REFERENCES incidents(id, tenant_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  incident_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status task_status NOT NULL DEFAULT 'open',
  assignee_user_id UUID REFERENCES users(id),
  due_at TIMESTAMPTZ,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_tasks_incident
    FOREIGN KEY (incident_id, tenant_id)
    REFERENCES incidents(id, tenant_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS status_updates (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  incident_id UUID NOT NULL,
  audience status_update_audience NOT NULL,
  message TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_status_updates_incident
    FOREIGN KEY (incident_id, tenant_id)
    REFERENCES incidents(id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_created_at ON incidents(tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_status ON incidents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_incident_services_incident ON incident_services(incident_id);
CREATE INDEX IF NOT EXISTS idx_timeline_events_incident_time ON timeline_events(incident_id, event_time ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_incident_created_at ON tasks(incident_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_updates_incident_published_at ON status_updates(incident_id, published_at DESC, id DESC);

ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE incident_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_services FORCE ROW LEVEL SECURITY;
ALTER TABLE timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_events FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE status_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_updates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS incidents_select ON incidents;
DROP POLICY IF EXISTS incidents_write ON incidents;
DROP POLICY IF EXISTS incident_services_select ON incident_services;
DROP POLICY IF EXISTS incident_services_write ON incident_services;
DROP POLICY IF EXISTS timeline_events_select ON timeline_events;
DROP POLICY IF EXISTS timeline_events_write ON timeline_events;
DROP POLICY IF EXISTS tasks_select ON tasks;
DROP POLICY IF EXISTS tasks_write ON tasks;
DROP POLICY IF EXISTS status_updates_select ON status_updates;
DROP POLICY IF EXISTS status_updates_write ON status_updates;

CREATE POLICY incidents_select ON incidents
FOR SELECT
USING (tenant_id = app.current_tenant_id());

CREATE POLICY incidents_write ON incidents
FOR ALL
USING (tenant_id = app.current_tenant_id())
WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY incident_services_select ON incident_services
FOR SELECT
USING (tenant_id = app.current_tenant_id());

CREATE POLICY incident_services_write ON incident_services
FOR ALL
USING (tenant_id = app.current_tenant_id())
WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY timeline_events_select ON timeline_events
FOR SELECT
USING (tenant_id = app.current_tenant_id());

CREATE POLICY timeline_events_write ON timeline_events
FOR ALL
USING (tenant_id = app.current_tenant_id())
WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tasks_select ON tasks
FOR SELECT
USING (tenant_id = app.current_tenant_id());

CREATE POLICY tasks_write ON tasks
FOR ALL
USING (tenant_id = app.current_tenant_id())
WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY status_updates_select ON status_updates
FOR SELECT
USING (tenant_id = app.current_tenant_id());

CREATE POLICY status_updates_write ON status_updates
FOR ALL
USING (tenant_id = app.current_tenant_id())
WITH CHECK (tenant_id = app.current_tenant_id());