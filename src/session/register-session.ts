import type { Express } from 'express';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { createClient, type RedisClientType } from 'redis';

import { AppError } from '../errors/app-error.js';
import type { Env } from '../config/env.js';

export interface SessionRuntime {
  close(): Promise<void>;
}

async function createRedisStore(env: Env): Promise<{ store: RedisStore; client: RedisClientType }> {
  if (typeof env.REDIS_URL !== 'string' || env.REDIS_URL.length === 0) {
    throw new AppError(500, 'CONFIG_INVALID', 'REDIS_URL is required when SESSION_STORE=redis.');
  }

  const client: RedisClientType = createClient({
    url: env.REDIS_URL
  });

  await client.connect();
  return {
    store: new RedisStore({ client, prefix: 'session:' }),
    client
  };
}

export async function registerSession(app: Express, env: Env): Promise<SessionRuntime> {
  let redisClient: RedisClientType | null = null;
  let store: session.Store;

  if (env.SESSION_STORE === 'redis') {
    const redis = await createRedisStore(env);
    redisClient = redis.client;
    store = redis.store;
  } else {
    store = new session.MemoryStore();
  }

  app.use(
    session({
      store,
      name: env.SESSION_COOKIE_NAME,
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.SESSION_COOKIE_SECURE || env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24 * 7
      }
    })
  );

  return {
    async close() {
      if (redisClient !== null) {
        await redisClient.quit();
      }
    }
  };
}