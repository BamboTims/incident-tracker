import type { Request, Router } from 'express';
import { Router as createRouter } from 'express';
import { z } from 'zod';

import type { Env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { issueCsrfToken } from '../middlewares/csrf.js';
import type { AuthService } from '../../services/auth-service.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
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

export function createAuthRoutes(authService: AuthService, env: Env): Router {
  const router = createRouter();

  router.get('/me', async (request, response, next) => {
    try {
      const csrfToken = issueCsrfToken(request);

      if (typeof request.session.userId !== 'string' || request.session.userId.length === 0) {
        response.status(200).json({
          authenticated: false,
          csrfToken
        });
        return;
      }

      const user = await authService.getCurrentUser(request.session.userId);
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

      response.status(200).json({
        authenticated: true,
        user,
        csrfToken
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', async (request, response, next) => {
    try {
      await destroySession(request);
      response.clearCookie(env.SESSION_COOKIE_NAME);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post('/password/forgot', async (request, response, next) => {
    try {
      const payload = forgotPasswordSchema.parse(request.body);
      const resetToken = await authService.requestPasswordReset(payload.email);

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
      await authService.resetPassword(payload.token, payload.newPassword);
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
