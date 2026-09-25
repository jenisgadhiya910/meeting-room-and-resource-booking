// Shared by the verification scripts under scripts/ (verify-concurrency.ts,
// verify-ownership.ts) — both need a session for a seeded user and a room
// to book against, and that's not worth duplicating a second time now that
// there are two of them.

import type { LoginInput } from '@/server/modules/auth/auth.schema';

export const BASE_URL = process.env.APP_URL ?? 'http://localhost:3000';
export const DEMO_PASSWORD = 'Password123!';
export const USER_A_EMAIL = 'alice@example.com';
export const USER_B_EMAIL = 'john@example.com';

interface ErrorEnvelope {
  error: { code: string; message: string };
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null || !('error' in value))
    return false;
  const { error } = value as { error: unknown };
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

export function errorCodeOf(body: unknown): string | null {
  return isErrorEnvelope(body) ? body.error.code : null;
}

export async function login(email: string): Promise<string> {
  const loginBody: LoginInput = { email, password: DEMO_PASSWORD };
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(loginBody),
  });

  if (!response.ok) {
    const json: unknown = await response.json().catch(() => null);
    throw new Error(
      `Login failed for ${email}: HTTP ${response.status} ${errorCodeOf(json) ?? ''}`,
    );
  }

  // The route sets exactly one cookie (the session JWT) — see
  // src/server/auth/session.ts. Only the "name=value" pair belongs in a
  // Cookie request header, not the Path/HttpOnly/SameSite attributes
  // Set-Cookie also carries.
  const setCookie = response.headers.getSetCookie().at(0);
  if (setCookie === undefined) {
    throw new Error(`Login for ${email} did not set a session cookie`);
  }
  const cookiePair = setCookie.split(';')[0];
  if (cookiePair === undefined) {
    throw new Error(`Could not parse session cookie for ${email}`);
  }
  return cookiePair;
}

export async function fetchRoomId(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/rooms`);
  if (!response.ok) {
    throw new Error(`Failed to list rooms: HTTP ${response.status}`);
  }

  const json: unknown = await response.json();
  const rooms = (json as { data?: unknown }).data;
  if (!Array.isArray(rooms) || rooms.length === 0) {
    throw new Error(
      'No rooms found — run `yarn db:seed` against the target database first.',
    );
  }
  const room = rooms[0] as { id?: unknown };
  if (typeof room.id !== 'string') {
    throw new Error('Unexpected shape from GET /api/rooms');
  }
  return room.id;
}
