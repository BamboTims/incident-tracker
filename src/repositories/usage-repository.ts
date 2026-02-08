export interface TenantUsageQuota {
  tenantId: string;
  dailyWriteLimit: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsageEvent {
  id: string;
  tenantId: string;
  actorUserId: string | null;
  apiKeyId: string | null;
  metric: string;
  amount: number;
  route: string;
  traceId: string | null;
  createdAt: Date;
}

export interface UpsertTenantQuotaInput {
  tenantId: string;
  userId: string;
  dailyWriteLimit: number;
}

export interface GetTenantQuotaInput {
  tenantId: string;
  userId: string;
}

export interface ListUsageSinceInput {
  tenantId: string;
  userId: string;
  metric: string;
  since: Date;
}

export interface CreateUsageEventInput {
  tenantId: string;
  userId: string;
  actorUserId: string | null;
  apiKeyId: string | null;
  metric: string;
  amount: number;
  route: string;
  traceId: string | null;
  createdAt: Date;
}

export interface UsageRepository {
  upsertTenantQuota(input: UpsertTenantQuotaInput): Promise<TenantUsageQuota>;
  getTenantQuota(input: GetTenantQuotaInput): Promise<TenantUsageQuota | null>;
  sumUsageSince(input: ListUsageSinceInput): Promise<number>;
  createUsageEvent(input: CreateUsageEventInput): Promise<UsageEvent>;
}
