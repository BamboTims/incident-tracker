import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type {
  CreateIncidentInput,
  CreateStatusUpdateInput,
  CreateTaskInput,
  CreateTimelineEventInput,
  FindTaskInput,
  FindIncidentInput,
  Incident,
  IncidentRepository,
  IncidentTask,
  ListIncidentsInput,
  ListStatusUpdatesInput,
  ListTasksInput,
  ListTimelineEventsInput,
  StatusUpdate,
  TimelineEvent,
  UpdateIncidentInput,
  UpdateTaskInput
} from './incident-repository.js';

interface IncidentRow {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  severity: Incident['severity'];
  status: Incident['status'];
  start_time: Date;
  end_time: Date | null;
  declared_by_user_id: string;
  created_at: Date;
  updated_at: Date;
}

interface TimelineEventRow {
  id: string;
  tenant_id: string;
  incident_id: string;
  event_time: Date;
  event_type: string;
  message: string;
  created_by_user_id: string;
  created_at: Date;
}

interface TaskRow {
  id: string;
  tenant_id: string;
  incident_id: string;
  title: string;
  description: string;
  status: IncidentTask['status'];
  assignee_user_id: string | null;
  due_at: Date | null;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
}

interface StatusUpdateRow {
  id: string;
  tenant_id: string;
  incident_id: string;
  audience: StatusUpdate['audience'];
  message: string;
  created_by_user_id: string;
  published_at: Date;
  created_at: Date;
}

interface IncidentWithServicesRow extends IncidentRow {
  impacted_services: string[] | null;
}

function mapIncident(row: IncidentWithServicesRow): Incident {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    startTime: row.start_time,
    endTime: row.end_time,
    declaredByUserId: row.declared_by_user_id,
    impactedServices: row.impacted_services ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTimelineEvent(row: TimelineEventRow): TimelineEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    incidentId: row.incident_id,
    eventTime: row.event_time,
    eventType: row.event_type,
    message: row.message,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at
  };
}

function mapTask(row: TaskRow): IncidentTask {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    incidentId: row.incident_id,
    title: row.title,
    description: row.description,
    status: row.status,
    assigneeUserId: row.assignee_user_id,
    dueAt: row.due_at,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapStatusUpdate(row: StatusUpdateRow): StatusUpdate {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    incidentId: row.incident_id,
    audience: row.audience,
    message: row.message,
    createdByUserId: row.created_by_user_id,
    publishedAt: row.published_at,
    createdAt: row.created_at
  };
}

function getSingleRow<T>(rows: T[]): T | null {
  const [row] = rows;
  return row ?? null;
}

function uniqueServices(services: string[]): string[] {
  const values = services
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return Array.from(new Set(values));
}

async function withTransaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function setLocal(client: PoolClient, key: string, value: string): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', [key, value]);
}

async function setContext(client: PoolClient, tenantId: string, userId: string): Promise<void> {
  await setLocal(client, 'app.tenant_id', tenantId);
  await setLocal(client, 'app.user_id', userId);
}

async function replaceIncidentServices(
  client: PoolClient,
  incidentId: string,
  tenantId: string,
  services: string[]
): Promise<void> {
  await client.query(
    `
    DELETE FROM incident_services
    WHERE incident_id = $1 AND tenant_id = $2
    `,
    [incidentId, tenantId]
  );

  for (const serviceName of services) {
    await client.query(
      `
      INSERT INTO incident_services (id, tenant_id, incident_id, service_name, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      `,
      [randomUUID(), tenantId, incidentId, serviceName]
    );
  }
}

async function loadIncidentWithServices(client: PoolClient, incidentId: string, tenantId: string): Promise<Incident | null> {
  const result = await client.query<IncidentWithServicesRow>(
    `
    SELECT
      i.*,
      COALESCE(
        ARRAY_REMOVE(ARRAY_AGG(s.service_name ORDER BY s.service_name), NULL),
        ARRAY[]::TEXT[]
      ) AS impacted_services
    FROM incidents i
    LEFT JOIN incident_services s
      ON s.incident_id = i.id
      AND s.tenant_id = i.tenant_id
    WHERE i.id = $1
      AND i.tenant_id = $2
    GROUP BY i.id
    LIMIT 1
    `,
    [incidentId, tenantId]
  );

  const row = getSingleRow(result.rows);
  return row === null ? null : mapIncident(row);
}

