import { randomUUID } from 'node:crypto';

import type {
  CreateUsageEventInput,
  GetTenantQuotaInput,
  ListUsageSinceInput,
  TenantUsageQuota,
  UpsertTenantQuotaInput,
  UsageEvent,
  UsageRepository
} from './usage-repository.js';

function cloneQuota(quota: TenantUsageQuota): TenantUsageQuota {
  return {
    ...quota,
    createdAt: new Date(quota.createdAt),
    updatedAt: new Date(quota.updatedAt)
  };
}

function cloneUsageEvent(event: UsageEvent): UsageEvent {
  return {
    ...event,
    createdAt: new Date(event.createdAt)
  };
}

export class InMemoryUsageRepository implements UsageRepository {
  private readonly quotasByTenantId = new Map<string, TenantUsageQuota>();

  private readonly usageEvents: UsageEvent[] = [];

  public upsertTenantQuota(input: UpsertTenantQuotaInput): Promise<TenantUsageQuota> {
    const existing = this.quotasByTenantId.get(input.tenantId);
    const now = new Date();

    const quota: TenantUsageQuota = existing === undefined
      ? {
          tenantId: input.tenantId,
          dailyWriteLimit: input.dailyWriteLimit,
          createdAt: now,
          updatedAt: now
        }
      : {
          ...existing,
          dailyWriteLimit: input.dailyWriteLimit,
          updatedAt: now
        };

    this.quotasByTenantId.set(input.tenantId, quota);
    return Promise.resolve(cloneQuota(quota));
  }

  public getTenantQuota(input: GetTenantQuotaInput): Promise<TenantUsageQuota | null> {
    const quota = this.quotasByTenantId.get(input.tenantId);
    return Promise.resolve(quota === undefined ? null : cloneQuota(quota));
  }

  public sumUsageSince(input: ListUsageSinceInput): Promise<number> {
    const sum = this.usageEvents
      .filter((event) => (
        event.tenantId === input.tenantId
        && event.metric === input.metric
        && event.createdAt.getTime() >= input.since.getTime()
      ))
      .reduce((accumulator, event) => accumulator + event.amount, 0);

    return Promise.resolve(sum);
  }

  public createUsageEvent(input: CreateUsageEventInput): Promise<UsageEvent> {
    const event: UsageEvent = {
      id: randomUUID(),
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      apiKeyId: input.apiKeyId,
      metric: input.metric,
      amount: input.amount,
      route: input.route,
      traceId: input.traceId,
      createdAt: new Date(input.createdAt)
    };

    this.usageEvents.push(event);
    return Promise.resolve(cloneUsageEvent(event));
  }
}
