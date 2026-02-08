import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type {
  CreateUsageEventInput,
  GetTenantQuotaInput,
  ListUsageSinceInput,
  TenantUsageQuota,
  UpsertTenantQuotaInput,
  UsageEvent,
  UsageRepository
} from './usage-repository.js';

interface TenantUsageQuotaRow {
  tenant_id: string;
  daily_write_limit: number;
  created_at: Date;
  updated_at: Date;
}

interface UsageEventRow {
  id: string;
  tenant_id: string;
  actor_user_id: string | null;
  api_key_id: string | null;
  metric: string;
  amount: number;
  route: string;
  trace_id: string | null;
  created_at: Date;
}

function mapQuota(row: TenantUsageQuotaRow): TenantUsageQuota {
  return {
    tenantId: row.tenant_id,
    dailyWriteLimit: row.daily_write_limit,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapUsageEvent(row: UsageEventRow): UsageEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorUserId: row.actor_user_id,
    apiKeyId: row.api_key_id,
    metric: row.metric,
    amount: row.amount,
    route: row.route,
    traceId: row.trace_id,
    createdAt: row.created_at
  };
}

function getSingleRow<T>(rows: T[]): T | null {
  const [row] = rows;
  return row ?? null;
}

async function setLocal(client: PoolClient, key: string, value: string): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', [key, value]);
}

async function setContext(client: PoolClient, tenantId: string, userId: string): Promise<void> {
  await setLocal(client, 'app.tenant_id', tenantId);
  await setLocal(client, 'app.user_id', userId);
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

export class PostgresUsageRepository implements UsageRepository {
  public constructor(private readonly pool: Pool) {}

  public async upsertTenantQuota(input: UpsertTenantQuotaInput): Promise<TenantUsageQuota> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<TenantUsageQuotaRow>(
        `
        INSERT INTO tenant_usage_quotas (
          tenant_id,
          daily_write_limit,
          created_at,
          updated_at
        )
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (tenant_id)
        DO UPDATE SET
          daily_write_limit = EXCLUDED.daily_write_limit,
          updated_at = NOW()
        RETURNING *
        `,
        [input.tenantId, input.dailyWriteLimit]
      );

      const row = getSingleRow(result.rows);
      if (row === null) {
        throw new Error('Failed to upsert tenant usage quota.');
      }

      return mapQuota(row);
    });
  }

  public async getTenantQuota(input: GetTenantQuotaInput): Promise<TenantUsageQuota | null> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<TenantUsageQuotaRow>(
        `
        SELECT *
        FROM tenant_usage_quotas
        WHERE tenant_id = $1
        LIMIT 1
        `,
        [input.tenantId]
      );

      const row = getSingleRow(result.rows);
      return row === null ? null : mapQuota(row);
    });
  }

  public async sumUsageSince(input: ListUsageSinceInput): Promise<number> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<{ total: string | null }>(
        `
        SELECT COALESCE(SUM(amount), 0)::TEXT AS total
        FROM usage_events
        WHERE metric = $1
          AND created_at >= $2
        `,
        [input.metric, input.since]
      );

      const row = getSingleRow(result.rows);
      if (row === null || row.total === null) {
        return 0;
      }

      return Number.parseInt(row.total, 10);
    });
  }

  public async createUsageEvent(input: CreateUsageEventInput): Promise<UsageEvent> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<UsageEventRow>(
        `
        INSERT INTO usage_events (
          id,
          tenant_id,
          actor_user_id,
          api_key_id,
          metric,
          amount,
          route,
          trace_id,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
        `,
        [
          randomUUID(),
          input.tenantId,
          input.actorUserId,
          input.apiKeyId,
          input.metric,
          input.amount,
          input.route,
          input.traceId,
          input.createdAt
        ]
      );

      const row = getSingleRow(result.rows);
      if (row === null) {
        throw new Error('Failed to create usage event.');
      }

      return mapUsageEvent(row);
    });
  }
}
