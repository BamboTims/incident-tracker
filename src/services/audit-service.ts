import type { Request } from 'express';

import type { AuditLogRepository, CreateAuditLogEventInput } from '../repositories/audit-log-repository.js';

export type AuditEventInput = CreateAuditLogEventInput;

function normalizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (metadata === undefined) {
    return {};
  }

  const normalizedEntries = Object.entries(metadata).filter(([, value]) => value !== undefined);
  return Object.fromEntries(normalizedEntries);
}

export function getAuditRequestContext(request: Request): {
  traceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
} {
  const traceId = typeof request.res?.locals.traceId === 'string'
    ? request.res.locals.traceId
    : null;

  const ipAddress = typeof request.ip === 'string' && request.ip.length > 0
    ? request.ip
    : null;

  const userAgent = request.header('user-agent');

  return {
    traceId,
    ipAddress,
    userAgent: typeof userAgent === 'string' && userAgent.length > 0 ? userAgent : null
  };
}

export class AuditService {
  public constructor(private readonly repository: AuditLogRepository) {}

  public async record(event: AuditEventInput): Promise<void> {
    await this.repository.createEvent({
      ...event,
      metadata: normalizeMetadata(event.metadata)
    });
  }

  public async recordSafely(event: AuditEventInput): Promise<void> {
    try {
      await this.record(event);
    } catch (error) {
      console.error('audit_log_write_failed', {
        action: event.action,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  }
}
