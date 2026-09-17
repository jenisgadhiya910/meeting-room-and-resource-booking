// The full status/code vocabulary the API ever returns, per api-routes.md's
// mapping table. withRoute catches these and turns them into the error
// envelope; everything else becomes a 500 INTERNAL_ERROR.
export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    if (details !== undefined) this.details = details;
  }
}

export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = 'VALIDATION_FAILED';

  constructor(message = 'Validation failed', details?: unknown) {
    super(message, details);
  }
}

export class UnauthenticatedError extends AppError {
  readonly status = 401;
  readonly code = 'UNAUTHENTICATED';

  constructor(message = 'Authentication required') {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = 'FORBIDDEN';

  constructor(message = 'You do not have access to this resource') {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = 'NOT_FOUND';

  constructor(resource: string) {
    super(`${resource} not found`);
  }
}

// Covers ROOM_ALREADY_BOOKED and BOOKING_NOT_MODIFIABLE — every 409 shares a
// status but carries a different code, so the code is a constructor param
// rather than a fixed class field.
export class ConflictError extends AppError {
  readonly status = 409;
  readonly code: string;

  constructor(code: string, message: string, details?: unknown) {
    super(message, details);
    this.code = code;
  }
}

// Not in api-routes.md's table — added for the login rate limit that
// security-and-audit.md requires. 429 is the standard status for this.
export class RateLimitedError extends AppError {
  readonly status = 429;
  readonly code = 'RATE_LIMITED';

  constructor(message = 'Too many attempts, try again later') {
    super(message);
  }
}
