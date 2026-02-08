import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../errors/app-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function readTokenFromRequest(request: Request): string | undefined {
  const headerToken = request.header('x-csrf-token');
  if (typeof headerToken === 'string' && headerToken.length > 0) {
    return headerToken;
  }

  if (typeof request.body === 'object' && request.body !== null && '_csrf' in request.body) {
    const bodyToken = (request.body as Record<string, unknown>)['_csrf'];
    if (typeof bodyToken === 'string' && bodyToken.length > 0) {
      return bodyToken;
    }
  }

  return undefined;
}

export function issueCsrfToken(request: Request): string {
  const token = request.session.csrfToken;
  if (typeof token === 'string' && token.length > 0) {
    return token;
  }

  const newToken = randomBytes(32).toString('base64url');
  request.session.csrfToken = newToken;
  return newToken;
}

export function csrfProtection(request: Request, _response: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(request.method)) {
    issueCsrfToken(request);
    next();
    return;
  }

  const expectedToken = request.session.csrfToken;
  const receivedToken = readTokenFromRequest(request);

  if (typeof expectedToken !== 'string' || expectedToken.length === 0 || expectedToken !== receivedToken) {
    next(new AppError(403, 'CSRF_TOKEN_INVALID', 'CSRF token missing or invalid.'));
    return;
  }

  next();
}