async function loadTaskById(client: PoolClient, incidentId: string, taskId: string, tenantId: string): Promise<IncidentTask | null> {
  const result = await client.query<TaskRow>(
    `
    SELECT *
    FROM tasks
    WHERE id = $1
      AND incident_id = $2
      AND tenant_id = $3
    LIMIT 1
    `,
    [taskId, incidentId, tenantId]
  );

  const row = getSingleRow(result.rows);
  return row === null ? null : mapTask(row);
}

export class PostgresIncidentRepository implements IncidentRepository {
  public constructor(private readonly pool: Pool) {}

  public async createIncident(input: CreateIncidentInput): Promise<Incident> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const incidentId = randomUUID();
      const now = new Date();

      await client.query<IncidentRow>(
        `
        INSERT INTO incidents (
          id,
          tenant_id,
          title,
          description,
          severity,
          status,
          start_time,
          end_time,
          declared_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'declared', $6, NULL, $7, $8, $8)
        `,
        [
          incidentId,
          input.tenantId,
          input.title,
          input.description,
          input.severity,
          input.startTime,
          input.userId,
          now
        ]
      );

      await replaceIncidentServices(client, incidentId, input.tenantId, uniqueServices(input.impactedServices));
      const incident = await loadIncidentWithServices(client, incidentId, input.tenantId);

      if (incident === null) {
        throw new Error('Failed to create incident.');
      }

