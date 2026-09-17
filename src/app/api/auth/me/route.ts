import { ok } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';

// Auth required (the default): doubles as the deliberately-protected route
// that proves withRoute 401s a request with no valid session cookie.
export const GET = withRoute(({ user }) => ok({ user }));
