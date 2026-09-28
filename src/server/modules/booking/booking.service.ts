import { z } from 'zod';

import { Prisma } from '@/generated/prisma/client';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/server/http/errors';
import { getRoomById } from '@/server/modules/room/room.service';

import { generateOccurrences, parseLocalTime } from './booking-recurrence';
import {
  BookingNotModifiableError,
  RoomAlreadyBookedError,
  SeriesAlreadyBookedError,
} from './booking.errors';
import {
  cancelBooking as cancelBookingRepo,
  cancelRemainingOccurrences,
  createBooking as createBookingRepo,
  createSeries as createSeriesRepo,
  findById as findByIdRepo,
  findConflictingBookings,
  findSeriesById,
  findSeriesConflicts,
  listByUser as listByUserRepo,
  shortenBooking as shortenBookingRepo,
  writeRejectedOverlapAudit,
  writeRejectedSeriesOverlapAudit,
} from './booking.repository';

import type {
  BookingPage,
  BookingSummary,
  CreatedSeries,
  SeriesSummary,
} from './booking.repository';
import type {
  BookingListPagination,
  CreateRecurringBookingInput,
  CreateSingleBookingInput,
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
// P2034 instead of a clean overlap violation. Retrying the *same* write
// isn't the forbidden check-then-insert shortcut — the exclusion constraint
// is still the only thing deciding the outcome; this just gives Postgres a
// second attempt once the other transaction has actually committed or
// rolled back, at which point the retry deterministically sees a normal,
// cleanly-detected 23P01. Shared by single and series creation — a series'
// whole transaction (booking_series row included) is retried from scratch,
// not just the failing occurrence, since a P2034 aborts the transaction
// entirely regardless of which statement hit it.
const MAX_CREATE_ATTEMPTS = 3;

function isTransientWriteConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}

async function withTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
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

export interface CreateSingleBookingParams extends CreateSingleBookingInput {
  actorId: string;
  requestId: string;
}

async function createSingleBooking(
  params: CreateSingleBookingParams,
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
    return await withTransientRetry(() =>
      createBookingRepo({
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
      }),
    );
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

export interface CreateRecurringBookingParams extends CreateRecurringBookingInput {
  actorId: string;
  requestId: string;
}

async function createSeries(
  params: CreateRecurringBookingParams,
): Promise<CreatedSeries> {
  const room = await getRoomById(params.roomId);
  if (!room || !room.active) throw new ValidationError('Unknown room id');

  const occurrences = generateOccurrences({
    weekday: params.recurrence.weekday,
    localStartMinutes: parseLocalTime(params.recurrence.localStartTime),
    localEndMinutes: parseLocalTime(params.recurrence.localEndTime),
    timezone: params.recurrence.timezone,
    occurrenceCount: params.recurrence.occurrenceCount,
  });

  // Pre-check, not a substitute for the constraint: with N occurrences,
  // the exclusion constraint can only ever report the *first* one it
  // happens to hit, one at a time — it can't hand back "these are all the
  // dates that clash" the way booking-domain.md's all-or-nothing rule
  // needs. This one query builds that full list up front so a doomed
  // series never even starts a transaction; the transaction (below)
  // remains what actually decides the outcome (ADR 0001: "a pre-check is
  // only ever a fast path for a friendlier error message").
  const preCheckConflicts = await findSeriesConflicts(
    params.roomId,
    occurrences,
  );
  if (preCheckConflicts.length > 0) {
    await writeRejectedSeriesOverlapAudit({
      actorId: params.actorId,
      roomId: params.roomId,
      requestId: params.requestId,
      conflicts: preCheckConflicts,
    });
    throw new SeriesAlreadyBookedError(preCheckConflicts);
  }

  try {
    return await withTransientRetry(() =>
      createSeriesRepo({
        roomId: params.roomId,
        userId: params.actorId,
        weekday: params.recurrence.weekday,
        localStartMinutes: parseLocalTime(params.recurrence.localStartTime),
        localEndMinutes: parseLocalTime(params.recurrence.localEndTime),
        timezone: params.recurrence.timezone,
        occurrenceCount: params.recurrence.occurrenceCount,
        occurrences,
        roomSnapshot: {
          name: room.name,
          location: room.location,
          capacity: room.capacity,
          equipment: room.equipment,
        },
        requestId: params.requestId,
      }),
    );
  } catch (error: unknown) {
    if (!isOverlapViolation(error)) throw error;

    // Rare race: the pre-check passed, but a concurrent write landed in
    // the gap between it and this transaction. Fresh read after rollback,
    // same reasoning as the single-booking path.
    const conflicts = await findSeriesConflicts(params.roomId, occurrences);
    await writeRejectedSeriesOverlapAudit({
      actorId: params.actorId,
      roomId: params.roomId,
      requestId: params.requestId,
      conflicts,
    });
    throw new SeriesAlreadyBookedError(conflicts);
  }
}

export type CreateBookingParams =
  | (CreateSingleBookingInput & { actorId: string; requestId: string })
  | (CreateRecurringBookingInput & { actorId: string; requestId: string });

export type CreateBookingResult =
  | { kind: 'single'; booking: BookingSummary }
  | { kind: 'series'; series: SeriesSummary; occurrences: BookingSummary[] };

// POST /api/bookings is "single or recurring" through one endpoint
// (api-routes.md) — the request body's shape (a `recurrence` object or
// not) decides which, matching createBookingSchema's union in
// booking.schema.ts. The result is a discriminated union too, so the route
// handler can map either shape to a response without doing any business
// logic of its own — just picking which shape to wrap.
export async function create(
  params: CreateBookingParams,
): Promise<CreateBookingResult> {
  if ('recurrence' in params) {
    const result = await createSeries(params);
    return { kind: 'series', ...result };
  }
  const booking = await createSingleBooking(params);
  return { kind: 'single', booking };
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

// Cancels this one occurrence without touching the series it may belong
// to — an occurrence is just a bookings row with seriesId set, identical
// in every other respect to a one-off booking, so the existing single-
// booking cancel logic already does exactly the right thing unmodified
// (booking-domain.md: "Nothing else in the system needs to know the
// difference").
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

// Ownership checked the same way as a single booking (against the session
// id, never an id from the request), just against booking_series.userId
// instead of bookings.userId.
export async function cancelSeries(
  seriesId: string,
  actorId: string,
  requestId: string,
): Promise<{ cancelledCount: number }> {
  const series = await findSeriesById(seriesId);
  if (!series) throw new NotFoundError('Booking series');
  if (series.userId !== actorId) throw new ForbiddenError();

  const { cancelledIds } = await cancelRemainingOccurrences({
    seriesId,
    actorId,
    requestId,
    roomId: series.roomId,
  });
  return { cancelledCount: cancelledIds.length };
}
