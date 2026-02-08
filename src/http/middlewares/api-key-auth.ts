import type { NextFunction, Request, Response } from 'express';

import { hasReadScope, hasWriteScope } from '../../auth/auth-context.js';
import { AppError } from '../../errors/app-error.js';
import type { ApiKeyService } from '../../services/api-key-service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createApiKeyAuthMiddleware(apiKeyService: ApiKeyService) {
  return async function apiKeyAuthMiddleware(request: Request, _response: Response, next: NextFunction): Promise<void> {
    const header = request.header('x-api-key');
    if (typeof header !== 'string' || header.length === 0) {
      next();
      return;
    }

    try {
      const principal = await apiKeyService.authenticateApiKey(header);
      if (principal === null) {
        next(new AppError(401, 'AUTH_INVALID_API_KEY', 'API key is invalid or revoked.'));
        return;
      }

      request.authContext = {
        authType: 'api_key',
        userId: principal.userId,
        tenantId: principal.tenantId,
        apiKeyId: principal.apiKeyId,
        scopes: principal.scopes
      };

      const isSafeMethod = SAFE_METHODS.has(request.method);
      const scopeAllowed = isSafeMethod
        ? hasReadScope(request.authContext)
        : hasWriteScope(request.authContext);

      if (!scopeAllowed) {
        next(new AppError(403, 'API_KEY_SCOPE_DENIED', 'API key does not include the required scope.'));
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
