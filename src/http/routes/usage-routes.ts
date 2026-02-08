import { Router } from 'express';

import type { UsageService } from '../../services/usage-service.js';
import { issueCsrfToken } from '../middlewares/csrf.js';
import { getAuthenticatedUserId, getResolvedTenantId } from '../middlewares/auth-context.js';
import { requireAuthenticatedUser } from '../middlewares/require-auth.js';

export function createUsageRoutes(usageService: UsageService): Router {
  const router = Router();
  router.use(requireAuthenticatedUser);

  router.get('/', async (request, response, next) => {
    try {
      const userId = getAuthenticatedUserId(request);
      const tenantId = getResolvedTenantId(request);
      const summary = await usageService.getUsageSummary(userId, tenantId);

      response.status(200).json({
        usage: summary,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
