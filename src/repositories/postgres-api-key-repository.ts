import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type { ApiKeyScope } from '../auth/auth-context.js';
import type {
  ApiKeyAuthRecord,
  ApiKeyRecord,
  ApiKeyRepository,
  CreateApiKeyInput,
  CreateServiceAccountInput,
  FindApiKeyByHashInput,
  FindServiceAccountInput,
  ListApiKeysInput,
  ListServiceAccountsInput,
  MarkApiKeyUsedInput,
  RevokeApiKeyInput,
  ServiceAccount
} from './api-key-repository.js';

interface ServiceAccountRow {
  id: string;
  tenant_id: string;
  name: string;
  owner_user_id: string;
  created_by_user_id: string;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ApiKeyRow {
  id: string;
  tenant_id: string;
  service_account_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: ApiKeyScope[];
  created_by_user_id: string;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

function mapServiceAccount(row: ServiceAccountRow): ServiceAccount {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    createdByUserId: row.created_by_user_id,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapApiKey(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    serviceAccountId: row.service_account_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    createdByUserId: row.created_by_user_id,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at
  };
}

function mapApiKeyAuth(apiKey: ApiKeyRow, serviceAccount: ServiceAccountRow): ApiKeyAuthRecord {
  return {
    apiKey: mapApiKey(apiKey),
    serviceAccount: {
      id: serviceAccount.id,
      tenantId: serviceAccount.tenant_id,
      name: serviceAccount.name,
      ownerUserId: serviceAccount.owner_user_id,
      createdByUserId: serviceAccount.created_by_user_id,
      revokedAt: serviceAccount.revoked_at,
      createdAt: serviceAccount.created_at,
      updatedAt: serviceAccount.updated_at
    }
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

export class PostgresApiKeyRepository implements ApiKeyRepository {
  public constructor(private readonly pool: Pool) {}

  public async createServiceAccount(input: CreateServiceAccountInput): Promise<ServiceAccount> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.createdByUserId);

      const result = await client.query<ServiceAccountRow>(
        `
        INSERT INTO service_accounts (
          id,
          tenant_id,
          name,
          owner_user_id,
          created_by_user_id,
          revoked_at,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, NULL, NOW(), NOW())
        RETURNING *
        `,
        [randomUUID(), input.tenantId, input.name, input.ownerUserId, input.createdByUserId]
      );

      const row = getSingleRow(result.rows);
      if (row === null) {
        throw new Error('Failed to create service account.');
      }

      return mapServiceAccount(row);
    });
  }

  public async listServiceAccounts(input: ListServiceAccountsInput): Promise<ServiceAccount[]> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<ServiceAccountRow>(
        `
        SELECT *
        FROM service_accounts
        WHERE revoked_at IS NULL
        ORDER BY created_at DESC, id DESC
        `
      );

      return result.rows.map(mapServiceAccount);
    });
  }

  public async findServiceAccountById(input: FindServiceAccountInput): Promise<ServiceAccount | null> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<ServiceAccountRow>(
        `
        SELECT *
        FROM service_accounts
        WHERE id = $1
          AND revoked_at IS NULL
        LIMIT 1
        `,
        [input.serviceAccountId]
      );

      const row = getSingleRow(result.rows);
      return row === null ? null : mapServiceAccount(row);
    });
  }

  public async createApiKey(input: CreateApiKeyInput): Promise<ApiKeyRecord> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<ApiKeyRow>(
        `
        INSERT INTO api_keys (
          id,
          tenant_id,
          service_account_id,
          name,
          key_prefix,
          key_hash,
          scopes,
          created_by_user_id,
          last_used_at,
          revoked_at,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, NULL, NULL, NOW())
        RETURNING *
        `,
        [
          randomUUID(),
          input.tenantId,
          input.serviceAccountId,
          input.name,
          input.keyPrefix,
          input.keyHash,
          input.scopes,
          input.userId
        ]
      );

      const row = getSingleRow(result.rows);
      if (row === null) {
        throw new Error('Failed to create API key.');
      }

      return mapApiKey(row);
    });
  }

  public async listApiKeys(input: ListApiKeysInput): Promise<ApiKeyRecord[]> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<ApiKeyRow>(
        `
        SELECT *
        FROM api_keys
        ORDER BY created_at DESC, id DESC
        `
      );

      return result.rows.map(mapApiKey);
    });
  }

  public async revokeApiKey(input: RevokeApiKeyInput): Promise<ApiKeyRecord | null> {
    return withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);

      const result = await client.query<ApiKeyRow>(
        `
        UPDATE api_keys
        SET revoked_at = COALESCE(revoked_at, $2)
        WHERE id = $1
        RETURNING *
        `,
        [input.apiKeyId, input.revokedAt]
      );

      const row = getSingleRow(result.rows);
      return row === null ? null : mapApiKey(row);
    });
  }

  public async findActiveApiKeyByHash(input: FindApiKeyByHashInput): Promise<ApiKeyAuthRecord | null> {
    return withTransaction(this.pool, async (client) => {
      await setLocal(client, 'app.api_key_hash', input.keyHash);

      const apiKeyResult = await client.query<ApiKeyRow>(
        `
        SELECT *
        FROM api_keys
        WHERE key_hash = $1
          AND revoked_at IS NULL
        LIMIT 1
        `,
        [input.keyHash]
      );

      const apiKeyRow = getSingleRow(apiKeyResult.rows);
      if (apiKeyRow === null) {
        return null;
      }

      await setContext(client, apiKeyRow.tenant_id, apiKeyRow.created_by_user_id);

      const serviceAccountResult = await client.query<ServiceAccountRow>(
        `
        SELECT *
        FROM service_accounts
        WHERE id = $1
          AND revoked_at IS NULL
        LIMIT 1
        `,
        [apiKeyRow.service_account_id]
      );

      const serviceAccountRow = getSingleRow(serviceAccountResult.rows);
      if (serviceAccountRow === null) {
        return null;
      }

      return mapApiKeyAuth(apiKeyRow, serviceAccountRow);
    });
  }

  public async markApiKeyUsed(input: MarkApiKeyUsedInput): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await setContext(client, input.tenantId, input.userId);
      await client.query(
        `
        UPDATE api_keys
        SET last_used_at = $2
        WHERE id = $1
        `,
        [input.apiKeyId, input.usedAt]
      );
    });
  }
}
