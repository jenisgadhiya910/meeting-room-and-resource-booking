import { sessionUserSchema, setSessionCookie } from '@/server/auth/session';
import { RateLimitedError } from '@/server/http/errors';
import { ok } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';
import { loginSchema } from '@/server/modules/auth/auth.schema';
import { checkLoginRateLimit } from '@/server/modules/auth/rate-limit';
import { login } from '@/server/modules/auth/auth.service';

export const POST = withRoute(
  async ({ request }) => {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown';
    if (!checkLoginRateLimit(ip)) throw new RateLimitedError();

    const body = loginSchema.parse(await request.json());
    const { token, user } = await login(body);
    await setSessionCookie(token);

    // Re-parsed at the response boundary, not just trusted from the service:
    // strips anything beyond id/email/role (e.g. passwordHash) even if a
    // future bug ever attached it.
    return ok({ user: sessionUserSchema.parse(user) });
  },
  { auth: 'optional' },
);
