import { randomUUID } from 'node:crypto';

import type {
  AuditLogEvent,
  AuditLogRepository,
  CreateAuditLogEventInput,
  ListAuditLogEventsInput
} from './audit-log-repository.js';

function cloneEvent(event: AuditLogEvent): AuditLogEvent {
  return {
    ...event,
    metadata: { ...event.metadata },
    createdAt: new Date(event.createdAt)
  };
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly events: AuditLogEvent[] = [];

  public createEvent(input: CreateAuditLogEventInput): Promise<AuditLogEvent> {
    const event: AuditLogEvent = {
      id: randomUUID(),
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
      traceId: input.traceId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      createdAt: new Date()
    };

    this.events.push(event);
    return Promise.resolve(cloneEvent(event));
  }

  public listEvents(): AuditLogEvent[];
  public listEvents(input: ListAuditLogEventsInput): Promise<AuditLogEvent[]>;
  public listEvents(input?: ListAuditLogEventsInput): AuditLogEvent[] | Promise<AuditLogEvent[]> {
    if (input === undefined) {
      return this.events.map(cloneEvent);
    }

    return Promise.resolve(this.listEventsForTenant(input));
  }

  private listEventsForTenant(input: ListAuditLogEventsInput): AuditLogEvent[] {
    const sorted = this.events
      .filter((event) => event.tenantId === input.tenantId)
      .sort((left, right) => {
        if (left.createdAt.getTime() !== right.createdAt.getTime()) {
          return right.createdAt.getTime() - left.createdAt.getTime();
        }

        return right.id.localeCompare(left.id);
      });

    const filtered = input.after === undefined
      ? sorted
      : sorted.filter((event) => {
          if (event.createdAt.getTime() < input.after!.createdAt.getTime()) {
            return true;
          }

          if (event.createdAt.getTime() > input.after!.createdAt.getTime()) {
            return false;
          }

          return event.id.localeCompare(input.after!.id) < 0;
        });

    return filtered.slice(0, input.limit).map(cloneEvent);
  }
}
