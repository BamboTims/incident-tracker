import { performance } from 'node:perf_hooks';

import type { Pool, PoolClient } from 'pg';

import { recordDbQuery, recordDbQueryError } from './metrics.js';

type Queryable = {
  query: (...args: unknown[]) => Promise<unknown>;
};

function wrapQueryableQuery(target: Queryable, component: 'pool' | 'client'): void {
  const originalQuery = target.query.bind(target);

  target.query = async (...args: unknown[]): Promise<unknown> => {
    const startedAt = performance.now();
    try {
      const result = await originalQuery(...args);
      const durationMs = performance.now() - startedAt;

      recordDbQuery({
        component,
        success: 'true'
      }, durationMs);

      return result;
    } catch (error) {
      const durationMs = performance.now() - startedAt;
      recordDbQuery({
        component,
        success: 'false'
      }, durationMs);
      recordDbQueryError({
        component
      });

      throw error;
    }
  };
}

function wrapClient(client: PoolClient): PoolClient {
  const mutableClient = client as PoolClient & { __telemetryWrapped?: boolean };
  if (mutableClient.__telemetryWrapped === true) {
    return client;
  }

  wrapQueryableQuery(mutableClient, 'client');
  mutableClient.__telemetryWrapped = true;
  return client;
}

export function instrumentPgPool(pool: Pool): void {
  const mutablePool = pool as Pool & { __telemetryWrapped?: boolean };
  if (mutablePool.__telemetryWrapped === true) {
    return;
  }

  wrapQueryableQuery(mutablePool as unknown as Queryable, 'pool');

  const mutablePoolConnect = pool as unknown as {
    connect: (...args: unknown[]) => unknown;
  };
  const originalConnect = mutablePoolConnect.connect.bind(pool);

  mutablePoolConnect.connect = (...args: unknown[]): unknown => {
    if (typeof args[0] === 'function') {
      const callback = args[0] as (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void;
      return originalConnect((err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => {
        callback(err, client === undefined ? undefined : wrapClient(client), done);
      });
    }

    const promise = originalConnect() as Promise<PoolClient>;
    return promise.then((client) => wrapClient(client));
  };

  mutablePool.__telemetryWrapped = true;
}
