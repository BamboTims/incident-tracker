import type { Request } from 'express';
import { z } from 'zod';

import { AppError } from '../../errors/app-error.js';

const tenantIdSchema = z.string().uuid();

export function getAuthenticatedUserId(request: Request): string {
  if (typeof request.authContext?.userId === 'string') {
    return request.authContext.userId;
  }

  const userId = request.session.userId;
  if (typeof userId === 'string' && userId.length > 0) {
    return userId;
  }

  throw new Error('Expected authenticated user id on request.');
}

export function getResolvedTenantId(request: Request): string {
  const candidate = typeof request.authContext?.tenantId === 'string'
    ? request.authContext.tenantId
    : request.session.activeTenantId;

  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new AppError(400, 'TENANT_CONTEXT_REQUIRED', 'Set an active tenant before accessing tenant-scoped endpoints.');
  }

  const parsedTenantId = tenantIdSchema.safeParse(candidate);
  if (!parsedTenantId.success) {
    throw new AppError(400, 'TENANT_CONTEXT_INVALID', 'Active tenant context is invalid.');
  }

  return parsedTenantId.data;
}
