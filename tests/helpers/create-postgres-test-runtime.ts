import { Pool } from 'pg';

import { createApp, type AppRuntime } from '../../src/app.js';

function resolveDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('TEST_DATABASE_URL (or DATABASE_URL) must be set for Postgres integration tests.');
  }

  return value;
}

export async function createPostgresTestRuntime(): Promise<AppRuntime> {
  const databaseUrl = resolveDatabaseUrl();

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
      DATABASE_URL: databaseUrl,
      REDIS_URL: undefined,
      OTEL_ENABLED: false
    }
  });
}

export async function resetPostgresState(): Promise<void> {
  const pool = new Pool({ connectionString: resolveDatabaseUrl() });

  try {
    await pool.query(`
      TRUNCATE TABLE
        usage_events,
        tenant_usage_quotas,
        api_keys,
        service_accounts,
        audit_log_events,
        status_updates,
        tasks,
        timeline_events,
        incident_services,
        incidents,
        tenant_invites,
        memberships,
        tenants,
        password_reset_tokens,
        users
      RESTART IDENTITY CASCADE
    `);
  } finally {
    await pool.end();
  }
}
