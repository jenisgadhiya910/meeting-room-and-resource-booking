import { created } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';
import { createEquipmentSchema } from '@/server/modules/room/room.schema';
import { createEquipment } from '@/server/modules/room/room.service';

export const POST = withRoute(
  async ({ request }) => {
    const body = createEquipmentSchema.parse(await request.json());
    const equipment = await createEquipment(body);
    return created(equipment);
  },
  { role: 'ADMIN' },
);
