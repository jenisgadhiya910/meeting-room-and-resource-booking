import { noContent, ok } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';
import {
  roomIdParamSchema,
  updateRoomSchema,
} from '@/server/modules/room/room.schema';
import { deleteRoom, updateRoom } from '@/server/modules/room/room.service';

interface RouteParams {
  roomId: string;
}

export const PATCH = withRoute<RouteParams>(
  async ({ request, params }) => {
    const { roomId } = roomIdParamSchema.parse(await params);
    const body = updateRoomSchema.parse(await request.json());
    const room = await updateRoom(roomId, body);
    return ok(room);
  },
  { role: 'ADMIN' },
);

export const DELETE = withRoute<RouteParams>(
  async ({ params }) => {
    const { roomId } = roomIdParamSchema.parse(await params);
    await deleteRoom(roomId);
    return noContent();
  },
  { role: 'ADMIN' },
);
