import { cookies } from 'next/headers';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

import { env } from '@/server/env';
import { Role } from '@/generated/prisma/enums';
import { UnauthenticatedError } from '@/server/http/errors';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
}

const SESSION_COOKIE_NAME = 'session';
// 7 days: long enough that a session survives a review sitting, short enough
// that a leaked cookie doesn't stay valid indefinitely. There's no signup
// flow or "remember me" toggle in this POC, so one fixed TTL for everyone.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const JWT_ALG = 'HS256';

const secretKey = new TextEncoder().encode(env.SESSION_SECRET);

const sessionPayloadSchema = z.object({
  sub: z.uuid(),
  email: z.email(),
  role: z.enum(Role),
});

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey);
}

async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: [JWT_ALG],
    });
    const parsed = sessionPayloadSchema.safeParse(payload);
    if (!parsed.success) return null;
    return {
      id: parsed.data.sub,
      email: parsed.data.email,
      role: parsed.data.role,
    };
  } catch {
    // Expired, malformed, or signature mismatch are all equally "no session" —
    // never distinguish them for the caller.
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
