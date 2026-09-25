import { created, ok } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';
import {
  bookingListPaginationSchema,
  createBookingSchema,
} from '@/server/modules/booking/booking.schema';
import { create, list } from '@/server/modules/booking/booking.service';

// USER only — per PROJECT.md's role split, booking is a user action; admins
// manage the room catalogue and view utilisation, they don't book rooms
// themselves. An admin session gets 403 FORBIDDEN, same as any other
// role-gated route.
export const POST = withRoute(
  async ({ request, user, requestId }) => {
    const body = createBookingSchema.parse(await request.json());
    const booking = await create({ ...body, actorId: user.id, requestId });
    return created(booking);
  },
  { role: 'USER' },
);

// Own only — filtered by session user in the WHERE clause, never fetched
// then filtered (security-and-audit.md).
export const GET = withRoute(async ({ request, user }) => {
  const query = bookingListPaginationSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  const { items, page, pageSize, totalItems, totalPages } = await list(
    user.id,
    query,
  );
  return ok({ data: items, meta: { page, pageSize, totalItems, totalPages } });
});
