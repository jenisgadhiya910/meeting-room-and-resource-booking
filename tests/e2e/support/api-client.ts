import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { BASE_URL } from './e2e-env';

// Seeded by prisma/seed.ts.
export const DEMO_PASSWORD = 'Password123!';
export const ALICE_EMAIL = 'alice@example.com';
export const JOHN_EMAIL = 'john@example.com';
export const ADMIN_EMAIL = 'admin@example.com';
export const ROOM_IDS = {
  alpha: 'b51e345f-28a3-49a7-a0c5-4c8bef759786',
  beta: '3c8fa20d-5c38-4531-80ac-f997ef001f6f',
  gamma: '375f5f22-c879-43aa-9453-ae4e09717507',
  delta: 'f5d708d0-c2f0-4940-9e8b-338cdc5b482e',
} as const;
export const SEEDED_ROOM_COUNT = 104;

export interface ApiResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  cookie?: string;
  headers?: Record<string, string>;
}

export async function api(
  path: string,
  request: ApiRequest = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { ...request.headers };
  if (request.body !== undefined) headers['Content-Type'] = 'application/json';
  if (request.cookie !== undefined) headers.Cookie = request.cookie;

  const response = await fetch(`${BASE_URL}${path}`, {
    method: request.method ?? 'GET',
    headers,
    ...(request.body !== undefined
      ? { body: JSON.stringify(request.body) }
      : {}),
  });

  const text = await response.text();
  const body: unknown = text === '' ? null : JSON.parse(text);
  return { status: response.status, headers: response.headers, body };
}

// The login rate limit keys on x-forwarded-for. A fresh value per login keeps
// the suite's many logins from tripping it; the rate-limit test opts out by
// passing its own fixed value.
export function uniqueClientIp(): string {
  return `e2e-${randomUUID()}`;
}

export async function loginResponse(
  email: string,
  password = DEMO_PASSWORD,
  clientIp = uniqueClientIp(),
): Promise<ApiResponse> {
  return api('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    headers: { 'x-forwarded-for': clientIp },
  });
}

export function sessionCookieFrom(response: ApiResponse): string {
  const pair = response.headers.getSetCookie().at(0)?.split(';')[0];
  if (pair === undefined) throw new Error('Response did not set a cookie');
  return pair;
}

export async function login(email: string): Promise<string> {
  const response = await loginResponse(email);
  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: HTTP ${response.status}`);
  }
  return sessionCookieFrom(response);
}

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export function errorOf(response: ApiResponse): ErrorEnvelope['error'] {
  return errorEnvelopeSchema.parse(response.body).error;
}

export const bookingSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid().nullable(),
  userId: z.uuid(),
  seriesId: z.uuid().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  status: z.enum(['CONFIRMED', 'CANCELLED']),
  cancelledAt: z.iso.datetime().nullable(),
  roomSnapshot: z.object({
    name: z.string(),
    location: z.string(),
    capacity: z.number().int(),
    equipment: z.array(z.object({ key: z.string(), label: z.string() })),
  }),
});

export type BookingBody = z.infer<typeof bookingSchema>;

export const pageMetaSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  totalItems: z.number().int(),
  totalPages: z.number().int(),
});

export function pageOf<T extends z.ZodType>(
  response: ApiResponse,
  itemSchema: T,
): { data: z.infer<T>[]; meta: z.infer<typeof pageMetaSchema> } {
  return z
    .object({ data: z.array(itemSchema), meta: pageMetaSchema })
    .parse(response.body);
}
