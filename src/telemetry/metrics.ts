import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('incident-tracker');

const httpRequestDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of inbound HTTP requests',
  unit: 'ms'
});

const httpRequestCount = meter.createCounter('http.server.request.count', {
  description: 'Count of inbound HTTP requests'
});

const httpErrorCount = meter.createCounter('http.server.request.errors', {
  description: 'Count of HTTP 5xx responses'
});

const dbQueryDuration = meter.createHistogram('db.client.query.duration', {
  description: 'Duration of database queries',
  unit: 'ms'
});

const dbQueryCount = meter.createCounter('db.client.query.count', {
  description: 'Count of database queries'
});

const dbQueryErrorCount = meter.createCounter('db.client.query.errors', {
  description: 'Count of failed database queries'
});

export function recordHttpRequest(attributes: Record<string, string | number>, durationMs: number): void {
  httpRequestDuration.record(durationMs, attributes);
  httpRequestCount.add(1, attributes);
}

export function recordHttpError(attributes: Record<string, string | number>): void {
  httpErrorCount.add(1, attributes);
}

export function recordDbQuery(attributes: Record<string, string | number>, durationMs: number): void {
  dbQueryDuration.record(durationMs, attributes);
  dbQueryCount.add(1, attributes);
}

export function recordDbQueryError(attributes: Record<string, string | number>): void {
  dbQueryErrorCount.add(1, attributes);
}
