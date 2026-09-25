import { noContent, ok } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';
import {
  bookingIdParamSchema,
  shortenBookingSchema,
} from '@/server/modules/booking/booking.schema';
import {
  cancel,
  getById,
  shorten,
} from '@/server/modules/booking/booking.service';

interface RouteParams {
  bookingId: string;
}

export const GET = withRoute<RouteParams>(async ({ params, user }) => {
  const { bookingId } = bookingIdParamSchema.parse(await params);
  const booking = await getById(bookingId, user.id);
  return ok(booking);
});

// Shorten only — endsAt must move earlier. See booking.service.ts for the
// full set of time/status rules.
export const PATCH = withRoute<RouteParams>(
  async ({ request, params, user, requestId }) => {
    const { bookingId } = bookingIdParamSchema.parse(await params);
    const body = shortenBookingSchema.parse(await request.json());
    const booking = await shorten(bookingId, user.id, body, requestId);
    return ok(booking);
  },
);

// Cancels this one occurrence — never a hard delete, see
// booking-domain.md. 204, matching admin room delete's convention for a
// mutation with nothing further to say beyond "done".
export const DELETE = withRoute<RouteParams>(
  async ({ params, user, requestId }) => {
    const { bookingId } = bookingIdParamSchema.parse(await params);
    await cancel(bookingId, user.id, requestId);
    return noContent();
  },
);
