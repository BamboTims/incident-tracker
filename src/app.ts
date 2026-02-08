import express, { type Express } from 'express';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Pool } from 'pg';

import { getEnv, type Env } from './config/env.js';
import { AppError } from './errors/app-error.js';
import { errorHandler } from './errors/error-handler.js';
import { createApiKeyAuthMiddleware } from './http/middlewares/api-key-auth.js';
import { csrfProtection } from './http/middlewares/csrf.js';
import { attachRequestTelemetry } from './http/middlewares/request-telemetry.js';
import { attachTraceId } from './http/middlewares/trace-id.js';
import { createApiKeyRoutes } from './http/routes/api-key-routes.js';
import { createAuditLogRoutes } from './http/routes/audit-log-routes.js';
import { createAuthRoutes } from './http/routes/auth-routes.js';
import { createIncidentRoutes } from './http/routes/incident-routes.js';
import { createTenantRoutes } from './http/routes/tenant-routes.js';
import { createUsageRoutes } from './http/routes/usage-routes.js';
import type { ApiKeyRepository } from './repositories/api-key-repository.js';
import type { AuditLogRepository } from './repositories/audit-log-repository.js';
import type { AuthRepository } from './repositories/auth-repository.js';
import { InMemoryApiKeyRepository } from './repositories/in-memory-api-key-repository.js';
import { InMemoryAuditLogRepository } from './repositories/in-memory-audit-log-repository.js';
import { InMemoryAuthRepository } from './repositories/in-memory-auth-repository.js';
import { InMemoryIncidentRepository } from './repositories/in-memory-incident-repository.js';
import { InMemoryUsageRepository } from './repositories/in-memory-usage-repository.js';
import { PostgresApiKeyRepository } from './repositories/postgres-api-key-repository.js';
import { PostgresAuditLogRepository } from './repositories/postgres-audit-log-repository.js';
import { PostgresAuthRepository } from './repositories/postgres-auth-repository.js';
import { PostgresIncidentRepository } from './repositories/postgres-incident-repository.js';
import { InMemoryTenantRepository } from './repositories/in-memory-tenant-repository.js';
import { PostgresTenantRepository } from './repositories/postgres-tenant-repository.js';
import { PostgresUsageRepository } from './repositories/postgres-usage-repository.js';
import type { IncidentRepository } from './repositories/incident-repository.js';
import type { TenantRepository } from './repositories/tenant-repository.js';
import type { UsageRepository } from './repositories/usage-repository.js';
import { registerSession, type SessionRuntime } from './session/register-session.js';
import { instrumentPgPool } from './telemetry/pg-instrumentation.js';
import { ApiKeyService } from './services/api-key-service.js';
import { AuditLogQueryService } from './services/audit-log-query-service.js';
import { AuditService } from './services/audit-service.js';
import { AuthService } from './services/auth-service.js';
import { IncidentService } from './services/incident-service.js';
import { TenantService } from './services/tenant-service.js';
import { UsageService } from './services/usage-service.js';

export interface CreateAppOptions {
  envOverrides?: Partial<Record<keyof Env, unknown>>;
  authRepository?: AuthRepository;
  tenantRepository?: TenantRepository;
  incidentRepository?: IncidentRepository;
  auditLogRepository?: AuditLogRepository;
  apiKeyRepository?: ApiKeyRepository;
  usageRepository?: UsageRepository;
}

export interface AppRuntime {
  app: Express;
  env: Env;
  authRepository: AuthRepository;
  tenantRepository: TenantRepository;
  incidentRepository: IncidentRepository;
  auditLogRepository: AuditLogRepository;
  apiKeyRepository: ApiKeyRepository;
  usageRepository: UsageRepository;
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
  const getPool = (): Pool => {
    if (pgPool !== null) {
      return pgPool;
    }

    if (typeof env.DATABASE_URL !== 'string' || env.DATABASE_URL.length === 0) {
      throw new Error('DATABASE_URL is not configured.');
    }

    pgPool = new Pool({ connectionString: env.DATABASE_URL });
    instrumentPgPool(pgPool);
    return pgPool;
  };

  const authRepository = options.authRepository ?? (() => {
    if (typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.length > 0) {
      return new PostgresAuthRepository(getPool());
    }

    return new InMemoryAuthRepository();
  })();
  const tenantRepository = options.tenantRepository ?? (() => {
    if (typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.length > 0) {
      return new PostgresTenantRepository(getPool());
    }

    return new InMemoryTenantRepository();
  })();
  const incidentRepository = options.incidentRepository ?? (() => {
    if (typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.length > 0) {
      return new PostgresIncidentRepository(getPool());
    }

    return new InMemoryIncidentRepository();
  })();
  const auditLogRepository = options.auditLogRepository ?? (() => {
    if (typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.length > 0) {
      return new PostgresAuditLogRepository(getPool());
    }

    return new InMemoryAuditLogRepository();
  })();
  const apiKeyRepository = options.apiKeyRepository ?? (() => {
    if (typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.length > 0) {
      return new PostgresApiKeyRepository(getPool());
    }

    return new InMemoryApiKeyRepository();
  })();
  const usageRepository = options.usageRepository ?? (() => {
    if (typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.length > 0) {
      return new PostgresUsageRepository(getPool());
    }

    return new InMemoryUsageRepository();
  })();

  const authService = new AuthService(authRepository, {
    lockoutAttempts: env.AUTH_LOCKOUT_ATTEMPTS,
    lockoutSeconds: env.AUTH_LOCKOUT_SECONDS,
    resetTokenTtlMinutes: env.AUTH_RESET_TOKEN_TTL_MINUTES
  });
  const auditService = new AuditService(auditLogRepository);
  const apiKeyService = new ApiKeyService(apiKeyRepository, tenantRepository);
  const auditLogQueryService = new AuditLogQueryService(auditLogRepository, tenantRepository, {
    listDefaultLimit: 50,
    listMaxLimit: 100
  });
  const tenantService = new TenantService(tenantRepository, authRepository, {
    inviteTokenTtlHours: env.INVITE_TOKEN_TTL_HOURS
  });
  const incidentService = new IncidentService(incidentRepository, tenantRepository, {
    listDefaultLimit: 20,
    listMaxLimit: 100
  });
  const usageService = new UsageService(usageRepository, tenantRepository, {
    defaultDailyWriteLimit: env.USAGE_DAILY_WRITE_LIMIT
  });

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(attachTraceId);
  if (env.NODE_ENV !== 'test') {
    app.use(attachRequestTelemetry);
  }

  const sessionRuntime: SessionRuntime = await registerSession(app, env);

  app.use(createApiKeyAuthMiddleware(apiKeyService));
  app.use(createGlobalRateLimiter());
  app.use(csrfProtection);

  app.use('/v1/auth/login', createAuthRateLimiter());
  app.use('/v1/auth', createAuthRoutes(authService, auditService, env));
  app.use('/v1/tenants', createTenantRoutes(tenantService, auditService, env));
  app.use('/v1/tenants/:tenantId', createApiKeyRoutes(apiKeyService, auditService));
  app.use('/v1/incidents', createIncidentRoutes(incidentService, auditService, usageService));
  app.use('/v1/audit-logs', createAuditLogRoutes(auditLogQueryService));
  app.use('/v1/usage', createUsageRoutes(usageService));

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
    tenantRepository,
    incidentRepository,
    auditLogRepository,
    apiKeyRepository,
    usageRepository,
    async close() {
      if (pgPool !== null) {
        await pgPool.end();
      }
      await sessionRuntime.close();
    }
  };
}
