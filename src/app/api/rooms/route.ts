import { ok } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';
import {
  listRoomsQuerySchema,
  parseRoomQueryParams,
} from '@/server/modules/room/room.schema';
import { listRooms } from '@/server/modules/room/room.service';

// Browsing the catalogue is public.
export const GET = withRoute(
  async ({ request }) => {
    const query = listRoomsQuerySchema.parse(
      parseRoomQueryParams(request.nextUrl.searchParams),
    );
    const { items, page, pageSize, totalItems, totalPages } =
      await listRooms(query);
    return ok({
      data: items,
      meta: { page, pageSize, totalItems, totalPages },
    });
  },
  { auth: 'optional' },
);
