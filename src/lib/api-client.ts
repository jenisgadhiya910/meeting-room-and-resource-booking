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
