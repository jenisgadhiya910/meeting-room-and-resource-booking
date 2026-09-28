import { noContent } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';
import { seriesIdParamSchema } from '@/server/modules/booking/booking.schema';
import { cancelSeries } from '@/server/modules/booking/booking.service';

interface RouteParams {
  seriesId: string;
}

// Cancels the remaining future occurrences only — past and already-ended
// ones are left intact, and DELETE /api/bookings/:id remains the way to
// cancel a single occurrence without touching the rest of the series
// (booking-domain.md). 204, matching the single-booking cancel convention.
export const DELETE = withRoute<RouteParams>(
  async ({ params, user, requestId }) => {
    const { seriesId } = seriesIdParamSchema.parse(await params);
    await cancelSeries(seriesId, user.id, requestId);
    return noContent();
  },
);
