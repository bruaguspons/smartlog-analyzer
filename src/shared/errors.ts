import type { z } from 'zod';

/** Error with a stable, client-facing `code`; rendered as-is by the error handler. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(409, code, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(503, 'SERVICE_UNAVAILABLE', message, details);
  }
}

/** Same message for missing, unknown and inactive keys, so it reveals nothing. */
export class UnauthorizedError extends AppError {
  constructor() {
    super(401, 'UNAUTHORIZED', 'Invalid or missing API key');
  }
}

export class UnprocessableError extends AppError {
  constructor(code: string, message: string) {
    super(422, code, message);
  }
}

export type RequestPart = 'body' | 'querystring' | 'params';

/** 400 in the standard envelope; the message lists every issue, `details` has one item per issue. */
export class RequestValidationError extends AppError {
  constructor(part: RequestPart, issues: readonly z.core.$ZodIssue[]) {
    const details = issues.map((issue) => ({
      instancePath: `/${issue.path.join('/')}`,
      keyword: issue.code,
      message: issue.message,
    }));
    const message = details.map((d) => `${part}${d.instancePath} ${d.message}`).join(', ');
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

/** A handler produced data its own response schema rejects: a bug, answered as a generic 500. */
export class ResponseValidationError extends Error {
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(issues: readonly z.core.$ZodIssue[]) {
    super('response does not match its schema');
    this.name = 'ResponseValidationError';
    this.issues = issues;
  }
}
