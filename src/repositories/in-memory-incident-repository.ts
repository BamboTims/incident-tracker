import { randomUUID } from 'node:crypto';

import type {
  CreateIncidentInput,
  CreateStatusUpdateInput,
  CreateTaskInput,
  CreateTimelineEventInput,
  FindTaskInput,
  FindIncidentInput,
  Incident,
  IncidentListCursor,
  IncidentRepository,
  IncidentTask,
  ListIncidentsInput,
  ListStatusUpdatesInput,
  ListTasksInput,
  ListTimelineEventsInput,
  StatusUpdate,
  TimelineEvent,
  UpdateIncidentInput,
  UpdateTaskInput
} from './incident-repository.js';

interface IncidentRecord {
  incident: Incident;
  services: string[];
}

function uniqueServices(services: string[]): string[] {
  const values = services
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return Array.from(new Set(values));
}

function cloneIncident(incident: Incident): Incident {
  return {
    ...incident,
    startTime: new Date(incident.startTime),
    endTime: incident.endTime === null ? null : new Date(incident.endTime),
    impactedServices: [...incident.impactedServices],
    createdAt: new Date(incident.createdAt),
    updatedAt: new Date(incident.updatedAt)
  };
}

function cloneTimelineEvent(event: TimelineEvent): TimelineEvent {
  return {
    ...event,
    eventTime: new Date(event.eventTime),
    createdAt: new Date(event.createdAt)
  };
}

function cloneTask(task: IncidentTask): IncidentTask {
  return {
    ...task,
    dueAt: task.dueAt === null ? null : new Date(task.dueAt),
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt)
  };
}

function cloneStatusUpdate(update: StatusUpdate): StatusUpdate {
  return {
    ...update,
    publishedAt: new Date(update.publishedAt),
    createdAt: new Date(update.createdAt)
  };
}

function compareDescending(left: Incident, right: Incident): number {
  if (left.createdAt.getTime() !== right.createdAt.getTime()) {
    return right.createdAt.getTime() - left.createdAt.getTime();
  }

  return right.id.localeCompare(left.id);
}

function isAfterCursor(incident: Incident, cursor: IncidentListCursor): boolean {
  if (incident.createdAt.getTime() < cursor.createdAt.getTime()) {
    return true;
  }

  if (incident.createdAt.getTime() > cursor.createdAt.getTime()) {
    return false;
  }

  return incident.id.localeCompare(cursor.id) < 0;
}

export class InMemoryIncidentRepository implements IncidentRepository {
  private readonly incidentsById = new Map<string, IncidentRecord>();

  private readonly timelineByIncidentId = new Map<string, TimelineEvent[]>();

  private readonly tasksByIncidentId = new Map<string, IncidentTask[]>();

  private readonly statusUpdatesByIncidentId = new Map<string, StatusUpdate[]>();

  public createIncident(input: CreateIncidentInput): Promise<Incident> {
    const now = new Date();
    const incident: Incident = {
      id: randomUUID(),
      tenantId: input.tenantId,
      title: input.title,
      description: input.description,
      severity: input.severity,
      status: 'declared',
      startTime: new Date(input.startTime),
      endTime: null,
      declaredByUserId: input.userId,
      impactedServices: uniqueServices(input.impactedServices),
      createdAt: now,
      updatedAt: now
    };

    this.incidentsById.set(incident.id, {
      incident,
      services: [...incident.impactedServices]
    });

    return Promise.resolve(cloneIncident(incident));
  }

  public listIncidents(input: ListIncidentsInput): Promise<Incident[]> {
    const values = Array.from(this.incidentsById.values())
      .map((record) => record.incident)
      .filter((incident) => incident.tenantId === input.tenantId)
      .sort(compareDescending)
      .filter((incident) => {
        if (input.after === undefined) {
          return true;
        }

        return isAfterCursor(incident, input.after);
      })
      .slice(0, input.limit)
      .map(cloneIncident);

    return Promise.resolve(values);
  }

  public findIncidentById(input: FindIncidentInput): Promise<Incident | null> {
    const record = this.incidentsById.get(input.incidentId);
    if (record === undefined || record.incident.tenantId !== input.tenantId) {
      return Promise.resolve(null);
    }

    return Promise.resolve(cloneIncident(record.incident));
  }

  public updateIncident(input: UpdateIncidentInput): Promise<Incident | null> {
    const record = this.incidentsById.get(input.incidentId);
    if (record === undefined || record.incident.tenantId !== input.tenantId) {
      return Promise.resolve(null);
    }

    if (input.title !== undefined) {
      record.incident.title = input.title;
    }

    if (input.description !== undefined) {
      record.incident.description = input.description;
    }

    if (input.severity !== undefined) {
      record.incident.severity = input.severity;
    }

    if (input.status !== undefined) {
      record.incident.status = input.status;
    }

    if (input.endTime !== undefined) {
      record.incident.endTime = input.endTime;
    }

    if (input.impactedServices !== undefined) {
      const services = uniqueServices(input.impactedServices);
      record.services = services;
      record.incident.impactedServices = services;
    }

    record.incident.updatedAt = new Date(input.updatedAt);
    this.incidentsById.set(record.incident.id, record);

    return Promise.resolve(cloneIncident(record.incident));
  }

