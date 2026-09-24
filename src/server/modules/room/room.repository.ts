import { prisma } from '@/server/db/prisma';
import { ValidationError } from '@/server/http/errors';

import type { Prisma } from '@/generated/prisma/client';
import type {
  AvailabilityQuery,
  CreateEquipmentInput,
  CreateRoomInput,
  ListRoomsQuery,
  PaginationQuery,
  RoomListPagination,
  RoomSort,
  SortOrder,
  UpdateRoomInput,
} from './room.schema';

export interface EquipmentSummary {
  key: string;
  label: string;
}

export interface RoomSummary {
  id: string;
  name: string;
  location: string;
  capacity: number;
  equipment: EquipmentSummary[];
}

export interface AdminRoomSummary extends RoomSummary {
  active: boolean;
}

export interface OffsetPageMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface RoomPage extends OffsetPageMeta {
  items: RoomSummary[];
}

export interface AdminRoomPage extends OffsetPageMeta {
  items: AdminRoomSummary[];
}

// The wire-format ISO strings become real Date objects at this boundary —
// everything else about the query is exactly what the schema already
// validated, so it's derived rather than re-declared.
export type AvailabilityParams = Omit<AvailabilityQuery, 'from' | 'to'> & {
  from: Date;
  to: Date;
};

const roomSelect = {
  id: true,
  name: true,
  location: true,
  capacity: true,
  equipment: { select: { equipment: { select: { key: true, label: true } } } },
} satisfies Prisma.RoomSelect;

type RoomRow = Prisma.RoomGetPayload<{ select: typeof roomSelect }>;

function toSummary(room: RoomRow): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    location: room.location,
    capacity: room.capacity,
    equipment: room.equipment.map((link) => link.equipment),
  };
}

const adminRoomSelect = {
  id: true,
  name: true,
  location: true,
  capacity: true,
  active: true,
  equipment: { select: { equipment: { select: { key: true, label: true } } } },
} satisfies Prisma.RoomSelect;

type AdminRoomRow = Prisma.RoomGetPayload<{ select: typeof adminRoomSelect }>;

function toAdminSummary(room: AdminRoomRow): AdminRoomSummary {
  return { ...toSummary(room), active: room.active };
}

// Fetch one extra row to know whether there's a next page, then slice it
// off. Still used by equipment's keyset cursor (listEquipment below); room
// listings switched to offset pagination (paginateOffset) so their UI can
// jump straight to an arbitrary page, which a forward-only cursor can't do.
function paginateById<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: last ? last.id : null };
}

// The tiebreaker (`id`) always sorts the same direction as the chosen
// column, never a fixed `asc` — that's what lets a single compound-unique
// index (see schema.prisma) serve both directions: `capacity asc, id asc`
// is a forward scan of the (capacity, id) index, `capacity desc, id desc`
// is a backward scan of that exact same index. Mixing directions (e.g.
// `capacity desc, id asc`) would need a second, differently-ordered index
// for no real benefit at this POC's data volume. The tiebreaker itself
// also matters more here than it would under keyset pagination: without
// it, two rooms tied on the sort column could land on either side of a
// `skip`/`take` page boundary in a different order on every request.
function buildRoomOrderBy(
  sort: RoomSort,
  order: SortOrder,
): Prisma.RoomOrderByWithRelationInput[] {
  return sort === 'name'
    ? [{ name: order }, { id: order }]
    : [{ capacity: order }, { id: order }];
}

function paginateOffset<T>(
  items: T[],
  totalItems: number,
  page: number,
  pageSize: number,
): {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
} {
  return {
    items,
    page,
    pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / pageSize),
  };
}

// AND semantics: a room must have EVERY requested key, not just one of them
// — one `some` relation condition per key, all ANDed together. (An empty
// array is a no-op AND, i.e. no equipment filter at all.)
function buildEquipmentFilter(
  equipmentKeys: string[],
): Prisma.RoomWhereInput[] {
  return equipmentKeys.map((key) => ({
    equipment: { some: { equipment: { key } } },
  }));
}

