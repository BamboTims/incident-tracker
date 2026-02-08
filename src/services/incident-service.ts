import { Buffer } from 'node:buffer';

import { AppError } from '../errors/app-error.js';
import { assertAuthorized } from '../policies/authorization.js';
import type {
  CreateIncidentInput,
  CreateStatusUpdateInput,
  CreateTaskInput,
  CreateTimelineEventInput,
  Incident,
  IncidentRepository,
  IncidentStatus,
  IncidentTask,
  IncidentListCursor,
  StatusUpdate,
  TimelineEvent,
  UpdateIncidentInput,
  UpdateTaskInput
} from '../repositories/incident-repository.js';
import type { Membership, TenantRepository } from '../repositories/tenant-repository.js';

export interface IncidentServiceConfig {
  listDefaultLimit: number;
  listMaxLimit: number;
}

export interface IncidentListPage {
  incidents: Incident[];
  nextCursor: string | null;
}

const STATUS_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  declared: ['investigating', 'mitigating', 'monitoring', 'resolved'],
  investigating: ['mitigating', 'monitoring', 'resolved'],
  mitigating: ['monitoring', 'resolved'],
  monitoring: ['resolved'],
  resolved: ['closed'],
  closed: []
};

function membershipAuthContext(membership: Membership) {
  return {
    userId: membership.userId,
    tenantId: membership.tenantId,
    orgRoles: [membership.role] as const
  };
}

function parseCursor(cursor?: string): IncidentListCursor | undefined {
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

function encodeCursor(cursor: IncidentListCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id
    })
  ).toString('base64url');
}

function ensureAllowedStatusTransition(current: IncidentStatus, next: IncidentStatus): void {
  if (current === next) {
    return;
  }

  const allowed = STATUS_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw new AppError(400, 'INCIDENT_STATUS_TRANSITION_INVALID', `Cannot move incident from ${current} to ${next}.`);
  }
}

export class IncidentService {
  public constructor(
    private readonly incidentRepository: IncidentRepository,
    private readonly tenantRepository: TenantRepository,
    private readonly config: IncidentServiceConfig
  ) {}

  public async createIncident(userId: string, tenantId: string, input: Omit<CreateIncidentInput, 'userId' | 'tenantId'>): Promise<Incident> {
    const membership = await this.requireMembership(userId, tenantId);
    assertAuthorized('incidents.create', membershipAuthContext(membership));

    return this.incidentRepository.createIncident({
      ...input,
      userId,
      tenantId
    });
  }

  public async listIncidents(userId: string, tenantId: string, limit?: number, cursor?: string): Promise<IncidentListPage> {
    const membership = await this.requireMembership(userId, tenantId);
    assertAuthorized('incidents.read', membershipAuthContext(membership));

    const normalizedLimit = this.normalizeLimit(limit);
    const parsedCursor = parseCursor(cursor);

    if (cursor !== undefined && parsedCursor === undefined) {
      throw new AppError(400, 'PAGINATION_CURSOR_INVALID', 'Cursor is invalid.');
    }

    const incidents = await this.incidentRepository.listIncidents({
      tenantId,
      userId,
      limit: normalizedLimit,
      after: parsedCursor
    });

    const last = incidents.at(-1);

    return {
      incidents,
      nextCursor: incidents.length < normalizedLimit || last === undefined
        ? null
        : encodeCursor({
            createdAt: last.createdAt,
            id: last.id
          })
    };
  }

  public async getIncident(userId: string, tenantId: string, incidentId: string): Promise<Incident> {
    const membership = await this.requireMembership(userId, tenantId);

    const incident = await this.incidentRepository.findIncidentById({
      tenantId,
      userId,
      incidentId
    });

    if (incident === null) {
      throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Incident not found.');
    }

    assertAuthorized('incidents.read', membershipAuthContext(membership));
    return incident;
  }

  public async updateIncident(userId: string, tenantId: string, incidentId: string, input: Omit<UpdateIncidentInput, 'tenantId' | 'userId' | 'incidentId' | 'updatedAt'>): Promise<Incident> {
    const membership = await this.requireMembership(userId, tenantId);

    const currentIncident = await this.incidentRepository.findIncidentById({
      tenantId,
      userId,
      incidentId
    });

    if (currentIncident === null) {
      throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Incident not found.');
    }

    const authContext = membershipAuthContext(membership);

    if (input.status !== undefined) {
      ensureAllowedStatusTransition(currentIncident.status, input.status);

      if (input.status === 'resolved' || input.status === 'closed') {
        assertAuthorized('incidents.resolve', authContext);
      } else {
        assertAuthorized('incidents.update', authContext);
      }
    } else {
      assertAuthorized('incidents.update', authContext);
    }

    if (input.severity !== undefined) {
      assertAuthorized('incidents.change_severity', authContext);
    }

    const updated = await this.incidentRepository.updateIncident({
      ...input,
      tenantId,
      userId,
      incidentId,
      updatedAt: new Date()
    });

    if (updated === null) {
      throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Incident not found.');
    }

    return updated;
  }

