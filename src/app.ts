import express, { type Express } from 'express';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Pool } from 'pg';

import { getEnv, type Env } from './config/env.js';
import { AppError } from './errors/app-error.js';
import { errorHandler } from './errors/error-handler.js';
import { csrfProtection } from './http/middlewares/csrf.js';
import { attachTraceId } from './http/middlewares/trace-id.js';
import { createAuthRoutes } from './http/routes/auth-routes.js';
import type { AuthRepository } from './repositories/auth-repository.js';
import { InMemoryAuthRepository } from './repositories/in-memory-auth-repository.js';
import { PostgresAuthRepository } from './repositories/postgres-auth-repository.js';
import { registerSession, type SessionRuntime } from './session/register-session.js';
import { AuthService } from './services/auth-service.js';

export interface CreateAppOptions {
  envOverrides?: Partial<Record<keyof Env, unknown>>;
  authRepository?: AuthRepository;
}

export interface AppRuntime {
  app: Express;
  env: Env;
  authRepository: AuthRepository;
  close(): Promise<void>;
}

function createGlobalRateLimiter() {
  return rateLimit({
    windowMs: 60_000,
    limit: 200,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (request) => ipKeyGenerator(request.ip ?? '')
  });
}

function createAuthRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (request) => {
      const body = typeof request.body === 'object' && request.body !== null ? request.body as Record<string, unknown> : {};
      const emailValue = typeof body.email === 'string' ? body.email.toLowerCase() : 'unknown-email';
      return `${ipKeyGenerator(request.ip ?? '')}:${emailValue}`;
    }
  });
}

export async function createApp(options: CreateAppOptions = {}): Promise<AppRuntime> {
  const env = getEnv(options.envOverrides);
  const app = express();

  let pgPool: Pool | null = null;
  const authRepository = options.authRepository ?? (() => {
    if (typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.length > 0) {
      pgPool = new Pool({ connectionString: env.DATABASE_URL });
      return new PostgresAuthRepository(pgPool);
    }

    return new InMemoryAuthRepository();
  })();

  const authService = new AuthService(authRepository, {
    lockoutAttempts: env.AUTH_LOCKOUT_ATTEMPTS,
    lockoutSeconds: env.AUTH_LOCKOUT_SECONDS,
    resetTokenTtlMinutes: env.AUTH_RESET_TOKEN_TTL_MINUTES
  });

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(attachTraceId);

  const sessionRuntime: SessionRuntime = await registerSession(app, env);

  app.use(createGlobalRateLimiter());
  app.use(csrfProtection);

  app.use('/v1/auth/login', createAuthRateLimiter());
  app.use('/v1/auth', createAuthRoutes(authService, env));

  app.get('/health', (_request, response) => {
    response.status(200).json({
      status: 'ok'
    });
  });

  app.use((_request, _response, next) => {
    next(new AppError(404, 'NOT_FOUND', 'Route not found.'));
  });

  app.use(errorHandler);

  return {
    app,
    env,
    authRepository,
    async close() {
      if (pgPool !== null) {
        await pgPool.end();
      }
      await sessionRuntime.close();
    }
  };
}
