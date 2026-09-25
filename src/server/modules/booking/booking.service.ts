import { z } from 'zod';

import { Prisma } from '@/generated/prisma/client';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/server/http/errors';
import { getRoomById } from '@/server/modules/room/room.service';

import {
  BookingNotModifiableError,
  RoomAlreadyBookedError,
} from './booking.errors';
import {
  cancelBooking as cancelBookingRepo,
  createBooking as createBookingRepo,
  findById as findByIdRepo,
  findConflictingBookings,
  listByUser as listByUserRepo,
  shortenBooking as shortenBookingRepo,
  writeRejectedOverlapAudit,
} from './booking.repository';

import type { BookingPage, BookingSummary } from './booking.repository';
import type {
  BookingListPagination,
  CreateBookingInput,
  ShortenBookingInput,
} from './booking.schema';

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

// Two transactions inserting genuinely at the same instant don't always get
// the clean "second one blocks, then fails with 23P01" sequence the ADR
// describes — Postgres's own deadlock detector can instead abort one side
// with a serialization failure (SQLSTATE 40001/40P01), which Prisma
// surfaces as the stable, documented code P2034 ("Transaction failed due to
// a write conflict or a deadlock. Please retry your transaction"), not
// P2039. Confirmed against this exact stack by scripts/verify-concurrency.ts
// itself: with 20 genuinely simultaneous rounds, one round's loser got
// P2034 instead of a clean overlap violation. Retrying the *same* insert
// isn't the forbidden check-then-insert shortcut — the exclusion constraint
// is still the only thing deciding the outcome; this just gives Postgres a
// second attempt once the other transaction has actually committed or
// rolled back, at which point the retry deterministically sees a normal,
// cleanly-detected 23P01.
const MAX_CREATE_ATTEMPTS = 3;

function isTransientWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}

async function createBookingWithRetry(
  input: Parameters<typeof createBookingRepo>[0],
): Promise<BookingSummary> {
  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt += 1) {
    try {
      return await createBookingRepo(input);
    } catch (error: unknown) {
      if (isTransientWriteConflict(error) && attempt < MAX_CREATE_ATTEMPTS)
        continue;
      throw error;
    }
  }
  // Unreachable: every iteration above either returns or throws by the
  // final attempt — TypeScript can't see that statically from a bounded
  // `for` loop, so this satisfies "the function must return" without ever
  // actually running.
  throw new Error('unreachable');
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
    return await createBookingWithRetry({
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

// Shared by every single-booking operation (read, cancel, shorten):
// resolve-or-404, then ownership-or-403, checked against the session id —
// never an id from the request body (security-and-audit.md). Guessing
// someone else's booking id must come back 403 here, not a successful
// read/cancel/shorten; scripts/verify-ownership.ts proves this end to end.
async function loadOwnedBooking(
  bookingId: string,
  actorId: string,
): Promise<BookingSummary> {
  const booking = await findByIdRepo(bookingId);
  if (!booking) throw new NotFoundError('Booking');
  if (booking.userId !== actorId) throw new ForbiddenError();
  return booking;
}

export async function getById(
  bookingId: string,
  actorId: string,
): Promise<BookingSummary> {
  return loadOwnedBooking(bookingId, actorId);
}

export async function list(
  actorId: string,
  query: BookingListPagination,
): Promise<BookingPage> {
  return listByUserRepo(actorId, query);
}

// Applies to both cancel and shorten (booking-domain.md's "Cancel and
// shorten"): a booking that's already CANCELLED or already ended cannot be
// touched again. "Already cancelled" isn't spelled out verbatim in that
// doc — a CANCELLED booking can still have a future endsAt, so "already
// ended" alone doesn't cover it — but re-cancelling (moving cancelledAt
// forward) or shortening a cancelled booking is clearly not what the rule
// intends; see README's "Documented decisions".
function assertModifiable(booking: BookingSummary, now: Date): void {
  if (booking.status !== 'CONFIRMED') {
    throw new BookingNotModifiableError(
      'This booking has already been cancelled',
    );
  }
  if (booking.endsAt <= now) {
    throw new BookingNotModifiableError('This booking has already ended');
  }
}

export async function cancel(
  bookingId: string,
  actorId: string,
  requestId: string,
): Promise<BookingSummary> {
  const booking = await loadOwnedBooking(bookingId, actorId);
  assertModifiable(booking, new Date());

  return cancelBookingRepo({ id: bookingId, actorId, requestId });
}

export async function shorten(
  bookingId: string,
  actorId: string,
  input: ShortenBookingInput,
  requestId: string,
): Promise<BookingSummary> {
  const booking = await loadOwnedBooking(bookingId, actorId);
  const now = new Date();
  assertModifiable(booking, now);

  const newEndsAt = new Date(input.endsAt);
  if (newEndsAt >= booking.endsAt) {
    throw new ValidationError(
      'endsAt must be earlier than the current endsAt — moving it later is a new booking, not a shorten',
    );
  }

  const hasStarted = booking.startsAt <= now;
  if (hasStarted) {
    // "You can end a meeting early, you cannot retroactively unbook time
    // you have already occupied" — booking-domain.md.
    if (newEndsAt < now) {
      throw new BookingNotModifiableError(
        'This booking has already started; it can only be shortened to now or later',
      );
    }
  } else if (newEndsAt <= booking.startsAt) {
    throw new ValidationError('endsAt must be after startsAt');
  }

  return shortenBookingRepo({
    id: bookingId,
    endsAt: newEndsAt,
    actorId,
    requestId,
  });
}
