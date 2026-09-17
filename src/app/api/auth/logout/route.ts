import { clearSessionCookie } from '@/server/auth/session';
import { ok } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';

// Optional auth: logging out with an already-expired or missing session
// still succeeds — clearing a cookie that isn't there is a no-op, not an error.
export const POST = withRoute(
  async () => {
    await clearSessionCookie();
    return ok({ loggedOut: true });
  },
  { auth: 'optional' },
);
