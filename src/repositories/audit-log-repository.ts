export interface AuditLogEvent {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  traceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface AuditLogListCursor {
  createdAt: Date;
  id: string;
}

export interface ListAuditLogEventsInput {
  tenantId: string;
  userId: string;
  limit: number;
  after?: AuditLogListCursor;
}

export interface CreateAuditLogEventInput {
  tenantId: string | null;
  actorUserId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  traceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditLogRepository {
  createEvent(input: CreateAuditLogEventInput): Promise<AuditLogEvent>;
  listEvents(input: ListAuditLogEventsInput): Promise<AuditLogEvent[]>;
}
