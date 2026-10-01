import { describe, expect, it } from 'vitest';

import {
  ADMIN_EMAIL,
  ALICE_EMAIL,
  api,
  errorOf,
  login,
  loginResponse,
  sessionCookieFrom,
  uniqueClientIp,
} from './support/api-client';

describe('POST /api/auth/login', () => {
  it('sets a session cookie and returns only id, email and role', async () => {
    const response = await loginResponse(ALICE_EMAIL);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: { id: expect.any(String), email: ALICE_EMAIL, role: 'USER' },
    });
    const setCookie = response.headers.getSetCookie().at(0) ?? '';
    expect(setCookie).toMatch(/^session=/);
    expect(setCookie.toLowerCase()).toContain('httponly');
  });

  it('gives a wrong password and an unknown email the same 401', async () => {
    const wrongPassword = await loginResponse(ALICE_EMAIL, 'not-the-password');
    const unknownUser = await loginResponse('nobody@example.com');

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(errorOf(wrongPassword)).toEqual(errorOf(unknownUser));
    expect(errorOf(wrongPassword).code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed body with 400 before checking credentials', async () => {
    const response = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'not-an-email' },
      headers: { 'x-forwarded-for': uniqueClientIp() },
    });

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });

  it('rate-limits a sixth attempt from the same client within a minute', async () => {
    const clientIp = uniqueClientIp();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await loginResponse(ALICE_EMAIL, 'wrong', clientIp);
      expect(response.status).toBe(401);
    }

    const blocked = await loginResponse(ALICE_EMAIL, undefined, clientIp);

    expect(blocked.status).toBe(429);
    expect(errorOf(blocked).code).toBe('RATE_LIMITED');
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a session', async () => {
    const response = await api('/api/auth/me');

    expect(response.status).toBe(401);
    expect(errorOf(response).code).toBe('UNAUTHENTICATED');
  });

  it('returns the signed-in user', async () => {
    const cookie = await login(ADMIN_EMAIL);

    const response = await api('/api/auth/me', { cookie });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      user: { email: ADMIN_EMAIL, role: 'ADMIN' },
    });
  });

  it('treats a tampered token as no session', async () => {
    const cookie = await login(ALICE_EMAIL);

    const response = await api('/api/auth/me', { cookie: `${cookie}x` });

    expect(response.status).toBe(401);
  });

  it('echoes a caller-supplied request id', async () => {
    const response = await api('/api/auth/me', {
      headers: { 'x-request-id': 'e2e-request-id' },
    });

    expect(response.headers.get('x-request-id')).toBe('e2e-request-id');
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const cookie = await login(ALICE_EMAIL);

    const response = await api('/api/auth/logout', { method: 'POST', cookie });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ loggedOut: true });
    expect(sessionCookieFrom(response)).toBe('session=');
  });

  it('succeeds without a session', async () => {
    const response = await api('/api/auth/logout', { method: 'POST' });

    expect(response.status).toBe(200);
  });
});
