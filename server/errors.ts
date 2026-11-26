import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface StructuredErrorPayload {
  error: string;
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown>;
}

export class AppApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sendJsonError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): void {
  const payload: StructuredErrorPayload = {
    error: code,
    code,
    message,
    status,
    ...(details ? { details } : {}),
  };
  res.status(status).json(payload);
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next);
  };
}

function sanitizePgConstraintMessage(raw: string): string {
  let msg = raw
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[redacted-url]')
    .replace(/\b(user|role)\s+"[^"]+"/gi, '$1 "[redacted]"')
    .replace(/\s+/g, ' ')
    .trim();
  if (!msg) return 'Database validation error.';
  return msg.slice(0, 260);
}

/**
 * Maps PostgreSQL SQLSTATE codes cleanly to HTTP errors without leaking secrets or connection strings.
 */
export function mapPgErrorToAppError(err: unknown): AppApiError {
  if (err instanceof AppApiError) {
    return err;
  }

  const pgCode =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  const rawMessage =
    err instanceof Error && err.message ? err.message : '';

  if (pgCode === '42501') {
    return new AppApiError(
      403,
      'PERMISSION_DENIED',
      'Your database role lacks permission for the requested operation.'
    );
  }

  if (pgCode === '22023') {
    return new AppApiError(
      400,
      'INVALID_ARGUMENT',
      sanitizePgConstraintMessage(rawMessage) || 'Invalid parameter value supplied.'
    );
  }

  if (
    pgCode === '23502' ||
    pgCode === '23503' ||
    pgCode === '23505' ||
    pgCode === '23514' ||
    pgCode === '23P01' ||
    pgCode === 'P0001'
  ) {
    const cleanMsg =
      sanitizePgConstraintMessage(rawMessage) ||
      'Record violates a database constraint.';
    if (
      pgCode === 'P0001' &&
      /historical_synthetic|read-only/i.test(cleanMsg)
    ) {
      return new AppApiError(403, 'READ_ONLY_RECORD', cleanMsg);
    }
    return new AppApiError(422, 'CONSTRAINT_VIOLATION', cleanMsg);
  }

  if (
    pgCode === 'ECONNREFUSED' ||
    pgCode === 'ENOTFOUND' ||
    pgCode === 'EAI_AGAIN' ||
    pgCode === 'ENETUNREACH' ||
    pgCode === 'EHOSTUNREACH' ||
    pgCode === 'ETIMEDOUT' ||
    pgCode === 'ECONNRESET' ||
    pgCode === '28P01' ||
    pgCode === '28000' ||
    pgCode === '3D000' ||
    pgCode === '42P01' ||
    pgCode === '42883' ||
    pgCode === '42703' ||
    /timeout/i.test(rawMessage)
  ) {
    return new AppApiError(
      503,
      'DB_UNAVAILABLE',
      'PostgreSQL database is currently unreachable or unavailable.'
    );
  }

  return new AppApiError(
    503,
    'DB_QUERY_FAILED',
    'A database query error occurred.'
  );
}

export function apiErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) {
    return;
  }

  if (err instanceof AppApiError) {
    sendJsonError(res, err.status, err.code, err.message, err.details);
    return;
  }

  if (
    err instanceof SyntaxError &&
    'status' in err &&
    (err as unknown as { status?: unknown }).status === 400
  ) {
    sendJsonError(
      res,
      400,
      'INVALID_JSON',
      'Request body is not valid JSON.'
    );
    return;
  }

  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string'
  ) {
    const mapped = mapPgErrorToAppError(err);
    sendJsonError(res, mapped.status, mapped.code, mapped.message, mapped.details);
    return;
  }

  // Never leak stack traces, database internals, or environment secrets.
  console.error('[api] Unexpected internal error');
  sendJsonError(
    res,
    500,
    'INTERNAL_ERROR',
    'An unexpected server error occurred.'
  );
}
