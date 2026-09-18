import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSession, requireUser } from '@/server/auth/session';
import { logger } from '@/server/logger';

import { AppError, ForbiddenError } from './errors';
import { errorResponse } from './response';

import type { SessionUser } from '@/server/auth/session';
import type { NextRequest } from 'next/server';

const REQUEST_ID_HEADER = 'x-request-id';

interface RouteContext<Params> {
  params: Promise<Params>;
}

interface HandlerArgs<Params, User> {
  request: NextRequest;
  params: Promise<Params>;
  user: User;
  requestId: string;
}

type RequiredAuthHandler<Params> = (
  args: HandlerArgs<Params, SessionUser>,
) => NextResponse | Promise<NextResponse>;
type OptionalAuthHandler<Params> = (
  args: HandlerArgs<Params, SessionUser | null>,
) => NextResponse | Promise<NextResponse>;
type NextRouteHandler<Params> = (
  request: NextRequest,
  context: RouteContext<Params>,
) => Promise<NextResponse>;

// Default type param covers routes with no dynamic segments (e.g. /api/auth/login).

/** Every mutating/ownership-checked route: resolves a session or throws UNAUTHENTICATED. */
export function withRoute<Params = Record<string, never>>(
  handler: RequiredAuthHandler<Params>,
): NextRouteHandler<Params>;
/** Admin-only routes: resolves a session and requires role ADMIN, or throws FORBIDDEN. */
export function withRoute<Params = Record<string, never>>(
  handler: RequiredAuthHandler<Params>,
  options: { role: 'ADMIN' },
): NextRouteHandler<Params>;
/** Public/browsable routes that still want the session when one happens to be present. */
export function withRoute<Params = Record<string, never>>(
  handler: OptionalAuthHandler<Params>,
  options: { auth: 'optional' },
): NextRouteHandler<Params>;
export function withRoute<Params>(
  handler: RequiredAuthHandler<Params> | OptionalAuthHandler<Params>,
  options?: { auth?: 'optional'; role?: 'ADMIN' },
): NextRouteHandler<Params> {
  const authOptional = options?.auth === 'optional';

  return async (request, context) => {
    const requestId = request.headers.get(REQUEST_ID_HEADER) ?? randomUUID();
    const { pathname } = request.nextUrl;

    try {
      const user = authOptional ? await getSession() : await requireUser();

      // Reuses the same session requireUser() already resolved — no separate role lookup.
      if (
        options?.role !== undefined &&
        (!user || user.role !== options.role)
      ) {
        throw new ForbiddenError();
      }

      const response = authOptional
        ? await (handler as OptionalAuthHandler<Params>)({
            request,
            params: context.params,
            user,
            requestId,
          })
        : await (handler as RequiredAuthHandler<Params>)({
            request,
            params: context.params,
            user: user as SessionUser,
            requestId,
          });

      response.headers.set(REQUEST_ID_HEADER, requestId);
      logger.info(
        {
          requestId,
          userId: user?.id,
          method: request.method,
          path: pathname,
          status: response.status,
        },
        'request completed',
      );
      return response;
    } catch (error: unknown) {
      const response = toErrorResponse(error);
      response.headers.set(REQUEST_ID_HEADER, requestId);

      const logContext = {
        requestId,
        method: request.method,
        path: pathname,
        status: response.status,
      };
      if (response.status >= 500) {
        logger.error({ ...logContext, err: error }, 'request failed');
      } else {
        logger.warn(logContext, 'request failed');
      }

      return response;
    }
  };
}

function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return errorResponse(
      error.status,
      error.code,
      error.message,
      error.details,
    );
  }

  if (error instanceof z.ZodError) {
    return errorResponse(
      400,
      'VALIDATION_FAILED',
      'Validation failed',
      z.flattenError(error),
    );
  }

  return errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong');
}