      return incident;
    });
  }

  public async listIncidents(input: ListIncidentsInput): Promise<Incident[]> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const parameters: Array<Date | string | number> = [input.limit + 1, input.tenantId];
      let whereClause = 'i.tenant_id = $2';

      if (input.after !== undefined) {
        parameters.push(input.after.createdAt);
        parameters.push(input.after.id);
        whereClause = `${whereClause} AND (i.created_at, i.id) < ($3::timestamptz, $4::uuid)`;
      }

      const result = await client.query<IncidentWithServicesRow>(
        `
        SELECT
          i.*,
          COALESCE(
            ARRAY_REMOVE(ARRAY_AGG(s.service_name ORDER BY s.service_name), NULL),
            ARRAY[]::TEXT[]
          ) AS impacted_services
        FROM incidents i
        LEFT JOIN incident_services s
          ON s.incident_id = i.id
          AND s.tenant_id = i.tenant_id
        WHERE ${whereClause}
        GROUP BY i.id
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT $1
        `,
        parameters
      );

      return result.rows.slice(0, input.limit).map(mapIncident);
    });
  }

  public async findIncidentById(input: FindIncidentInput): Promise<Incident | null> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);
      return loadIncidentWithServices(client, input.incidentId, input.tenantId);
    });
  }

  public async updateIncident(input: UpdateIncidentInput): Promise<Incident | null> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const currentIncident = await loadIncidentWithServices(client, input.incidentId, input.tenantId);
      if (currentIncident === null) {
        return null;
      }

      const nextTitle = input.title ?? currentIncident.title;
      const nextDescription = input.description ?? currentIncident.description;
      const nextSeverity = input.severity ?? currentIncident.severity;
      const nextStatus = input.status ?? currentIncident.status;
      const nextEndTime = input.endTime !== undefined ? input.endTime : currentIncident.endTime;

      await client.query(
        `
        UPDATE incidents
        SET title = $2,
            description = $3,
            severity = $4,
            status = $5,
            end_time = $6,
            updated_at = $7
        WHERE id = $1
          AND tenant_id = $8
        `,
        [
          input.incidentId,
          nextTitle,
          nextDescription,
          nextSeverity,
          nextStatus,
          nextEndTime,
          input.updatedAt,
          input.tenantId
        ]
      );

      if (input.impactedServices !== undefined) {
        await replaceIncidentServices(client, input.incidentId, input.tenantId, uniqueServices(input.impactedServices));
      }

      return loadIncidentWithServices(client, input.incidentId, input.tenantId);
    });
  }

  public async createTimelineEvent(input: CreateTimelineEventInput): Promise<TimelineEvent> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<TimelineEventRow>(
        `
        INSERT INTO timeline_events (
          id,
          tenant_id,
          incident_id,
          event_time,
          event_type,
          message,
          created_by_user_id,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING *
        `,
        [
          randomUUID(),
          input.tenantId,
          input.incidentId,
          input.eventTime,
          input.eventType,
          input.message,
          input.userId
        ]
      );

      const row = getSingleRow(result.rows);
      if (row === null) {
        throw new Error('Failed to create timeline event.');
      }

      return mapTimelineEvent(row);
    });
  }

  public async listTimelineEvents(input: ListTimelineEventsInput): Promise<TimelineEvent[]> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<TimelineEventRow>(
        `
        SELECT *
        FROM timeline_events
        WHERE incident_id = $1
          AND tenant_id = $2
        ORDER BY event_time ASC, id ASC
        `,
        [input.incidentId, input.tenantId]
      );

      return result.rows.map(mapTimelineEvent);
    });
  }

  public async createTask(input: CreateTaskInput): Promise<IncidentTask> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<TaskRow>(
        `
        INSERT INTO tasks (
          id,
          tenant_id,
          incident_id,
          title,
          description,
          status,
          assignee_user_id,
          due_at,
          created_by_user_id,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, NOW(), NOW())
        RETURNING *
        `,
        [
          randomUUID(),
          input.tenantId,
          input.incidentId,
          input.title,
          input.description,
          input.assigneeUserId,
          input.dueAt,
          input.userId
        ]
      );

      const row = getSingleRow(result.rows);
      if (row === null) {
        throw new Error('Failed to create task.');
      }

      return mapTask(row);
    });
  }

  public async findTaskById(input: FindTaskInput): Promise<IncidentTask | null> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);
      return loadTaskById(client, input.incidentId, input.taskId, input.tenantId);
    });
  }

  public async updateTask(input: UpdateTaskInput): Promise<IncidentTask | null> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const existing = await loadTaskById(client, input.incidentId, input.taskId, input.tenantId);
      if (existing === null) {
        return null;
      }

      const nextTitle = input.title ?? existing.title;
      const nextDescription = input.description ?? existing.description;
      const nextStatus = input.status ?? existing.status;
      const nextAssignee = input.assigneeUserId !== undefined ? input.assigneeUserId : existing.assigneeUserId;
      const nextDueAt = input.dueAt !== undefined ? input.dueAt : existing.dueAt;

      const result = await client.query<TaskRow>(
        `
        UPDATE tasks
        SET title = $2,
            description = $3,
            status = $4,
            assignee_user_id = $5,
            due_at = $6,
            updated_at = $7
        WHERE id = $1
          AND incident_id = $8
          AND tenant_id = $9
        RETURNING *
        `,
        [
          input.taskId,
          nextTitle,
          nextDescription,
          nextStatus,
          nextAssignee,
          nextDueAt,
          input.updatedAt,
          input.incidentId,
          input.tenantId
        ]
      );

      const row = getSingleRow(result.rows);
      return row === null ? null : mapTask(row);
    });
  }

  public async listTasks(input: ListTasksInput): Promise<IncidentTask[]> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<TaskRow>(
        `
        SELECT *
        FROM tasks
        WHERE incident_id = $1
          AND tenant_id = $2
        ORDER BY created_at DESC, id DESC
        `,
        [input.incidentId, input.tenantId]
      );

      return result.rows.map(mapTask);
    });
  }

  public async createStatusUpdate(input: CreateStatusUpdateInput): Promise<StatusUpdate> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<StatusUpdateRow>(
        `
        INSERT INTO status_updates (
          id,
          tenant_id,
          incident_id,
          audience,
          message,
          created_by_user_id,
          published_at,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING *
        `,
        [
          randomUUID(),
          input.tenantId,
          input.incidentId,
          input.audience,
          input.message,
          input.userId,
          input.publishedAt
        ]
      );

      const row = getSingleRow(result.rows);
      if (row === null) {
        throw new Error('Failed to create status update.');
      }

      return mapStatusUpdate(row);
    });
  }

  public async listStatusUpdates(input: ListStatusUpdatesInput): Promise<StatusUpdate[]> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<StatusUpdateRow>(
        `
        SELECT *
        FROM status_updates
        WHERE incident_id = $1
          AND tenant_id = $2
        ORDER BY published_at DESC, id DESC
        `,
        [input.incidentId, input.tenantId]
      );

      return result.rows.map(mapStatusUpdate);
    });
  }
}
