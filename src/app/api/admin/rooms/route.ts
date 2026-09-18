import { created } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';
import { createRoomSchema } from '@/server/modules/room/room.schema';
import { createRoom } from '@/server/modules/room/room.service';

export const POST = withRoute(
  async ({ request }) => {
    const body = createRoomSchema.parse(await request.json());
    const room = await createRoom(body);
    return created(room);
  },
  { role: 'ADMIN' },
);
