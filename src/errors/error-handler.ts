import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { AppError } from './app-error.js';

interface ErrorBody {
  code: string;
  message: string;
  traceId: string;
  details?: unknown;
}

export function errorHandler(error: unknown, _request: Request, response: Response, next: NextFunction): void {
  if (response.headersSent) {
    next(error);
    return;
  }

  const traceId = typeof response.locals.traceId === 'string' ? response.locals.traceId : 'unknown-trace';

  if (error instanceof AppError) {
    const payload: ErrorBody = {
      code: error.code,
      message: error.message,
      traceId
    };

    if (error.details !== undefined) {
      payload.details = error.details;
    }

    response.status(error.statusCode).json(payload);
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      traceId,
      details: error.flatten()
    } satisfies ErrorBody);
    return;
  }

  response.status(500).json({
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
    traceId
  } satisfies ErrorBody);
}
