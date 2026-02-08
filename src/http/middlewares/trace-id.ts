import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export function attachTraceId(_request: Request, response: Response, next: NextFunction): void {
  const traceId = randomUUID();
  response.locals.traceId = traceId;
  response.setHeader('x-trace-id', traceId);
  next();
}
