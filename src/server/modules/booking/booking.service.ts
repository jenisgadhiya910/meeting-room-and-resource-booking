import { z } from 'zod';

import { Prisma } from '@/generated/prisma/client';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/server/http/errors';
import { getRoomById } from '@/server/modules/room/room.service';

import { RoomAlreadyBookedError } from './booking.errors';
import {
  createBooking as createBookingRepo,
  findById as findByIdRepo,
  findConflictingBookings,
  listByUser as listByUserRepo,
  writeRejectedOverlapAudit,
} from './booking.repository';

import type { BookingListPage, BookingSummary } from './booking.repository';
import type { CreateBookingInput, ListBookingsQuery } from './booking.schema';

const PG_EXCLUSION_VIOLATION = '23P01';
const OVERLAP_CONSTRAINT_NAME = 'bookings_no_overlap';

// Prisma 7 + the @prisma/adapter-pg driver adapter has no structured
// mapping for SQLSTATE 23P01 (exclusion_violation) the way it does for
// 23505 (unique_violation -> P2002, see room.service.ts). Confirmed by
// hand against this exact stack: an unmapped Postgres error falls through
// to the adapter's generic "postgres" fallback kind and surfaces as a
// PrismaClientKnownRequestError with code P2039, the raw SQLSTATE under
// `meta.driverAdapterError.cause.originalCode`. The violated constraint's
// name isn't structured in that fallback either — it only appears in the
// free-text message — so detection anchors on the SQLSTATE (23P01 is
// exclusively the exclusion-violation class; nothing else in Postgres uses
// it) and additionally confirms the message names bookings_no_overlap,
// rather than trusting the message text as the primary signal.
const driverAdapterPostgresErrorMetaSchema = z.object({
  driverAdapterError: z.object({
    cause: z.object({
      originalCode: z.string(),
      message: z.string(),
    }),
  }),
});

function isOverlapViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2039'
  )
    return false;

  const parsed = driverAdapterPostgresErrorMetaSchema.safeParse(error.meta);
  if (!parsed.success) return false;

  const { originalCode, message } = parsed.data.driverAdapterError.cause;
  return (
    originalCode === PG_EXCLUSION_VIOLATION &&
    message.includes(OVERLAP_CONSTRAINT_NAME)
  );
}

export interface CreateBookingParams extends CreateBookingInput {
  actorId: string;
  requestId: string;
}

export async function create(
  params: CreateBookingParams,
): Promise<BookingSummary> {
  // Not a pre-validation query — the room's current name/location/capacity/
  // equipment are genuinely needed for roomSnapshot, so this fetch earns its
  // keep beyond just checking existence (api-routes.md's "don't issue an
  // extra findUnique purely to pre-validate" is about the latter).
  const room = await getRoomById(params.roomId);
  if (!room || !room.active) throw new ValidationError('Unknown room id');

  const startsAt = new Date(params.startsAt);
  const endsAt = new Date(params.endsAt);

  try {
    return await createBookingRepo({
      roomId: params.roomId,
      userId: params.actorId,
      startsAt,
      endsAt,
      roomSnapshot: {
        name: room.name,
        location: room.location,
        capacity: room.capacity,
        equipment: room.equipment,
      },
      requestId: params.requestId,
    });
  } catch (error: unknown) {
    if (!isOverlapViolation(error)) throw error;

    const conflicts = await findConflictingBookings(
      params.roomId,
      startsAt,
      endsAt,
    );
    await writeRejectedOverlapAudit({
      actorId: params.actorId,
      roomId: params.roomId,
      requestId: params.requestId,
      startsAt,
      endsAt,
      conflicts,
    });
    throw new RoomAlreadyBookedError(conflicts);
  }
}

export async function getById(
  bookingId: string,
  actorId: string,
): Promise<BookingSummary> {
  const booking = await findByIdRepo(bookingId);
  if (!booking) throw new NotFoundError('Booking');
  if (booking.userId !== actorId) throw new ForbiddenError();
  return booking;
}

export async function list(
  actorId: string,
  query: ListBookingsQuery,
): Promise<BookingListPage> {
  return listByUserRepo(actorId, query);
}
