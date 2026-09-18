import { ok } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';
import { paginationSchema } from '@/server/modules/room/room.schema';
import { listEquipment } from '@/server/modules/room/room.service';

// Browsing the equipment catalogue is public, like rooms — this is what the
// room search filter checkboxes are populated from (not derived from
// GET /api/rooms, so the list doesn't depend on any room actually using
// a given equipment type).
export const GET = withRoute(
  async ({ request }) => {
    const query = paginationSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    const { items, nextCursor } = await listEquipment(query);
    return ok({ data: items, meta: { nextCursor } });
  },
  { auth: 'optional' },
);
