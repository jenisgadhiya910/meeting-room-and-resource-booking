import { ok, created } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';
import {
  createRoomSchema,
  roomListPaginationSchema,
} from '@/server/modules/room/room.schema';
import {
  createRoom,
  listAllRoomsForAdmin,
} from '@/server/modules/room/room.service';

// Admin management listing: every room regardless of `active`, unlike the
// public GET /api/rooms catalogue.
export const GET = withRoute(
  async ({ request }) => {
    const query = roomListPaginationSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    const { items, nextCursor } = await listAllRoomsForAdmin(query);
    return ok({ data: items, meta: { nextCursor } });
  },
  { role: 'ADMIN' },
);

export const POST = withRoute(
  async ({ request }) => {
    const body = createRoomSchema.parse(await request.json());
    const room = await createRoom(body);
    return created(room);
  },
  { role: 'ADMIN' },
);
