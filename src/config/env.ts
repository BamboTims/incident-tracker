import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  SESSION_SECRET: z.string().min(16).default('dev-session-secret-change-me'),
  SESSION_COOKIE_NAME: z.string().min(1).default('incident_tracker_sid'),
  SESSION_COOKIE_SECURE: z.coerce.boolean().default(false),
  SESSION_STORE: z.enum(['redis', 'memory']).default('redis'),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  AUTH_LOCKOUT_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_SECONDS: z.coerce.number().int().positive().default(900),
  AUTH_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  AUTH_EXPOSE_RESET_TOKEN: z.coerce.boolean().default(false)
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(overrides: Partial<Record<keyof Env, unknown>> = {}): Env {
  return envSchema.parse({
    ...process.env,
    ...overrides
  });
}
