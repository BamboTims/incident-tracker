import { Router } from 'express';
import { z } from 'zod';

import type { AuditLogQueryService } from '../../services/audit-log-query-service.js';
import { issueCsrfToken } from '../middlewares/csrf.js';
import { getAuthenticatedUserId, getResolvedTenantId } from '../middlewares/auth-context.js';
import { requireAuthenticatedUser } from '../middlewares/require-auth.js';

const listAuditLogsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).optional()
});

export function createAuditLogRoutes(auditLogQueryService: AuditLogQueryService): Router {
  const router = Router();
  router.use(requireAuthenticatedUser);

  router.get('/', async (request, response, next) => {
    try {
      const userId = getAuthenticatedUserId(request);
      const tenantId = getResolvedTenantId(request);
      const query = listAuditLogsQuerySchema.parse(request.query);

      const result = await auditLogQueryService.listEvents(userId, tenantId, query.limit, query.cursor);

      response.status(200).json({
        events: result.events,
        nextCursor: result.nextCursor,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