  public createTimelineEvent(input: CreateTimelineEventInput): Promise<TimelineEvent> {
    const event: TimelineEvent = {
      id: randomUUID(),
      tenantId: input.tenantId,
      incidentId: input.incidentId,
      eventTime: new Date(input.eventTime),
      eventType: input.eventType,
      message: input.message,
      createdByUserId: input.userId,
      createdAt: new Date()
    };

    const existing = this.timelineByIncidentId.get(input.incidentId) ?? [];
    existing.push(event);
    existing.sort((left, right) => {
      if (left.eventTime.getTime() !== right.eventTime.getTime()) {
        return left.eventTime.getTime() - right.eventTime.getTime();
      }

      return left.id.localeCompare(right.id);
    });

    this.timelineByIncidentId.set(input.incidentId, existing);
    return Promise.resolve(cloneTimelineEvent(event));
  }

  public listTimelineEvents(input: ListTimelineEventsInput): Promise<TimelineEvent[]> {
    const values = this.timelineByIncidentId.get(input.incidentId) ?? [];
    return Promise.resolve(values.filter((event) => event.tenantId === input.tenantId).map(cloneTimelineEvent));
  }

  public createTask(input: CreateTaskInput): Promise<IncidentTask> {
    const now = new Date();
    const task: IncidentTask = {
      id: randomUUID(),
      tenantId: input.tenantId,
      incidentId: input.incidentId,
      title: input.title,
      description: input.description,
      status: 'open',
      assigneeUserId: input.assigneeUserId,
      dueAt: input.dueAt,
      createdByUserId: input.userId,
      createdAt: now,
      updatedAt: now
    };

    const existing = this.tasksByIncidentId.get(input.incidentId) ?? [];
    existing.push(task);
    existing.sort((left, right) => {
      if (left.createdAt.getTime() !== right.createdAt.getTime()) {
        return right.createdAt.getTime() - left.createdAt.getTime();
      }

      return right.id.localeCompare(left.id);
    });

    this.tasksByIncidentId.set(input.incidentId, existing);
    return Promise.resolve(cloneTask(task));
  }

  public findTaskById(input: FindTaskInput): Promise<IncidentTask | null> {
    const tasks = this.tasksByIncidentId.get(input.incidentId) ?? [];
    const task = tasks.find((item) => item.id === input.taskId && item.tenantId === input.tenantId);
    return Promise.resolve(task === undefined ? null : cloneTask(task));
  }

  public updateTask(input: UpdateTaskInput): Promise<IncidentTask | null> {
    const tasks = this.tasksByIncidentId.get(input.incidentId) ?? [];
    const index = tasks.findIndex((task) => task.id === input.taskId && task.tenantId === input.tenantId);
    if (index < 0) {
      return Promise.resolve(null);
    }

    const task = tasks[index];
    if (task === undefined) {
      return Promise.resolve(null);
    }

    if (input.title !== undefined) {
      task.title = input.title;
    }

    if (input.description !== undefined) {
      task.description = input.description;
    }

    if (input.status !== undefined) {
      task.status = input.status;
    }

    if (input.assigneeUserId !== undefined) {
      task.assigneeUserId = input.assigneeUserId;
    }

    if (input.dueAt !== undefined) {
      task.dueAt = input.dueAt;
    }

    task.updatedAt = new Date(input.updatedAt);
    tasks[index] = task;
    this.tasksByIncidentId.set(input.incidentId, tasks);

    return Promise.resolve(cloneTask(task));
  }

  public listTasks(input: ListTasksInput): Promise<IncidentTask[]> {
    const tasks = this.tasksByIncidentId.get(input.incidentId) ?? [];
    return Promise.resolve(tasks.filter((task) => task.tenantId === input.tenantId).map(cloneTask));
  }

  public createStatusUpdate(input: CreateStatusUpdateInput): Promise<StatusUpdate> {
    const statusUpdate: StatusUpdate = {
      id: randomUUID(),
      tenantId: input.tenantId,
      incidentId: input.incidentId,
      audience: input.audience,
      message: input.message,
      createdByUserId: input.userId,
      publishedAt: new Date(input.publishedAt),
      createdAt: new Date()
    };

    const updates = this.statusUpdatesByIncidentId.get(input.incidentId) ?? [];
    updates.push(statusUpdate);
    updates.sort((left, right) => {
      if (left.publishedAt.getTime() !== right.publishedAt.getTime()) {
        return right.publishedAt.getTime() - left.publishedAt.getTime();
      }

      return right.id.localeCompare(left.id);
    });

    this.statusUpdatesByIncidentId.set(input.incidentId, updates);
    return Promise.resolve(cloneStatusUpdate(statusUpdate));
  }

  public listStatusUpdates(input: ListStatusUpdatesInput): Promise<StatusUpdate[]> {
    const values = this.statusUpdatesByIncidentId.get(input.incidentId) ?? [];
    return Promise.resolve(values.filter((update) => update.tenantId === input.tenantId).map(cloneStatusUpdate));
  }
}
