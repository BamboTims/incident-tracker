import { AppError } from '../errors/app-error.js';
import { assertAuthorized } from '../policies/authorization.js';
import type { TenantRepository } from '../repositories/tenant-repository.js';
import type { UsageRepository } from '../repositories/usage-repository.js';

const WRITE_REQUEST_METRIC = 'api.write_requests';
const QUOTA_WINDOW_HOURS = 24;

export interface UsageServiceConfig {
  defaultDailyWriteLimit: number;
}

export interface UsageSummary {
  tenantId: string;
  metric: string;
  windowHours: number;
  used: number;
  limit: number;
  remaining: number;
}

export interface ConsumeWriteQuotaInput {
  userId: string;
  tenantId: string;
  actorUserId: string | null;
  apiKeyId: string | null;
  route: string;
  traceId: string | null;
}

export class UsageService {
  public constructor(
    private readonly usageRepository: UsageRepository,
    private readonly tenantRepository: TenantRepository,
    private readonly config: UsageServiceConfig
  ) {}

  public async consumeWriteQuota(input: ConsumeWriteQuotaInput): Promise<UsageSummary> {
    const quota = await this.ensureQuota(input.tenantId, input.userId);
    const windowStart = new Date(Date.now() - QUOTA_WINDOW_HOURS * 60 * 60 * 1_000);
    const used = await this.usageRepository.sumUsageSince({
      tenantId: input.tenantId,
      userId: input.userId,
      metric: WRITE_REQUEST_METRIC,
      since: windowStart
    });

    if (used + 1 > quota.dailyWriteLimit) {
      throw new AppError(429, 'QUOTA_EXCEEDED', 'Tenant write quota exceeded.', {
        tenantId: input.tenantId,
        metric: WRITE_REQUEST_METRIC,
        limit: quota.dailyWriteLimit,
        used
      });
    }

    await this.usageRepository.createUsageEvent({
      tenantId: input.tenantId,
      userId: input.userId,
      actorUserId: input.actorUserId,
      apiKeyId: input.apiKeyId,
      metric: WRITE_REQUEST_METRIC,
      amount: 1,
      route: input.route,
      traceId: input.traceId,
      createdAt: new Date()
    });

    const nextUsed = used + 1;
    return {
      tenantId: input.tenantId,
      metric: WRITE_REQUEST_METRIC,
      windowHours: QUOTA_WINDOW_HOURS,
      used: nextUsed,
      limit: quota.dailyWriteLimit,
      remaining: Math.max(quota.dailyWriteLimit - nextUsed, 0)
    };
  }

  public async getUsageSummary(userId: string, tenantId: string): Promise<UsageSummary> {
    const membership = await this.tenantRepository.getMembership(tenantId, userId);
    if (membership === null) {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
    }

    assertAuthorized('billing.read', {
      userId,
      tenantId,
      orgRoles: [membership.role] as const
    });

    const quota = await this.ensureQuota(tenantId, userId);
    const windowStart = new Date(Date.now() - QUOTA_WINDOW_HOURS * 60 * 60 * 1_000);
    const used = await this.usageRepository.sumUsageSince({
      tenantId,
      userId,
      metric: WRITE_REQUEST_METRIC,
      since: windowStart
    });

    return {
      tenantId,
      metric: WRITE_REQUEST_METRIC,
      windowHours: QUOTA_WINDOW_HOURS,
      used,
      limit: quota.dailyWriteLimit,
      remaining: Math.max(quota.dailyWriteLimit - used, 0)
    };
  }

  private async ensureQuota(tenantId: string, userId: string) {
    const existing = await this.usageRepository.getTenantQuota({ tenantId, userId });
    if (existing !== null) {
      return existing;
    }

    return this.usageRepository.upsertTenantQuota({
      tenantId,
      userId,
      dailyWriteLimit: this.config.defaultDailyWriteLimit
    });
  }
}
