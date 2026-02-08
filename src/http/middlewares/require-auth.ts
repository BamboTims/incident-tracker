import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../errors/app-error.js';

export function requireAuthenticatedUser(request: Request, _response: Response, next: NextFunction): void {
  if (typeof request.session.userId !== 'string' || request.session.userId.length === 0) {
    next(new AppError(401, 'AUTH_REQUIRED', 'Authentication is required.'));
    return;
  }

  next();
}