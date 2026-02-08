import { Router } from 'express';
import { z } from 'zod';

import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  STATUS_UPDATE_AUDIENCES,
  TASK_STATUSES
} from '../../repositories/incident-repository.js';
import { getAuditRequestContext, type AuditService } from '../../services/audit-service.js';
import type { IncidentService } from '../../services/incident-service.js';
import type { UsageService } from '../../services/usage-service.js';
import { issueCsrfToken } from '../middlewares/csrf.js';
import { getAuthenticatedUserId, getResolvedTenantId } from '../middlewares/auth-context.js';
import { requireAuthenticatedUser } from '../middlewares/require-auth.js';

const createIncidentSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).default(''),
  severity: z.enum(INCIDENT_SEVERITIES),
  startTime: z.string().datetime(),
  impactedServices: z.array(z.string().trim().min(1).max(100)).default([])
});

const listIncidentsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).optional()
});

const incidentParamsSchema = z.object({
  incidentId: z.string().uuid()
});

const taskParamsSchema = z.object({
  incidentId: z.string().uuid(),
  taskId: z.string().uuid()
});

const updateIncidentSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(4000).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  endTime: z.union([z.string().datetime(), z.null()]).optional(),
  impactedServices: z.array(z.string().trim().min(1).max(100)).optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required for update.'
});

const createTimelineEventSchema = z.object({
  eventTime: z.string().datetime(),
  eventType: z.string().trim().min(2).max(100),
  message: z.string().trim().min(1).max(4000)
});

const createTaskSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).default(''),
  assigneeUserId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional()
});

const updateTaskSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(4000).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required for update.'
});

const createStatusUpdateSchema = z.object({
  audience: z.enum(STATUS_UPDATE_AUDIENCES),
  message: z.string().trim().min(1).max(4000),
  publishedAt: z.string().datetime()
});

async function consumeWriteQuota(
  usageService: UsageService,
  request: Parameters<typeof requireAuthenticatedUser>[0],
  userId: string,
  tenantId: string,
  route: string
): Promise<void> {
  await usageService.consumeWriteQuota({
    userId,
    tenantId,
    actorUserId: userId,
    apiKeyId: request.authContext?.apiKeyId ?? null,
    route,
    traceId: typeof request.res?.locals.traceId === 'string' ? request.res.locals.traceId : null
  });
}

