export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    if (body.details !== undefined) this.details = body.details;
  }
}

interface ApiFetchInit extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

function isErrorEnvelope(value: unknown): value is { error: ApiErrorBody } {
  if (typeof value !== 'object' || value === null || !('error' in value))
    return false;

  const { error } = value as { error: unknown };
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code: unknown }).code === 'string' &&
    typeof (error as { message: unknown }).message === 'string'
  );
}

// z.flattenError()'s shape (see with-route.ts's ZodError branch): the first
// specific reason available, from either bucket.
function firstValidationDetail(details: unknown): string | null {
  if (typeof details !== 'object' || details === null) return null;
  const { formErrors, fieldErrors } = details as {
    formErrors?: unknown;
    fieldErrors?: unknown;
  };
  if (Array.isArray(formErrors) && typeof formErrors[0] === 'string') {
    return formErrors[0];
  }
  if (typeof fieldErrors === 'object' && fieldErrors !== null) {
    for (const value of Object.values(fieldErrors)) {
      if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    }
  }
  return null;
}

/**
 * The specific reason behind an error, not just `error.message` — for a
 * genuine zod parse failure caught by withRoute's ZodError branch,
 * `message` is always the generic "Validation failed"; the actually useful
 * text lives in `details.fieldErrors`/`formErrors` instead (api-routes.md's
 * error envelope). A service-thrown domain error (e.g. ValidationError with
 * its own message, or any other code) already has a specific `message`, so
 * this only overrides it when there's something more specific to say.
 */
export function specificMessage(error: ApiError): string {
  return firstValidationDetail(error.details) ?? error.message;
}

/**
 * Thin fetch wrapper for our own API. It only standardises the *error* side
 * of api-routes.md's envelope, since that's the one shape every route
 * shares — a success body is "the resource" or `{ data, meta }`, whichever
 * that specific endpoint documents, so callers assert it via `T` rather
 * than a shared response schema.
 */
export async function apiFetch<T>(
  path: string,
  init: ApiFetchInit = {},
): Promise<T> {
  const { body, headers, ...rest } = init;

  const response = await fetch(path, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const errorBody: ApiErrorBody = isErrorEnvelope(json)
      ? json.error
      : { code: 'INTERNAL_ERROR', message: 'Something went wrong' };
    throw new ApiError(response.status, errorBody);
  }

  return json as T;
}
