import { createApp, type AppRuntime } from '../../src/app.js';
import { InMemoryAuthRepository } from '../../src/repositories/in-memory-auth-repository.js';

export async function createTestRuntime(): Promise<AppRuntime> {
  const repository = new InMemoryAuthRepository();

  return createApp({
    envOverrides: {
      NODE_ENV: 'test',
      SESSION_STORE: 'memory',
      SESSION_SECRET: 'test-session-secret-value',
      AUTH_EXPOSE_RESET_TOKEN: true,
      INVITES_EXPOSE_TOKEN: true,
      AUTH_LOCKOUT_ATTEMPTS: 3,
      AUTH_LOCKOUT_SECONDS: 60,
      SESSION_COOKIE_SECURE: false
    },
    authRepository: repository
  });
}
