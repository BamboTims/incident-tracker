import { performance } from 'node:perf_hooks';

import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';

import { recordHttpError, recordHttpRequest } from '../../telemetry/metrics.js';

const tracer = trace.getTracer('incident-tracker');

export function attachRequestTelemetry(request: Request, response: Response, next: NextFunction): void {
  const startTime = performance.now();
  const span = tracer.startSpan('http.request', {
    attributes: {
      'http.method': request.method,
      'http.route': request.path
    }
  });

  response.on('finish', () => {
    const durationMs = performance.now() - startTime;
    const authType = request.authContext?.authType ?? 'anonymous';

    const attributes: Record<string, string | number> = {
      method: request.method,
      route: request.path,
      status_code: response.statusCode,
      auth_type: authType
    };

    recordHttpRequest(attributes, durationMs);
    if (response.statusCode >= 500) {
      recordHttpError(attributes);
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.setAttribute('http.status_code', response.statusCode);
    span.setAttribute('http.duration_ms', durationMs);
    span.end();

    const traceId = typeof response.locals.traceId === 'string' ? response.locals.traceId : 'unknown-trace';
    console.log('http_request', {
      traceId,
      method: request.method,
      path: request.path,
      statusCode: response.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      authType
    });
  });

  next();
}
