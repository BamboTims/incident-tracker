import { randomUUID } from 'node:crypto';

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

function cloneServiceAccount(record: ServiceAccount): ServiceAccount {
  return {
    ...record,
    revokedAt: record.revokedAt === null ? null : new Date(record.revokedAt),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt)
  };
}

function cloneApiKey(record: ApiKeyRecord): ApiKeyRecord {
  return {
    ...record,
    scopes: [...record.scopes],
    lastUsedAt: record.lastUsedAt === null ? null : new Date(record.lastUsedAt),
    revokedAt: record.revokedAt === null ? null : new Date(record.revokedAt),
    createdAt: new Date(record.createdAt)
  };
}

interface ApiKeyInternalRecord extends ApiKeyRecord {
  keyHash: string;
}

export class InMemoryApiKeyRepository implements ApiKeyRepository {
  private readonly serviceAccountsById = new Map<string, ServiceAccount>();

  private readonly apiKeysById = new Map<string, ApiKeyInternalRecord>();

  private readonly apiKeyIdsByHash = new Map<string, string>();

  public createServiceAccount(input: CreateServiceAccountInput): Promise<ServiceAccount> {
    const now = new Date();
    const record: ServiceAccount = {
      id: randomUUID(),
      tenantId: input.tenantId,
      name: input.name,
      ownerUserId: input.ownerUserId,
      createdByUserId: input.createdByUserId,
      revokedAt: null,
      createdAt: now,
      updatedAt: now
    };

    this.serviceAccountsById.set(record.id, record);
    return Promise.resolve(cloneServiceAccount(record));
  }

  public listServiceAccounts(input: ListServiceAccountsInput): Promise<ServiceAccount[]> {
    const records = Array.from(this.serviceAccountsById.values())
      .filter((record) => record.tenantId === input.tenantId && record.revokedAt === null)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map(cloneServiceAccount);

    return Promise.resolve(records);
  }

  public findServiceAccountById(input: FindServiceAccountInput): Promise<ServiceAccount | null> {
    const record = this.serviceAccountsById.get(input.serviceAccountId);

    if (record === undefined || record.tenantId !== input.tenantId || record.revokedAt !== null) {
      return Promise.resolve(null);
    }

    return Promise.resolve(cloneServiceAccount(record));
  }

  public createApiKey(input: CreateApiKeyInput): Promise<ApiKeyRecord> {
    const now = new Date();
    const record: ApiKeyInternalRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      serviceAccountId: input.serviceAccountId,
      name: input.name,
      keyPrefix: input.keyPrefix,
      keyHash: input.keyHash,
      scopes: uniqueScopes(input.scopes),
      createdByUserId: input.userId,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now
    };

    this.apiKeysById.set(record.id, record);
    this.apiKeyIdsByHash.set(record.keyHash, record.id);
    return Promise.resolve(cloneApiKey(record));
  }

  public listApiKeys(input: ListApiKeysInput): Promise<ApiKeyRecord[]> {
    const records = Array.from(this.apiKeysById.values())
      .filter((record) => record.tenantId === input.tenantId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map(cloneApiKey);

    return Promise.resolve(records);
  }

  public revokeApiKey(input: RevokeApiKeyInput): Promise<ApiKeyRecord | null> {
    const record = this.apiKeysById.get(input.apiKeyId);
    if (record === undefined || record.tenantId !== input.tenantId) {
      return Promise.resolve(null);
    }

    if (record.revokedAt === null) {
      record.revokedAt = new Date(input.revokedAt);
      this.apiKeysById.set(record.id, record);
    }

    return Promise.resolve(cloneApiKey(record));
  }

  public findActiveApiKeyByHash(input: FindApiKeyByHashInput): Promise<ApiKeyAuthRecord | null> {
    const apiKeyId = this.apiKeyIdsByHash.get(input.keyHash);
    if (apiKeyId === undefined) {
      return Promise.resolve(null);
    }

    const apiKey = this.apiKeysById.get(apiKeyId);
    if (apiKey === undefined || apiKey.revokedAt !== null) {
      return Promise.resolve(null);
    }

    const serviceAccount = this.serviceAccountsById.get(apiKey.serviceAccountId);
    if (serviceAccount === undefined || serviceAccount.revokedAt !== null) {
      return Promise.resolve(null);
    }

    return Promise.resolve({
      apiKey: cloneApiKey(apiKey),
      serviceAccount: cloneServiceAccount(serviceAccount)
    });
  }

  public markApiKeyUsed(input: MarkApiKeyUsedInput): Promise<void> {
    const record = this.apiKeysById.get(input.apiKeyId);
    if (record === undefined) {
      return Promise.resolve();
    }

    record.lastUsedAt = new Date(input.usedAt);
    this.apiKeysById.set(record.id, record);
    return Promise.resolve();
  }
}

function uniqueScopes(scopes: readonly ApiKeyScope[]): ApiKeyScope[] {
  const set = new Set<ApiKeyScope>();
  for (const scope of scopes) {
    set.add(scope);
  }

  return Array.from(set);
}
