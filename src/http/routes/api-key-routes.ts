import { Router } from 'express';
import { z } from 'zod';

import { API_KEY_SCOPES } from '../../auth/auth-context.js';
import { AppError } from '../../errors/app-error.js';
import { getAuditRequestContext, type AuditService } from '../../services/audit-service.js';
import type { ApiKeyService } from '../../services/api-key-service.js';
import { issueCsrfToken } from '../middlewares/csrf.js';
import { getAuthenticatedUserId } from '../middlewares/auth-context.js';
import { requireAuthenticatedUser } from '../middlewares/require-auth.js';

const tenantParamsSchema = z.object({
  tenantId: z.string().uuid()
});

const apiKeyParamsSchema = z.object({
  tenantId: z.string().uuid(),
  apiKeyId: z.string().uuid()
});

const createServiceAccountSchema = z.object({
  name: z.string().trim().min(3).max(120),
  ownerUserId: z.string().uuid().optional()
});

const createApiKeySchema = z.object({
  serviceAccountId: z.string().uuid(),
  name: z.string().trim().min(3).max(120),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1)
});

function ensureSessionAuth(request: Parameters<typeof requireAuthenticatedUser>[0]): void {
  if (request.authContext?.authType === 'api_key') {
    throw new AppError(403, 'PERMISSION_DENIED', 'Session authentication is required for API key management.');
  }
}

export function createApiKeyRoutes(apiKeyService: ApiKeyService, auditService: AuditService): Router {
  const router = Router({ mergeParams: true });

  router.use(requireAuthenticatedUser);

  router.get('/service-accounts', async (request, response, next) => {
    try {
      ensureSessionAuth(request);
      const userId = getAuthenticatedUserId(request);
      const params = tenantParamsSchema.parse(request.params);

      const serviceAccounts = await apiKeyService.listServiceAccounts(userId, params.tenantId);

      response.status(200).json({
        serviceAccounts,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/service-accounts', async (request, response, next) => {
    try {
      ensureSessionAuth(request);
      const userId = getAuthenticatedUserId(request);
      const params = tenantParamsSchema.parse(request.params);
      const payload = createServiceAccountSchema.parse(request.body);

      const serviceAccount = await apiKeyService.createServiceAccount(
        userId,
        params.tenantId,
        payload.name,
        payload.ownerUserId
      );

      await auditService.recordSafely({
        action: 'service_account.created',
        actorUserId: userId,
        tenantId: params.tenantId,
        targetType: 'service_account',
        targetId: serviceAccount.id,
        metadata: {
          ownerUserId: serviceAccount.ownerUserId
        },
        ...getAuditRequestContext(request)
      });

      response.status(201).json({
        serviceAccount,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api-keys', async (request, response, next) => {
    try {
      ensureSessionAuth(request);
      const userId = getAuthenticatedUserId(request);
      const params = tenantParamsSchema.parse(request.params);

      const apiKeys = await apiKeyService.listApiKeys(userId, params.tenantId);

      response.status(200).json({
        apiKeys,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api-keys', async (request, response, next) => {
    try {
      ensureSessionAuth(request);
      const userId = getAuthenticatedUserId(request);
      const params = tenantParamsSchema.parse(request.params);
      const payload = createApiKeySchema.parse(request.body);

      const result = await apiKeyService.createApiKey(
        userId,
        params.tenantId,
        payload.serviceAccountId,
        payload.name,
        payload.scopes
      );

      await auditService.recordSafely({
        action: 'api_key.created',
        actorUserId: userId,
        tenantId: params.tenantId,
        targetType: 'api_key',
        targetId: result.apiKey.id,
        metadata: {
          serviceAccountId: result.apiKey.serviceAccountId,
          scopes: result.apiKey.scopes
        },
        ...getAuditRequestContext(request)
      });

      response.status(201).json({
        apiKey: result.apiKey,
        secret: result.secret,
        redactedSecret: apiKeyService.redactSecret(result.secret),
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api-keys/:apiKeyId/revoke', async (request, response, next) => {
    try {
      ensureSessionAuth(request);
      const userId = getAuthenticatedUserId(request);
      const params = apiKeyParamsSchema.parse(request.params);

      const apiKey = await apiKeyService.revokeApiKey(userId, params.tenantId, params.apiKeyId);

      await auditService.recordSafely({
        action: 'api_key.revoked',
        actorUserId: userId,
        tenantId: params.tenantId,
        targetType: 'api_key',
        targetId: apiKey.id,
        metadata: {},
        ...getAuditRequestContext(request)
      });

      response.status(200).json({
        apiKey,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
