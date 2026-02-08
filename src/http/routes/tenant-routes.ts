import { Router } from 'express';
import { z } from 'zod';

import type { Env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { issueCsrfToken } from '../middlewares/csrf.js';
import { requireAuthenticatedUser } from '../middlewares/require-auth.js';
import { ORG_ROLES } from '../../repositories/tenant-repository.js';
import { getAuditRequestContext, type AuditService } from '../../services/audit-service.js';
import { getAuthenticatedUserId } from '../middlewares/auth-context.js';
import type { TenantService } from '../../services/tenant-service.js';

const createTenantSchema = z.object({
  name: z.string().trim().min(3).max(80)
});

const tenantIdParamsSchema = z.object({
  tenantId: z.string().uuid()
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(ORG_ROLES)
});

const acceptInviteSchema = z.object({
  token: z.string().min(16)
});

function emailDomain(email: string): string | null {
  const separator = email.lastIndexOf('@');
  if (separator < 0 || separator === email.length - 1) {
    return null;
  }

  return email.slice(separator + 1).toLowerCase();
}

function ensureSessionAuth(request: Parameters<typeof requireAuthenticatedUser>[0]): void {
  if (request.authContext?.authType === 'api_key') {
    throw new AppError(403, 'PERMISSION_DENIED', 'Session authentication is required for tenant management.');
  }
}

export function createTenantRoutes(tenantService: TenantService, auditService: AuditService, env: Env): Router {
  const router = Router();

  router.use(requireAuthenticatedUser);

  router.get('/', async (request, response, next) => {
    try {
      ensureSessionAuth(request);
      const userId = getAuthenticatedUserId(request);

      const records = await tenantService.listUserTenants(userId);
      response.status(200).json({
        activeTenantId: request.session.activeTenantId ?? null,
        tenants: records.map((record) => ({
          tenant: record.tenant,
          membership: {
            id: record.membership.id,
            role: record.membership.role
          }
        })),
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    try {
      ensureSessionAuth(request);
      const userId = getAuthenticatedUserId(request);

      const payload = createTenantSchema.parse(request.body);
      const record = await tenantService.createTenant(userId, payload.name);
      request.session.activeTenantId = record.tenant.id;
      const requestContext = getAuditRequestContext(request);

      await auditService.recordSafely({
        action: 'tenant.created',
        actorUserId: userId,
        tenantId: record.tenant.id,
        targetType: 'tenant',
        targetId: record.tenant.id,
        metadata: {
          membershipRole: record.membership.role
        },
        ...requestContext
      });

      response.status(201).json({
        tenant: record.tenant,
        membership: record.membership,
        activeTenantId: request.session.activeTenantId,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/invites/accept', async (request, response, next) => {
    try {
      ensureSessionAuth(request);
      const userId = getAuthenticatedUserId(request);

      const payload = acceptInviteSchema.parse(request.body);
      const record = await tenantService.acceptInvite(userId, payload.token);
      request.session.activeTenantId = record.tenant.id;
      const requestContext = getAuditRequestContext(request);

      await auditService.recordSafely({
        action: 'tenant.invite.accepted',
        actorUserId: userId,
        tenantId: record.tenant.id,
        targetType: 'membership',
        targetId: record.membership.id,
        metadata: {
          role: record.membership.role
        },
        ...requestContext
      });

      response.status(200).json({
        tenant: record.tenant,
        membership: record.membership,
        activeTenantId: request.session.activeTenantId,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:tenantId/switch', async (request, response, next) => {
    try {
      ensureSessionAuth(request);
      const userId = getAuthenticatedUserId(request);

      const params = tenantIdParamsSchema.parse(request.params);
      const membership = await tenantService.switchActiveTenant(userId, params.tenantId);
      request.session.activeTenantId = membership.tenantId;
      const requestContext = getAuditRequestContext(request);

      await auditService.recordSafely({
        action: 'tenant.switched',
        actorUserId: userId,
        tenantId: membership.tenantId,
        targetType: 'tenant',
        targetId: membership.tenantId,
        metadata: {
          role: membership.role
        },
        ...requestContext
      });

      response.status(200).json({
        activeTenantId: request.session.activeTenantId,
        membership,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:tenantId/invites', async (request, response, next) => {
    try {
      ensureSessionAuth(request);
      const userId = getAuthenticatedUserId(request);

      const params = tenantIdParamsSchema.parse(request.params);
      const payload = inviteSchema.parse(request.body);

      const result = await tenantService.createInvite(userId, params.tenantId, payload.email, payload.role);
      const requestContext = getAuditRequestContext(request);

      await auditService.recordSafely({
        action: 'tenant.invite.created',
        actorUserId: userId,
        tenantId: params.tenantId,
        targetType: 'tenant_invite',
        targetId: result.invite.id,
        metadata: {
          role: payload.role,
          emailDomain: emailDomain(payload.email)
        },
        ...requestContext
      });

      response.status(201).json({
        invite: {
          id: result.invite.id,
          tenantId: result.invite.tenantId,
          email: result.invite.email,
          role: result.invite.role,
          expiresAt: result.invite.expiresAt,
          createdAt: result.invite.createdAt
        },
        inviteToken: env.INVITES_EXPOSE_TOKEN ? result.inviteToken : undefined,
        csrfToken: issueCsrfToken(request)
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
