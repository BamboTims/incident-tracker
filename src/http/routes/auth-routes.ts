import type { Request, Router } from 'express';
import { Router as createRouter } from 'express';
import { z } from 'zod';

import type { Env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { getAuditRequestContext, type AuditService } from '../../services/audit-service.js';
import { issueCsrfToken } from '../middlewares/csrf.js';
import type { AuthService } from '../../services/auth-service.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12)
});

const forgotPasswordSchema = z.object({
  email: z.string().email()
});

const resetPasswordSchema = z.object({
  token: z.string().min(16),
  newPassword: z.string().min(12)
});

function regenerateSession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error: unknown) => {
      if (error instanceof Error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function destroySession(request: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.destroy((error: unknown) => {
      if (error instanceof Error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function emailDomain(email: string): string | null {
  const separator = email.lastIndexOf('@');
  if (separator < 0 || separator === email.length - 1) {
    return null;
  }

  return email.slice(separator + 1).toLowerCase();
}

export function createAuthRoutes(authService: AuthService, auditService: AuditService, env: Env): Router {
  const router = createRouter();

  router.get('/me', async (request, response, next) => {
    try {
      const csrfToken = issueCsrfToken(request);
      const authenticatedUserId = typeof request.authContext?.userId === 'string'
        ? request.authContext.userId
        : request.session.userId;

      if (typeof authenticatedUserId !== 'string' || authenticatedUserId.length === 0) {
        response.status(200).json({
          authenticated: false,
          csrfToken
        });
        return;
      }

      const user = await authService.getCurrentUser(authenticatedUserId);
      if (user === null) {
        delete request.session.userId;
        response.status(200).json({
          authenticated: false,
          csrfToken
        });
        return;
      }

      response.status(200).json({
        authenticated: true,
        authType: request.authContext?.authType ?? 'session',
        user,
        csrfToken
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', async (request, response, next) => {
    try {
      const payload = loginSchema.parse(request.body);
      const user = await authService.login(payload.email, payload.password, new Date());

      await regenerateSession(request);
      request.session.userId = user.id;
      const csrfToken = issueCsrfToken(request);
      const requestContext = getAuditRequestContext(request);

      await auditService.recordSafely({
        action: 'auth.login',
        actorUserId: user.id,
        tenantId: null,
        targetType: 'user',
        targetId: user.id,
        metadata: {
          authMethod: 'password'
        },
        ...requestContext
      });

      response.status(200).json({
        authenticated: true,
        authType: 'session',
        user,
        csrfToken
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/signup', async (request, response, next) => {
    try {
      const payload = signupSchema.parse(request.body);
      const user = await authService.createUser(payload.email, payload.password);

      await regenerateSession(request);
      request.session.userId = user.id;
      const csrfToken = issueCsrfToken(request);
      const requestContext = getAuditRequestContext(request);

      await auditService.recordSafely({
        action: 'auth.signup',
        actorUserId: user.id,
        tenantId: null,
        targetType: 'user',
        targetId: user.id,
        metadata: {
          authMethod: 'password'
        },
        ...requestContext
      });

      response.status(201).json({
        authenticated: true,
        authType: 'session',
        user,
        csrfToken
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', async (request, response, next) => {
    try {
      const actorUserId = typeof request.session.userId === 'string'
        ? request.session.userId
        : null;
      const activeTenantId = typeof request.session.activeTenantId === 'string'
        ? request.session.activeTenantId
        : null;
      const requestContext = getAuditRequestContext(request);

      await destroySession(request);
      response.clearCookie(env.SESSION_COOKIE_NAME);

      await auditService.recordSafely({
        action: 'auth.logout',
        actorUserId,
        tenantId: activeTenantId,
        targetType: actorUserId === null ? null : 'user',
        targetId: actorUserId,
        metadata: {},
        ...requestContext
      });

      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post('/password/forgot', async (request, response, next) => {
    try {
      const payload = forgotPasswordSchema.parse(request.body);
      const resetToken = await authService.requestPasswordReset(payload.email);
      const requestContext = getAuditRequestContext(request);

      await auditService.recordSafely({
        action: 'auth.password_reset.requested',
        actorUserId: null,
        tenantId: null,
        targetType: 'user',
        targetId: null,
        metadata: {
          emailDomain: emailDomain(payload.email)
        },
        ...requestContext
      });

      response.status(202).json({
        code: 'AUTH_PASSWORD_RESET_REQUESTED',
        message: 'If the account exists, a password reset link will be sent.',
        resetToken: env.AUTH_EXPOSE_RESET_TOKEN ? resetToken : undefined
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/password/reset', async (request, response, next) => {
    try {
      const payload = resetPasswordSchema.parse(request.body);
      const userId = await authService.resetPassword(payload.token, payload.newPassword);

      await auditService.recordSafely({
        action: 'auth.password_reset.completed',
        actorUserId: userId,
        tenantId: null,
        targetType: 'user',
        targetId: userId,
        metadata: {},
        ...getAuditRequestContext(request)
      });

      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post('/users/bootstrap', async (request, response, next) => {
    if (env.NODE_ENV !== 'test') {
      next(new AppError(404, 'NOT_FOUND', 'Route not found.'));
      return;
    }

    try {
      const payload = loginSchema.extend({
        password: z.string().min(12)
      }).parse(request.body);

      const user = await authService.createUser(payload.email, payload.password);
      response.status(201).json({ user });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
