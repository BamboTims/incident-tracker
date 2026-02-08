import type { ApiKeyScope } from '../auth/auth-context.js';

export interface ServiceAccount {
  id: string;
  tenantId: string;
  name: string;
  ownerUserId: string;
  createdByUserId: string;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  serviceAccountId: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  createdByUserId: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface ApiKeyAuthRecord {
  apiKey: ApiKeyRecord;
  serviceAccount: ServiceAccount;
}

export interface CreateServiceAccountInput {
  tenantId: string;
  name: string;
  ownerUserId: string;
  createdByUserId: string;
}

export interface ListServiceAccountsInput {
  tenantId: string;
  userId: string;
}

export interface FindServiceAccountInput {
  tenantId: string;
  userId: string;
  serviceAccountId: string;
}

export interface CreateApiKeyInput {
  tenantId: string;
  userId: string;
  serviceAccountId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: ApiKeyScope[];
}

export interface ListApiKeysInput {
  tenantId: string;
  userId: string;
}

export interface RevokeApiKeyInput {
  tenantId: string;
  userId: string;
  apiKeyId: string;
  revokedAt: Date;
}

export interface FindApiKeyByHashInput {
  keyHash: string;
}

export interface MarkApiKeyUsedInput {
  tenantId: string;
  userId: string;
  apiKeyId: string;
  usedAt: Date;
}

export interface ApiKeyRepository {
  createServiceAccount(input: CreateServiceAccountInput): Promise<ServiceAccount>;
  listServiceAccounts(input: ListServiceAccountsInput): Promise<ServiceAccount[]>;
  findServiceAccountById(input: FindServiceAccountInput): Promise<ServiceAccount | null>;

  createApiKey(input: CreateApiKeyInput): Promise<ApiKeyRecord>;
  listApiKeys(input: ListApiKeysInput): Promise<ApiKeyRecord[]>;
  revokeApiKey(input: RevokeApiKeyInput): Promise<ApiKeyRecord | null>;
  findActiveApiKeyByHash(input: FindApiKeyByHashInput): Promise<ApiKeyAuthRecord | null>;
  markApiKeyUsed(input: MarkApiKeyUsedInput): Promise<void>;
}
