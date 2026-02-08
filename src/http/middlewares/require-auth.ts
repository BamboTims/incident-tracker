import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../errors/app-error.js';

export function requireAuthenticatedUser(request: Request, _response: Response, next: NextFunction): void {
  if (request.authContext !== undefined) {
    next();
    return;
  }

  if (typeof request.session.userId !== 'string' || request.session.userId.length === 0) {
    next(new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.'));
    return;
  }

  request.authContext = {
    authType: 'session',
    userId: request.session.userId,
    tenantId: typeof request.session.activeTenantId === 'string' ? request.session.activeTenantId : null,
    apiKeyId: null,
    scopes: null
  };

  next();
}
