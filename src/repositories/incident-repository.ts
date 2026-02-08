export const INCIDENT_SEVERITIES = ['SEV1', 'SEV2', 'SEV3', 'SEV4'] as const;
export const INCIDENT_STATUSES = [
  'declared',
  'investigating',
  'mitigating',
  'monitoring',
  'resolved',
  'closed'
] as const;
export const TASK_STATUSES = ['open', 'in_progress', 'completed'] as const;
export const STATUS_UPDATE_AUDIENCES = ['internal', 'external'] as const;

export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type StatusUpdateAudience = (typeof STATUS_UPDATE_AUDIENCES)[number];

export interface Incident {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  startTime: Date;
  endTime: Date | null;
  declaredByUserId: string;
  impactedServices: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IncidentListCursor {
  createdAt: Date;
  id: string;
}

export interface CreateIncidentInput {
  tenantId: string;
  userId: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  startTime: Date;
  impactedServices: string[];
}

export interface ListIncidentsInput {
  tenantId: string;
  userId: string;
  limit: number;
  after?: IncidentListCursor;
}

export interface FindIncidentInput {
  tenantId: string;
  userId: string;
  incidentId: string;
}

export interface UpdateIncidentInput {
  tenantId: string;
  userId: string;
  incidentId: string;
  title?: string;
  description?: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  endTime?: Date | null;
  impactedServices?: string[];
  updatedAt: Date;
}

export interface TimelineEvent {
  id: string;
  tenantId: string;
  incidentId: string;
  eventTime: Date;
  eventType: string;
  message: string;
  createdByUserId: string;
  createdAt: Date;
}

export interface CreateTimelineEventInput {
  tenantId: string;
  userId: string;
  incidentId: string;
  eventTime: Date;
  eventType: string;
  message: string;
}

export interface ListTimelineEventsInput {
  tenantId: string;
  userId: string;
  incidentId: string;
}

export interface IncidentTask {
  id: string;
  tenantId: string;
  incidentId: string;
  title: string;
  description: string;
  status: TaskStatus;
  assigneeUserId: string | null;
  dueAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTaskInput {
  tenantId: string;
  userId: string;
  incidentId: string;
  title: string;
  description: string;
  assigneeUserId: string | null;
  dueAt: Date | null;
}

export interface UpdateTaskInput {
  tenantId: string;
  userId: string;
  incidentId: string;
  taskId: string;
  title?: string;
  description?: string;
  status?: TaskStatus;
  assigneeUserId?: string | null;
  dueAt?: Date | null;
  updatedAt: Date;
}

export interface ListTasksInput {
  tenantId: string;
  userId: string;
  incidentId: string;
}

export interface FindTaskInput {
  tenantId: string;
  userId: string;
  incidentId: string;
  taskId: string;
}

export interface StatusUpdate {
  id: string;
  tenantId: string;
  incidentId: string;
  audience: StatusUpdateAudience;
  message: string;
  createdByUserId: string;
  publishedAt: Date;
  createdAt: Date;
}

export interface CreateStatusUpdateInput {
  tenantId: string;
  userId: string;
  incidentId: string;
  audience: StatusUpdateAudience;
  message: string;
  publishedAt: Date;
}

export interface ListStatusUpdatesInput {
  tenantId: string;
  userId: string;
  incidentId: string;
}

export interface IncidentRepository {
  createIncident(input: CreateIncidentInput): Promise<Incident>;
  listIncidents(input: ListIncidentsInput): Promise<Incident[]>;
  findIncidentById(input: FindIncidentInput): Promise<Incident | null>;
  updateIncident(input: UpdateIncidentInput): Promise<Incident | null>;

  createTimelineEvent(input: CreateTimelineEventInput): Promise<TimelineEvent>;
  listTimelineEvents(input: ListTimelineEventsInput): Promise<TimelineEvent[]>;

  createTask(input: CreateTaskInput): Promise<IncidentTask>;
  findTaskById(input: FindTaskInput): Promise<IncidentTask | null>;
  updateTask(input: UpdateTaskInput): Promise<IncidentTask | null>;
  listTasks(input: ListTasksInput): Promise<IncidentTask[]>;

  createStatusUpdate(input: CreateStatusUpdateInput): Promise<StatusUpdate>;
  listStatusUpdates(input: ListStatusUpdatesInput): Promise<StatusUpdate[]>;
}
