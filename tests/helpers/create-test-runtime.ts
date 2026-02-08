import { createApp, type AppRuntime } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { InMemoryAuditLogRepository } from '../../src/repositories/in-memory-audit-log-repository.js';
import { InMemoryAuthRepository } from '../../src/repositories/in-memory-auth-repository.js';

interface CreateTestRuntimeOptions {
  envOverrides?: Partial<Record<keyof Env, unknown>>;
}

export async function createTestRuntime(options: CreateTestRuntimeOptions = {}): Promise<AppRuntime> {
  const authRepository = new InMemoryAuthRepository();
  const auditLogRepository = new InMemoryAuditLogRepository();

  return createApp({
    envOverrides: {
      NODE_ENV: 'test',
      SESSION_STORE: 'memory',
      SESSION_SECRET: 'test-session-secret-value',
      AUTH_EXPOSE_RESET_TOKEN: true,
      INVITES_EXPOSE_TOKEN: true,
      AUTH_LOCKOUT_ATTEMPTS: 3,
      AUTH_LOCKOUT_SECONDS: 60,
      SESSION_COOKIE_SECURE: false,
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
      ...options.envOverrides
    },
    authRepository,
    auditLogRepository
  });
}
