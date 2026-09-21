import { z } from 'zod';

import { Prisma } from '@/generated/prisma/client';
import { NotFoundError } from '@/server/http/errors';

import {
  EquipmentKeyTakenError,
  RoomHasActiveOrFutureBookingsError,
  RoomNameTakenError,
} from './room.errors';
import {
  createEquipment as createEquipmentRepo,
  createRoom as createRoomRepo,
  deleteRoom as deleteRoomRepo,
  hasActiveOrFutureBookings,
  listAllRoomsForAdmin as listAllRoomsForAdminRepo,
  listEquipment as listEquipmentRepo,
  listRooms as listRoomsRepo,
  searchAvailableRooms as searchAvailableRoomsRepo,
  updateRoom as updateRoomRepo,
} from './room.repository';

import type {
  AdminRoomPage,
  EquipmentPage,
  EquipmentSummary,
  RoomPage,
  RoomSummary,
} from './room.repository';
import type {
  AvailabilityQuery,
  CreateEquipmentInput,
  CreateRoomInput,
  ListRoomsQuery,
  PaginationQuery,
  UpdateRoomInput,
} from './room.schema';

export async function listRooms(query: ListRoomsQuery): Promise<RoomPage> {
  return listRoomsRepo(query);
}

export async function searchAvailableRooms(
  query: AvailabilityQuery,
): Promise<RoomPage> {
  // The only real transformation at this boundary: wire-format ISO strings
  // become the Date objects the repository's Prisma comparisons need.
  return searchAvailableRoomsRepo({
    ...query,
    from: new Date(query.from),
    to: new Date(query.to),
  });
}

// Prisma 7 + the @prisma/adapter-pg driver adapter does NOT report P2002's
// meta the way most Prisma docs describe (a flat `{ target: string[] }` of
// column names, from the classic Rust query engine). Confirmed by hand
// against this exact stack: it nests the constraint name under
// `driverAdapterError.cause.constraint.index` instead — the index name
// (e.g. "rooms_name_key"), not a column list.
const driverAdapterUniqueViolationMetaSchema = z.object({
  driverAdapterError: z.object({
    cause: z.object({
      constraint: z.object({ index: z.string() }),
    }),
  }),
});

function violatedUniqueConstraint(error: unknown): string | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  )
    return null;
  const parsed = driverAdapterUniqueViolationMetaSchema.safeParse(error.meta);
  return parsed.success
    ? parsed.data.driverAdapterError.cause.constraint.index
    : null;
}

function isRecordNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  );
}

export async function createRoom(input: CreateRoomInput): Promise<RoomSummary> {
  try {
    return await createRoomRepo(input);
  } catch (error: unknown) {
    if (violatedUniqueConstraint(error) === 'rooms_name_key')
      throw new RoomNameTakenError(input.name);
    throw error;
  }
}

export async function updateRoom(
  roomId: string,
  input: UpdateRoomInput,
): Promise<RoomSummary> {
  if (await hasActiveOrFutureBookings(roomId))
    throw new RoomHasActiveOrFutureBookingsError();

  try {
    return await updateRoomRepo(roomId, input);
  } catch (error: unknown) {
    if (isRecordNotFound(error)) throw new NotFoundError('Room');
    if (violatedUniqueConstraint(error) === 'rooms_name_key')
      throw new RoomNameTakenError(input.name ?? roomId);
    throw error;
  }
}

export async function deleteRoom(roomId: string): Promise<void> {
  if (await hasActiveOrFutureBookings(roomId))
    throw new RoomHasActiveOrFutureBookingsError();

  try {
    await deleteRoomRepo(roomId);
  } catch (error: unknown) {
    if (isRecordNotFound(error)) throw new NotFoundError('Room');
    throw error;
  }
}

export async function listAllRoomsForAdmin(
  query: PaginationQuery,
): Promise<AdminRoomPage> {
  return listAllRoomsForAdminRepo(query);
}

export async function createEquipment(
  input: CreateEquipmentInput,
): Promise<EquipmentSummary> {
  try {
    return await createEquipmentRepo(input);
  } catch (error: unknown) {
    if (violatedUniqueConstraint(error) === 'equipment_key_key')
      throw new EquipmentKeyTakenError(input.key);
    throw error;
  }
}

export async function listEquipment(
  query: PaginationQuery,
): Promise<EquipmentPage> {
  return listEquipmentRepo(query);
}
