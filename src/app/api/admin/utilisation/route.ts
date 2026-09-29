import { ok } from '@/server/http/response';
import { withRoute } from '@/server/http/with-route';
import { utilisationQuerySchema } from '@/server/modules/utilisation/utilisation.schema';
import { getUtilisation } from '@/server/modules/utilisation/utilisation.service';

export const GET = withRoute(
  async ({ request }) => {
    const query = utilisationQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    const { rooms, bookableWindow } = await getUtilisation(query);
    return ok({
      data: rooms,
      meta: { from: query.from, to: query.to, bookableWindow },
    });
  },
  { role: 'ADMIN' },
);
