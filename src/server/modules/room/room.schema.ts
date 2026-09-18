import { z } from 'zod';

// api-routes.md's route table describes this as "date, from, to" but its own
// booking schema example uses full ISO datetimes for a from/to window with
// no separate date field — this mirrors that, so "pick a slot" means the
// same thing (an ISO instant range) everywhere in the API.
export const paginationSchema = z.object({
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
export type PaginationQuery = z.infer<typeof paginationSchema>;

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

export const roomIdParamSchema = z.object({
  roomId: z.uuid(),
});

export const createRoomSchema = z.object({
  name: z.string().min(1).max(200),
  location: z.string().min(1).max(200),
  capacity: z.number().int().positive(),
  equipmentKeys: z.array(z.string().min(1)).default([]),
});

// All fields optional — PATCH updates only what's provided. At least one
// field must actually be present, otherwise there's nothing to update.
export const updateRoomSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    location: z.string().min(1).max(200).optional(),
    capacity: z.number().int().positive().optional(),
    active: z.boolean().optional(),
    equipmentKeys: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export const createEquipmentSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9_]+$/, 'lowercase letters, numbers, and underscores only'),
  label: z.string().min(1).max(200),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;
export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