export function createIncidentRoutes(
  incidentService: IncidentService,
  auditService: AuditService,
  usageService: UsageService
): Router {
  const router = Router();

  router.use(requireAuthenticatedUser);

  router.post('/', async (request, response, next) => {
    try {
      const userId = getAuthenticatedUserId(request);
      const tenantId = getResolvedTenantId(request);
      await consumeWriteQuota(usageService, request, userId, tenantId, 'incidents.create');
      const payload = createIncidentSchema.parse(request.body);

      const incident = await incidentService.createIncident(userId, tenantId, {
        title: payload.title,
        description: payload.description,
        severity: payload.severity,
        startTime: new Date(payload.startTime),
        impactedServices: payload.impactedServices
      });
      const requestContext = getAuditRequestContext(request);

      await auditService.recordSafely({
        action: 'incident.created',
        actorUserId: userId,
        tenantId,
        targetType: 'incident',
        targetId: incident.id,
        metadata: {
          severity: incident.severity,
          status: incident.status
        },
        ...requestContext
      });

      response.status(201).json({
        incident,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (request, response, next) => {
    try {
      const userId = getAuthenticatedUserId(request);
      const tenantId = getResolvedTenantId(request);
      const query = listIncidentsQuerySchema.parse(request.query);

      const result = await incidentService.listIncidents(userId, tenantId, query.limit, query.cursor);

      response.status(200).json({
        incidents: result.incidents,
        nextCursor: result.nextCursor,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:incidentId', async (request, response, next) => {
    try {
      const userId = getAuthenticatedUserId(request);
      const tenantId = getResolvedTenantId(request);
      const params = incidentParamsSchema.parse(request.params);

      const incident = await incidentService.getIncident(userId, tenantId, params.incidentId);

      response.status(200).json({
        incident,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:incidentId', async (request, response, next) => {
    try {
      const userId = getAuthenticatedUserId(request);
      const tenantId = getResolvedTenantId(request);
      await consumeWriteQuota(usageService, request, userId, tenantId, 'incidents.update');
      const params = incidentParamsSchema.parse(request.params);
      const payload = updateIncidentSchema.parse(request.body);

      const incident = await incidentService.updateIncident(userId, tenantId, params.incidentId, {
        title: payload.title,
        description: payload.description,
        severity: payload.severity,
        status: payload.status,
        endTime: payload.endTime === undefined
          ? undefined
          : payload.endTime === null
            ? null
            : new Date(payload.endTime),
        impactedServices: payload.impactedServices
      });
      const requestContext = getAuditRequestContext(request);

      await auditService.recordSafely({
        action: 'incident.updated',
        actorUserId: userId,
        tenantId,
        targetType: 'incident',
        targetId: incident.id,
        metadata: {
          changedFields: Object.keys(payload).sort()
        },
        ...requestContext
      });

      response.status(200).json({
        incident,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:incidentId/timeline-events', async (request, response, next) => {
    try {
      const userId = getAuthenticatedUserId(request);
      const tenantId = getResolvedTenantId(request);
      await consumeWriteQuota(usageService, request, userId, tenantId, 'incidents.timeline_events.create');
      const params = incidentParamsSchema.parse(request.params);
      const payload = createTimelineEventSchema.parse(request.body);

      const event = await incidentService.addTimelineEvent(userId, tenantId, params.incidentId, {
        eventTime: new Date(payload.eventTime),
        eventType: payload.eventType,
        message: payload.message
      });
      const requestContext = getAuditRequestContext(request);

      await auditService.recordSafely({
        action: 'incident.timeline_event.created',
        actorUserId: userId,
        tenantId,
        targetType: 'timeline_event',
        targetId: event.id,
        metadata: {
          incidentId: params.incidentId,
          eventType: event.eventType
        },
        ...requestContext
      });

      response.status(201).json({
        event,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:incidentId/timeline-events', async (request, response, next) => {
    try {
      const userId = getAuthenticatedUserId(request);
      const tenantId = getResolvedTenantId(request);
      const params = incidentParamsSchema.parse(request.params);

      const events = await incidentService.listTimelineEvents(userId, tenantId, params.incidentId);

      response.status(200).json({
        events,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:incidentId/tasks', async (request, response, next) => {
    try {
      const userId = getAuthenticatedUserId(request);
      const tenantId = getResolvedTenantId(request);
      await consumeWriteQuota(usageService, request, userId, tenantId, 'incidents.tasks.create');
      const params = incidentParamsSchema.parse(request.params);
      const payload = createTaskSchema.parse(request.body);

      const task = await incidentService.createTask(userId, tenantId, params.incidentId, {
        title: payload.title,
        description: payload.description,
        assigneeUserId: payload.assigneeUserId ?? null,
        dueAt: payload.dueAt === undefined || payload.dueAt === null ? null : new Date(payload.dueAt)
      });
      const requestContext = getAuditRequestContext(request);

      await auditService.recordSafely({
        action: 'incident.task.created',
        actorUserId: userId,
        tenantId,
        targetType: 'task',
        targetId: task.id,
        metadata: {
          incidentId: params.incidentId,
          status: task.status
        },
        ...requestContext
      });

      response.status(201).json({
        task,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:incidentId/tasks', async (request, response, next) => {
    try {
      const userId = getAuthenticatedUserId(request);
      const tenantId = getResolvedTenantId(request);
      const params = incidentParamsSchema.parse(request.params);

      const tasks = await incidentService.listTasks(userId, tenantId, params.incidentId);

      response.status(200).json({
        tasks,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:incidentId/tasks/:taskId', async (request, response, next) => {
    try {
      const userId = getAuthenticatedUserId(request);
      const tenantId = getResolvedTenantId(request);
      await consumeWriteQuota(usageService, request, userId, tenantId, 'incidents.tasks.update');
      const params = taskParamsSchema.parse(request.params);
      const payload = updateTaskSchema.parse(request.body);

      const task = await incidentService.updateTask(userId, tenantId, params.incidentId, params.taskId, {
        title: payload.title,
        description: payload.description,
        status: payload.status,
        assigneeUserId: payload.assigneeUserId,
        dueAt: payload.dueAt === undefined || payload.dueAt === null ? payload.dueAt : new Date(payload.dueAt)
      });
      const requestContext = getAuditRequestContext(request);

      await auditService.recordSafely({
        action: 'incident.task.updated',
        actorUserId: userId,
        tenantId,
        targetType: 'task',
        targetId: task.id,
        metadata: {
          incidentId: params.incidentId,
          changedFields: Object.keys(payload).sort()
        },
        ...requestContext
      });

      response.status(200).json({
        task,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:incidentId/status-updates', async (request, response, next) => {
    try {
      const userId = getAuthenticatedUserId(request);
      const tenantId = getResolvedTenantId(request);
      await consumeWriteQuota(usageService, request, userId, tenantId, 'incidents.status_updates.create');
      const params = incidentParamsSchema.parse(request.params);
      const payload = createStatusUpdateSchema.parse(request.body);

      const statusUpdate = await incidentService.createStatusUpdate(userId, tenantId, params.incidentId, {
        audience: payload.audience,
        message: payload.message,
        publishedAt: new Date(payload.publishedAt)
      });
      const requestContext = getAuditRequestContext(request);

      await auditService.recordSafely({
        action: 'incident.status_update.created',
        actorUserId: userId,
        tenantId,
        targetType: 'status_update',
        targetId: statusUpdate.id,
        metadata: {
          incidentId: params.incidentId,
          audience: statusUpdate.audience
        },
        ...requestContext
      });

      response.status(201).json({
        statusUpdate,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:incidentId/status-updates', async (request, response, next) => {
    try {
      const userId = getAuthenticatedUserId(request);
      const tenantId = getResolvedTenantId(request);
      const params = incidentParamsSchema.parse(request.params);

      const updates = await incidentService.listStatusUpdates(userId, tenantId, params.incidentId);

      response.status(200).json({
        updates,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
