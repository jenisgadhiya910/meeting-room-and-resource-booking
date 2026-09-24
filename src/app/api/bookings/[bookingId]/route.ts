import { ok } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';
import { bookingIdParamSchema } from '@/server/modules/booking/booking.schema';
import { getById } from '@/server/modules/booking/booking.service';

interface RouteParams {
  bookingId: string;
}

export const GET = withRoute<RouteParams>(async ({ params, user }) => {
  const { bookingId } = bookingIdParamSchema.parse(await params);
  const booking = await getById(bookingId, user.id);
  return ok(booking);
});
