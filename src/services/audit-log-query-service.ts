import { Buffer } from 'node:buffer';

import { AppError } from '../errors/app-error.js';
import { assertAuthorized } from '../policies/authorization.js';
import type { AuditLogEvent, AuditLogListCursor, AuditLogRepository } from '../repositories/audit-log-repository.js';
import type { Membership, TenantRepository } from '../repositories/tenant-repository.js';

export interface AuditLogQueryServiceConfig {
  listDefaultLimit: number;
  listMaxLimit: number;
}

export interface AuditLogListPage {
  events: AuditLogEvent[];
  nextCursor: string | null;
}

function membershipAuthContext(membership: Membership) {
  return {
    userId: membership.userId,
    tenantId: membership.tenantId,
    orgRoles: [membership.role] as const
  };
}

function parseCursor(cursor?: string): AuditLogListCursor | undefined {
  if (cursor === undefined || cursor.length === 0) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as { createdAt: string; id: string };

    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') {
      return undefined;
    }

    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      return undefined;
    }

    return {
      createdAt,
      id: parsed.id
    };
  } catch {
    return undefined;
  }
}

function encodeCursor(cursor: AuditLogListCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id
    })
  ).toString('base64url');
}

export class AuditLogQueryService {
  public constructor(
    private readonly auditLogRepository: AuditLogRepository,
    private readonly tenantRepository: TenantRepository,
    private readonly config: AuditLogQueryServiceConfig
  ) {}

  public async listEvents(userId: string, tenantId: string, limit?: number, cursor?: string): Promise<AuditLogListPage> {
    const membership = await this.requireMembership(userId, tenantId);
    assertAuthorized('audit_log.read', membershipAuthContext(membership));

    const normalizedLimit = this.normalizeLimit(limit);
    const parsedCursor = parseCursor(cursor);

    if (cursor !== undefined && parsedCursor === undefined) {
      throw new AppError(400, 'PAGINATION_CURSOR_INVALID', 'Cursor is invalid.');
    }

    const events = await this.auditLogRepository.listEvents({
      tenantId,
      userId,
      limit: normalizedLimit,
      after: parsedCursor
    });

    const last = events.at(-1);

    return {
      events,
      nextCursor: events.length < normalizedLimit || last === undefined
        ? null
        : encodeCursor({
            createdAt: last.createdAt,
            id: last.id
          })
    };
  }

  private normalizeLimit(limit?: number): number {
    if (limit === undefined) {
      return this.config.listDefaultLimit;
    }

    if (!Number.isInteger(limit) || limit <= 0) {
      throw new AppError(400, 'PAGINATION_LIMIT_INVALID', 'Limit must be a positive integer.');
    }

    return Math.min(limit, this.config.listMaxLimit);
  }

  private async requireMembership(userId: string, tenantId: string): Promise<Membership> {
    const membership = await this.tenantRepository.getMembership(tenantId, userId);
    if (membership === null) {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
    }

    return membership;
  }
}
