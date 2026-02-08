import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type {
  AuditLogEvent,
  AuditLogRepository,
  CreateAuditLogEventInput,
  ListAuditLogEventsInput
} from './audit-log-repository.js';

interface AuditLogRow {
  id: string;
  tenant_id: string | null;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  trace_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

function mapAuditLogRow(row: AuditLogRow): AuditLogEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata,
    traceId: row.trace_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at
  };
}

export class PostgresAuditLogRepository implements AuditLogRepository {
  public constructor(private readonly pool: Pool) {}

  public async createEvent(input: CreateAuditLogEventInput): Promise<AuditLogEvent> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await setContext(client, input.tenantId, input.actorUserId);

      const result = await client.query<AuditLogRow>(
        `
        INSERT INTO audit_log_events (
          id,
          tenant_id,
          actor_user_id,
          action,
          target_type,
          target_id,
          metadata,
          trace_id,
          ip_address,
          user_agent,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, NOW())
        RETURNING *
        `,
        [
          randomUUID(),
          input.tenantId,
          input.actorUserId,
          input.action,
          input.targetType ?? null,
          input.targetId ?? null,
          JSON.stringify(input.metadata ?? {}),
          input.traceId ?? null,
          input.ipAddress ?? null,
          input.userAgent ?? null
        ]
      );

      await client.query('COMMIT');

      const [row] = result.rows;
      if (row === undefined) {
        throw new Error('Failed to create audit log event.');
      }

      return mapAuditLogRow(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async listEvents(input: ListAuditLogEventsInput): Promise<AuditLogEvent[]> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await setContext(client, input.tenantId, input.userId);

      const parameters: Array<Date | number | string> = [input.limit + 1, input.tenantId];
      let whereClause = 'tenant_id = $2';

      if (input.after !== undefined) {
        parameters.push(input.after.createdAt);
        parameters.push(input.after.id);
        whereClause = `${whereClause} AND (created_at, id) < ($3::timestamptz, $4::uuid)`;
      }

      const result = await client.query<AuditLogRow>(
        `
        SELECT *
        FROM audit_log_events
        WHERE ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT $1
        `,
        parameters
      );

      await client.query('COMMIT');
      return result.rows.slice(0, input.limit).map(mapAuditLogRow);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function setLocal(client: PoolClient, key: string, value: string): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', [key, value]);
}

async function setContext(client: PoolClient, tenantId: string | null, userId: string | null): Promise<void> {
  await setLocal(client, 'app.tenant_id', tenantId ?? '');
  await setLocal(client, 'app.user_id', userId ?? '');
}