export async function listRooms(query: ListRoomsQuery): Promise<RoomPage> {
  const { minCapacity, equipment, page, pageSize, sort, order } = query;

  const where: Prisma.RoomWhereInput = {
    active: true,
    AND: buildEquipmentFilter(equipment),
    ...(minCapacity !== undefined ? { capacity: { gte: minCapacity } } : {}),
  };

  const [rooms, totalItems] = await Promise.all([
    prisma.room.findMany({
      where,
      select: roomSelect,
      orderBy: buildRoomOrderBy(sort, order),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.room.count({ where }),
  ]);

  return paginateOffset(rooms.map(toSummary), totalItems, page, pageSize);
}

// Shared by createRoom/updateRoom: turns equipment keys into ids, rejecting
// any key that doesn't match a real equipment row rather than silently
// dropping it (a typo'd key should fail loudly, not disappear).
async function resolveEquipmentIds(
  client: Pick<typeof prisma, 'equipment'>,
  keys: string[],
): Promise<string[]> {
  if (keys.length === 0) return [];

  const rows = await client.equipment.findMany({
    where: { key: { in: keys } },
    select: { id: true, key: true },
  });

  const foundKeys = new Set(rows.map((row) => row.key));
  const unknownKeys = keys.filter((key) => !foundKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new ValidationError(
      `Unknown equipment key(s): ${unknownKeys.join(', ')}`,
    );
  }

  return rows.map((row) => row.id);
}

export async function createRoom(input: CreateRoomInput): Promise<RoomSummary> {
  const equipmentIds = await resolveEquipmentIds(prisma, input.equipmentKeys);

  const room = await prisma.room.create({
    data: {
      name: input.name,
      location: input.location,
      capacity: input.capacity,
      equipment: {
        createMany: {
          data: equipmentIds.map((equipmentId) => ({ equipmentId })),
        },
      },
    },
    select: roomSelect,
  });

  return toSummary(room);
}

export async function updateRoom(
  id: string,
  input: UpdateRoomInput,
): Promise<RoomSummary> {
  return prisma.$transaction(async (tx) => {
    await tx.room.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });

    if (input.equipmentKeys !== undefined) {
      const equipmentIds = await resolveEquipmentIds(tx, input.equipmentKeys);
      await tx.roomEquipment.deleteMany({ where: { roomId: id } });
      if (equipmentIds.length > 0) {
        await tx.roomEquipment.createMany({
          data: equipmentIds.map((equipmentId) => ({
            roomId: id,
            equipmentId,
          })),
        });
      }
    }

    const room = await tx.room.findUniqueOrThrow({
      where: { id },
      select: roomSelect,
    });
    return toSummary(room);
  });
}

export async function deleteRoom(id: string): Promise<void> {
  await prisma.room.delete({ where: { id } });
}

// Admin management view: every room regardless of `active`, unlike the
// public catalogue (listRooms), which only ever shows bookable rooms.
export async function listAllRoomsForAdmin(
  query: RoomListPagination,
): Promise<AdminRoomPage> {
  const { page, pageSize, sort, order } = query;

  const [rooms, totalItems] = await Promise.all([
    prisma.room.findMany({
      select: adminRoomSelect,
      orderBy: buildRoomOrderBy(sort, order),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.room.count(),
  ]);

  return paginateOffset(rooms.map(toAdminSummary), totalItems, page, pageSize);
}

// Reuses the admin select/mapper rather than a third near-identical one:
// booking creation needs to know `active` (a room shouldn't be bookable once
// taken out of the catalogue) the same way the admin view does, plus the
// same name/location/capacity/equipment fields that become the booking's
// roomSnapshot — see booking.service.ts.
export async function findRoomById(
  id: string,
): Promise<AdminRoomSummary | null> {
  const room = await prisma.room.findUnique({
    where: { id },
    select: adminRoomSelect,
  });
  return room ? toAdminSummary(room) : null;
}

// "Active or future": any CONFIRMED booking that hasn't ended yet — covers
// one already in progress (started, not yet ended) and one still upcoming.
export async function hasActiveOrFutureBookings(
  roomId: string,
): Promise<boolean> {
  const count = await prisma.booking.count({
    where: { roomId, status: 'CONFIRMED', endsAt: { gt: new Date() } },
  });
  return count > 0;
}

export async function createEquipment(
  input: CreateEquipmentInput,
): Promise<EquipmentSummary> {
  return prisma.equipment.create({
    data: input,
    select: { key: true, label: true },
  });
}

export interface EquipmentPage {
  items: EquipmentSummary[];
  nextCursor: string | null;
}

export async function listEquipment(
  query: PaginationQuery,
): Promise<EquipmentPage> {
  const { limit, cursor } = query;

  const rows = await prisma.equipment.findMany({
    select: { id: true, key: true, label: true },
    orderBy: { id: 'asc' },
    take: limit + 1,
    ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const { items, nextCursor } = paginateById(rows, limit);
  return {
    items: items.map((row) => ({ key: row.key, label: row.label })),
    nextCursor,
  };
}

export async function searchAvailableRooms(
  params: AvailabilityParams,
): Promise<RoomPage> {
  const { minCapacity, equipment, page, pageSize, sort, order, from, to } =
    params;

  const where: Prisma.RoomWhereInput = {
    active: true,
    AND: buildEquipmentFilter(equipment),
    ...(minCapacity !== undefined ? { capacity: { gte: minCapacity } } : {}),
    // Half-open [startsAt, endsAt) ranges overlap iff startsAt < to AND
    // endsAt > from — the same predicate the bookings_no_overlap exclusion
    // constraint enforces on write, expressed with plain comparisons since
    // Prisma has no equivalent of Postgres's tstzrange `&&` operator.
    bookings: {
      none: {
        status: 'CONFIRMED',
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
    },
  };

  const [rooms, totalItems] = await Promise.all([
    prisma.room.findMany({
      where,
      select: roomSelect,
      orderBy: buildRoomOrderBy(sort, order),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.room.count({ where }),
  ]);

  return paginateOffset(rooms.map(toSummary), totalItems, page, pageSize);
}
