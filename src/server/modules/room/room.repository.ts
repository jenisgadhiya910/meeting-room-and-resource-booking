import { prisma } from '@/server/db/prisma';

import type { Prisma } from '@/generated/prisma/client';

export interface RoomSummary {
  id: string;
  name: string;
  location: string;
  capacity: number;
  equipment: { key: string; label: string }[];
}

export interface RoomPage {
  items: RoomSummary[];
  nextCursor: string | null;
}

interface BaseParams {
  minCapacity?: number | undefined;
  equipmentKeys: string[];
  limit: number;
  cursor?: string | undefined;
}

export interface AvailabilityParams extends BaseParams {
  from: Date;
  to: Date;
}

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

// Fetch one extra row to know whether there's a next page, then slice it off.
function paginate(rows: RoomSummary[], limit: number): RoomPage {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: last ? last.id : null };
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

export async function listRooms(params: BaseParams): Promise<RoomPage> {
  const { minCapacity, equipmentKeys, limit, cursor } = params;

  const where: Prisma.RoomWhereInput = {
    active: true,
    AND: buildEquipmentFilter(equipmentKeys),
    ...(minCapacity !== undefined ? { capacity: { gte: minCapacity } } : {}),
  };

  const rooms = await prisma.room.findMany({
    where,
    select: roomSelect,
    orderBy: { id: 'asc' },
    take: limit + 1,
    ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  return paginate(rooms.map(toSummary), limit);
}

export async function searchAvailableRooms(
  params: AvailabilityParams,
): Promise<RoomPage> {
  const { minCapacity, equipmentKeys, limit, cursor, from, to } = params;

  const where: Prisma.RoomWhereInput = {
    active: true,
    AND: buildEquipmentFilter(equipmentKeys),
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

  const rooms = await prisma.room.findMany({
    where,
    select: roomSelect,
    orderBy: { id: 'asc' },
    take: limit + 1,
    ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  return paginate(rooms.map(toSummary), limit);
}