  public async addTimelineEvent(userId: string, tenantId: string, incidentId: string, input: Omit<CreateTimelineEventInput, 'tenantId' | 'userId' | 'incidentId'>): Promise<TimelineEvent> {
    const membership = await this.requireMembership(userId, tenantId);
    const incident = await this.incidentRepository.findIncidentById({ tenantId, userId, incidentId });

    if (incident === null) {
      throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Incident not found.');
    }

    assertAuthorized('timeline.add_event', membershipAuthContext(membership));

    return this.incidentRepository.createTimelineEvent({
      ...input,
      tenantId,
      userId,
      incidentId
    });
  }

  public async listTimelineEvents(userId: string, tenantId: string, incidentId: string): Promise<TimelineEvent[]> {
    const membership = await this.requireMembership(userId, tenantId);
    const incident = await this.incidentRepository.findIncidentById({ tenantId, userId, incidentId });

    if (incident === null) {
      throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Incident not found.');
    }

    assertAuthorized('incidents.read', membershipAuthContext(membership));
    return this.incidentRepository.listTimelineEvents({ tenantId, userId, incidentId });
  }

  public async createTask(userId: string, tenantId: string, incidentId: string, input: Omit<CreateTaskInput, 'tenantId' | 'userId' | 'incidentId'>): Promise<IncidentTask> {
    const membership = await this.requireMembership(userId, tenantId);
    const incident = await this.incidentRepository.findIncidentById({ tenantId, userId, incidentId });

    if (incident === null) {
      throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Incident not found.');
    }

    assertAuthorized('tasks.create', membershipAuthContext(membership));

    return this.incidentRepository.createTask({
      ...input,
      tenantId,
      userId,
      incidentId
    });
  }

  public async updateTask(userId: string, tenantId: string, incidentId: string, taskId: string, input: Omit<UpdateTaskInput, 'tenantId' | 'userId' | 'incidentId' | 'taskId' | 'updatedAt'>): Promise<IncidentTask> {
    const membership = await this.requireMembership(userId, tenantId);
    const incident = await this.incidentRepository.findIncidentById({ tenantId, userId, incidentId });

    if (incident === null) {
      throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Incident not found.');
    }

    const existingTask = await this.incidentRepository.findTaskById({
      tenantId,
      userId,
      incidentId,
      taskId
    });

    if (existingTask === null) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found.');
    }

    assertAuthorized('tasks.assign', membershipAuthContext(membership));

    const updated = await this.incidentRepository.updateTask({
      ...input,
      tenantId,
      userId,
      incidentId,
      taskId,
      updatedAt: new Date()
    });

    if (updated === null) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found.');
    }

    return updated;
  }

  public async listTasks(userId: string, tenantId: string, incidentId: string): Promise<IncidentTask[]> {
    const membership = await this.requireMembership(userId, tenantId);
    const incident = await this.incidentRepository.findIncidentById({ tenantId, userId, incidentId });

    if (incident === null) {
      throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Incident not found.');
    }

    assertAuthorized('incidents.read', membershipAuthContext(membership));
    return this.incidentRepository.listTasks({ tenantId, userId, incidentId });
  }

  public async createStatusUpdate(userId: string, tenantId: string, incidentId: string, input: Omit<CreateStatusUpdateInput, 'tenantId' | 'userId' | 'incidentId'>): Promise<StatusUpdate> {
    const membership = await this.requireMembership(userId, tenantId);
    const incident = await this.incidentRepository.findIncidentById({ tenantId, userId, incidentId });

    if (incident === null) {
      throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Incident not found.');
    }

    if (input.audience === 'external') {
      assertAuthorized('updates.publish_external', membershipAuthContext(membership));
    } else {
      assertAuthorized('updates.publish_internal', membershipAuthContext(membership));
    }

    return this.incidentRepository.createStatusUpdate({
      ...input,
      tenantId,
      userId,
      incidentId
    });
  }

  public async listStatusUpdates(userId: string, tenantId: string, incidentId: string): Promise<StatusUpdate[]> {
    const membership = await this.requireMembership(userId, tenantId);
    const incident = await this.incidentRepository.findIncidentById({ tenantId, userId, incidentId });

    if (incident === null) {
      throw new AppError(404, 'INCIDENT_NOT_FOUND', 'Incident not found.');
    }

    assertAuthorized('incidents.read', membershipAuthContext(membership));
    return this.incidentRepository.listStatusUpdates({ tenantId, userId, incidentId });
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
