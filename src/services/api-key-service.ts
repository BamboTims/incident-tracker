import { createHash, randomBytes } from 'node:crypto';

import { API_KEY_SCOPES, type ApiKeyScope } from '../auth/auth-context.js';
import { AppError } from '../errors/app-error.js';
import { assertAuthorized } from '../policies/authorization.js';
import type { ApiKeyAuthRecord, ApiKeyRecord, ApiKeyRepository, ServiceAccount } from '../repositories/api-key-repository.js';
import type { Membership, TenantRepository } from '../repositories/tenant-repository.js';

const API_KEY_PREFIX = 'itk_';

export interface CreateApiKeyResult {
  apiKey: ApiKeyRecord;
  secret: string;
}

export interface AuthenticatedApiKeyPrincipal {
  apiKeyId: string;
  tenantId: string;
  userId: string;
  scopes: ApiKeyScope[];
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function membershipAuthContext(membership: Membership) {
  return {
    userId: membership.userId,
    tenantId: membership.tenantId,
    orgRoles: [membership.role] as const
  };
}

function normalizeScopes(scopes: readonly ApiKeyScope[]): ApiKeyScope[] {
  const values: ApiKeyScope[] = scopes.length === 0 ? ['read'] : [...scopes];
  const unique = Array.from(new Set(values));
  return unique;
}

function ensureValidScopeSet(scopes: readonly ApiKeyScope[]): void {
  for (const scope of scopes) {
    if (!API_KEY_SCOPES.includes(scope)) {
      throw new AppError(400, 'API_KEY_SCOPE_INVALID', 'One or more API key scopes are invalid.');
    }
  }
}

function redactApiKey(rawKey: string): string {
  return `${rawKey.slice(0, 8)}...${rawKey.slice(-4)}`;
}

export class ApiKeyService {
  public constructor(
    private readonly apiKeyRepository: ApiKeyRepository,
    private readonly tenantRepository: TenantRepository
  ) {}

  public async createServiceAccount(
    userId: string,
    tenantId: string,
    name: string,
    ownerUserId?: string
  ): Promise<ServiceAccount> {
    const membership = await this.requireMembership(userId, tenantId);
    assertAuthorized('api_keys.manage', membershipAuthContext(membership));

    const normalizedName = name.trim();
    if (normalizedName.length < 3) {
      throw new AppError(400, 'SERVICE_ACCOUNT_NAME_INVALID', 'Service account name must be at least 3 characters long.');
    }

    const ownerId = ownerUserId ?? userId;
    const ownerMembership = await this.tenantRepository.getMembership(tenantId, ownerId);
    if (ownerMembership === null) {
      throw new AppError(400, 'SERVICE_ACCOUNT_OWNER_INVALID', 'Service account owner must be a tenant member.');
    }

    return this.apiKeyRepository.createServiceAccount({
      tenantId,
      name: normalizedName,
      ownerUserId: ownerId,
      createdByUserId: userId
    });
  }

  public async listServiceAccounts(userId: string, tenantId: string): Promise<ServiceAccount[]> {
    const membership = await this.requireMembership(userId, tenantId);
    assertAuthorized('api_keys.manage', membershipAuthContext(membership));
    return this.apiKeyRepository.listServiceAccounts({ tenantId, userId });
  }

  public async createApiKey(
    userId: string,
    tenantId: string,
    serviceAccountId: string,
    name: string,
    scopes: readonly ApiKeyScope[]
  ): Promise<CreateApiKeyResult> {
    const membership = await this.requireMembership(userId, tenantId);
    assertAuthorized('api_keys.manage', membershipAuthContext(membership));

    const serviceAccount = await this.apiKeyRepository.findServiceAccountById({
      tenantId,
      userId,
      serviceAccountId
    });

    if (serviceAccount === null) {
      throw new AppError(404, 'SERVICE_ACCOUNT_NOT_FOUND', 'Service account not found.');
    }

    const normalizedName = name.trim();
    if (normalizedName.length < 3) {
      throw new AppError(400, 'API_KEY_NAME_INVALID', 'API key name must be at least 3 characters long.');
    }

    ensureValidScopeSet(scopes);

    const secretPart = randomBytes(32).toString('base64url');
    const rawKey = `${API_KEY_PREFIX}${secretPart}`;
    const normalizedScopes = normalizeScopes(scopes);

    const apiKey = await this.apiKeyRepository.createApiKey({
      tenantId,
      userId,
      serviceAccountId: serviceAccount.id,
      name: normalizedName,
      keyPrefix: rawKey.slice(0, 16),
      keyHash: hashKey(rawKey),
      scopes: normalizedScopes
    });

    return {
      apiKey,
      secret: rawKey
    };
  }

  public async listApiKeys(userId: string, tenantId: string): Promise<ApiKeyRecord[]> {
    const membership = await this.requireMembership(userId, tenantId);
    assertAuthorized('api_keys.manage', membershipAuthContext(membership));
    return this.apiKeyRepository.listApiKeys({ tenantId, userId });
  }

  public async revokeApiKey(userId: string, tenantId: string, apiKeyId: string): Promise<ApiKeyRecord> {
    const membership = await this.requireMembership(userId, tenantId);
    assertAuthorized('api_keys.manage', membershipAuthContext(membership));

    const record = await this.apiKeyRepository.revokeApiKey({
      tenantId,
      userId,
      apiKeyId,
      revokedAt: new Date()
    });

    if (record === null) {
      throw new AppError(404, 'API_KEY_NOT_FOUND', 'API key not found.');
    }

    return record;
  }

  public async authenticateApiKey(rawKey: string): Promise<AuthenticatedApiKeyPrincipal | null> {
    if (!rawKey.startsWith(API_KEY_PREFIX)) {
      return null;
    }

    const keyHash = hashKey(rawKey);
    const authRecord = await this.apiKeyRepository.findActiveApiKeyByHash({ keyHash });
    if (authRecord === null) {
      return null;
    }

    const ownerMembership = await this.tenantRepository.getMembership(
      authRecord.apiKey.tenantId,
      authRecord.serviceAccount.ownerUserId
    );

    if (ownerMembership === null) {
      return null;
    }

    await this.apiKeyRepository.markApiKeyUsed({
      tenantId: authRecord.apiKey.tenantId,
      userId: authRecord.serviceAccount.ownerUserId,
      apiKeyId: authRecord.apiKey.id,
      usedAt: new Date()
    });

    return {
      apiKeyId: authRecord.apiKey.id,
      tenantId: authRecord.apiKey.tenantId,
      userId: authRecord.serviceAccount.ownerUserId,
      scopes: authRecord.apiKey.scopes
    };
  }

  public redactSecret(secret: string): string {
    return redactApiKey(secret);
  }

  private async requireMembership(userId: string, tenantId: string): Promise<Membership> {
    const membership = await this.tenantRepository.getMembership(tenantId, userId);
    if (membership === null) {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
    }

    return membership;
  }

  public static isApiKeyScope(value: string): value is ApiKeyScope {
    return API_KEY_SCOPES.includes(value as ApiKeyScope);
  }

  public static mapAuthRecord(record: ApiKeyAuthRecord): AuthenticatedApiKeyPrincipal {
    return {
      apiKeyId: record.apiKey.id,
      tenantId: record.apiKey.tenantId,
      userId: record.serviceAccount.ownerUserId,
      scopes: record.apiKey.scopes
    };
  }
}
