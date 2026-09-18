import { z } from 'zod';

// api-routes.md's route table describes this as "date, from, to" but its own
// booking schema example uses full ISO datetimes for a from/to window with
// no separate date field — this mirrors that, so "pick a slot" means the
// same thing (an ISO instant range) everywhere in the API.
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.uuid().optional(),
});

const roomFilterSchema = z.object({
  minCapacity: z.coerce.number().int().positive().optional(),
  equipment: z.array(z.string().min(1)).default([]),
});

export const listRoomsQuerySchema = paginationSchema.extend(
  roomFilterSchema.shape,
);

export const availabilityQuerySchema = paginationSchema
  .extend(roomFilterSchema.shape)
  .extend({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .refine((v) => new Date(v.to) > new Date(v.from), {
    message: 'to must be after from',
    path: ['to'],
  });

export type ListRoomsQuery = z.infer<typeof listRoomsQuerySchema>;
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/**
 * `URLSearchParams` collapses repeated keys when read with `Object.fromEntries`,
 * so the multi-value `equipment` param is pulled out with `getAll` first.
 */
export function parseRoomQueryParams(
  searchParams: URLSearchParams,
): Record<string, unknown> {
  return {
    ...Object.fromEntries(searchParams),
    equipment: searchParams.getAll('equipment'),
  };
}
