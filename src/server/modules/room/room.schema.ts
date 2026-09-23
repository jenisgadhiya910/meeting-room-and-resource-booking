import { z } from 'zod';

// api-routes.md's route table describes this as "date, from, to" but its own
// booking schema example uses full ISO datetimes for a from/to window with
// no separate date field — this mirrors that, so "pick a slot" means the
// same thing (an ISO instant range) everywhere in the API.
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.uuid().optional(),
});

// Only these two columns have a composite-unique index pairing them with
// `id` (see schema.prisma) — originally that index backed a keyset cursor
// (see git history / docs/roadmap.md Phase 9); it still backs the ORDER BY
// below, so the sortable set stays deliberately closed rather than "any
// Room field" even though pagination itself is offset-based now.
export const roomSortSchema = z.enum(['name', 'capacity']);
export const sortOrderSchema = z.enum(['asc', 'desc']);

// Room listings paginate by page number, not a cursor: the UI needs "jump
// straight to page 7", which a forward-only keyset cursor can't do without
// walking every page in between. This is its own schema rather than an
// extension of paginationSchema above because GET /api/equipment still
// paginates by cursor (see room.repository.ts's listEquipment) and has no
// sortable column of its own — folding page/sort into the shared base
// would leak a room-specific, offset-specific concept into an unrelated
// resource that doesn't use it.
export const roomListPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(10),
  sort: roomSortSchema.default('name'),
  order: sortOrderSchema.default('asc'),
});

const roomFilterSchema = z.object({
  minCapacity: z.coerce.number().int().positive().optional(),
  equipment: z.array(z.string().min(1)).default([]),
});

export const listRoomsQuerySchema = roomListPaginationSchema.extend(
  roomFilterSchema.shape,
);

export const availabilityQuerySchema = roomListPaginationSchema
  .extend(roomFilterSchema.shape)
  .extend({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .refine((v) => new Date(v.to) > new Date(v.from), {
    message: 'to must be after from',
    path: ['to'],
  });

export type RoomSort = z.infer<typeof roomSortSchema>;
export type SortOrder = z.infer<typeof sortOrderSchema>;
export type RoomListPagination = z.infer<typeof roomListPaginationSchema>;
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
