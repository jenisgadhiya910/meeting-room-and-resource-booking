import { ok } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';
import {
  availabilityQuerySchema,
  parseRoomQueryParams,
} from '@/server/modules/room/room.schema';
import { searchAvailableRooms } from '@/server/modules/room/room.service';

// Browsing availability is public — booking itself (Phase 7) requires auth.
export const GET = withRoute(
  async ({ request }) => {
    const query = availabilityQuerySchema.parse(
      parseRoomQueryParams(request.nextUrl.searchParams),
    );
    const { items, page, pageSize, totalItems, totalPages } =
      await searchAvailableRooms(query);
    return ok({
      data: items,
      meta: { page, pageSize, totalItems, totalPages },
    });
  },
  { auth: 'optional' },
);
