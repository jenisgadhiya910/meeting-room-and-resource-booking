import { writeAuditEvent } from '@/server/audit';
import { prisma } from '@/server/db/prisma';

import { roomSnapshotSchema } from './booking.schema';

import type { BookingListPagination, RoomSnapshot } from './booking.schema';
import type { Prisma } from '@/generated/prisma/client';
import type { BookingStatus } from '@/generated/prisma/enums';

export interface BookingSummary {
  id: string;
  roomId: string | null;
  userId: string;
  // Null for a one-off booking, set for one occurrence of a recurring
  // series — the two are otherwise identical rows (booking-domain.md: "A
  // one-off booking is a bookings row with seriesId = null... Nothing else
  // in the system needs to know the difference").
  seriesId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  createdAt: Date;
  cancelledAt: Date | null;
  roomSnapshot: RoomSnapshot;
}

export interface ConflictingBooking {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

const bookingSelect = {
  id: true,
  roomId: true,
  userId: true,
  seriesId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  createdAt: true,
  cancelledAt: true,
  roomSnapshot: true,
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

function toSummary(row: BookingRow): BookingSummary {
  return {
    id: row.id,
    roomId: row.roomId,
    userId: row.userId,
    seriesId: row.seriesId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    createdAt: row.createdAt,
    cancelledAt: row.cancelledAt,
    // Boundary crossing: the DB gives back an untyped Json value, parsed
    // here into the one shape it's ever allowed to have. See
    // typescript.md — `unknown` (which is effectively what Prisma.JsonValue
    // is until narrowed) is never cast, only parsed.
    roomSnapshot: roomSnapshotSchema.parse(row.roomSnapshot),
  };
}

export interface CreateBookingParams {
  roomId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  roomSnapshot: RoomSnapshot;
  requestId: string;
}

export async function createBooking(
  params: CreateBookingParams,
): Promise<BookingSummary> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.create({
      data: {
        roomId: params.roomId,
        userId: params.userId,
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        roomSnapshot: params.roomSnapshot,
      },
      select: bookingSelect,
    });

    // Success event, same transaction as the row it describes — a booking
    // can never exist without its audit row (security-and-audit.md).
    await writeAuditEvent(tx, {
      actorId: params.userId,
      action: 'BOOKING_CREATED',
      outcome: 'SUCCESS',
      roomId: params.roomId,
      bookingId: booking.id,
      requestId: params.requestId,
      payload: {
        startsAt: params.startsAt.toISOString(),
        endsAt: params.endsAt.toISOString(),
      },
    });

    return toSummary(booking);
  });
}

// Fresh, non-transactional read — called only after createBooking's
// transaction has already rolled back on an overlap, per booking-domain.md
// ("Fetching those conflicts for the error body happens after the failed
// transaction has rolled back, in a fresh read").
export async function findConflictingBookings(
  roomId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<ConflictingBooking[]> {
  return prisma.booking.findMany({
    where: {
      roomId,
      status: 'CONFIRMED',
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    select: { id: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: 'asc' },
  });
}

export interface RejectedOverlapAuditParams {
  actorId: string;
  roomId: string;
  requestId: string;
  startsAt: Date;
  endsAt: Date;
  conflicts: ConflictingBooking[];
}

// Its own statement against the global `prisma`, deliberately not inside the
// transaction that just failed (security-and-audit.md) — that transaction
// has already rolled back by the time this is called.
export async function writeRejectedOverlapAudit(
  params: RejectedOverlapAuditParams,
): Promise<void> {
  await writeAuditEvent(prisma, {
    actorId: params.actorId,
    action: 'BOOKING_REJECTED_OVERLAP',
    outcome: 'REJECTED',
    roomId: params.roomId,
    bookingId: null,
    requestId: params.requestId,
    payload: {
      startsAt: params.startsAt.toISOString(),
      endsAt: params.endsAt.toISOString(),
      conflicts: params.conflicts.map((conflict) => ({
        id: conflict.id,
        startsAt: conflict.startsAt.toISOString(),
        endsAt: conflict.endsAt.toISOString(),
      })),
    },
  });
}

export interface SeriesConflict {
  occurrenceStartsAt: Date;
  occurrenceEndsAt: Date;
  conflicts: ConflictingBooking[];
}

// One query for every occurrence's overlap check, not one query per
// occurrence — `OR` one overlap predicate per occurrence, then sort the
// (typically tiny) result back out per occurrence in application code.
// Called both as the pre-check before attempting the transaction, and
// again after a rollback to build an accurate details.conflicts on the
// rare race where the pre-check passed but a concurrent write beat this
// series to it — same "fresh read after rollback" shape as
// findConflictingBookings above, just batched over N occurrences.
export async function findSeriesConflicts(
  roomId: string,
  occurrences: { startsAt: Date; endsAt: Date }[],
): Promise<SeriesConflict[]> {
  if (occurrences.length === 0) return [];

  const candidates = await prisma.booking.findMany({
    where: {
      roomId,
      status: 'CONFIRMED',
      OR: occurrences.map((occurrence) => ({
        startsAt: { lt: occurrence.endsAt },
        endsAt: { gt: occurrence.startsAt },
      })),
    },
    select: { id: true, startsAt: true, endsAt: true },
    orderBy: { startsAt: 'asc' },
  });

  const conflicts: SeriesConflict[] = [];
  for (const occurrence of occurrences) {
    const overlapping = candidates.filter(
      (candidate) =>
        candidate.startsAt < occurrence.endsAt &&
        candidate.endsAt > occurrence.startsAt,
    );
    if (overlapping.length > 0) {
      conflicts.push({
        occurrenceStartsAt: occurrence.startsAt,
        occurrenceEndsAt: occurrence.endsAt,
        conflicts: overlapping,
      });
    }
  }
  return conflicts;
}

export interface RejectedSeriesOverlapAuditParams {
  actorId: string;
  roomId: string;
  requestId: string;
  conflicts: SeriesConflict[];
}

export async function writeRejectedSeriesOverlapAudit(
  params: RejectedSeriesOverlapAuditParams,
): Promise<void> {
  await writeAuditEvent(prisma, {
    actorId: params.actorId,
    action: 'BOOKING_REJECTED_OVERLAP',
    outcome: 'REJECTED',
    roomId: params.roomId,
    bookingId: null,
    requestId: params.requestId,
    payload: {
      conflicts: params.conflicts.map((conflict) => ({
        occurrenceStartsAt: conflict.occurrenceStartsAt.toISOString(),
        occurrenceEndsAt: conflict.occurrenceEndsAt.toISOString(),
        conflicts: conflict.conflicts.map((c) => ({
          id: c.id,
          startsAt: c.startsAt.toISOString(),
          endsAt: c.endsAt.toISOString(),
        })),
      })),
    },
  });
}

export interface SeriesSummary {
  id: string;
  roomId: string | null;
  userId: string;
  weekday: number;
  localStartMinutes: number;
  localEndMinutes: number;
  timezone: string;
  occurrenceCount: number;
  createdAt: Date;
}

const seriesSelect = {
  id: true,
  roomId: true,
  userId: true,
  weekday: true,
  localStartMinutes: true,
  localEndMinutes: true,
  timezone: true,
  occurrenceCount: true,
  createdAt: true,
} satisfies Prisma.BookingSeriesSelect;

type SeriesRow = Prisma.BookingSeriesGetPayload<{
  select: typeof seriesSelect;
}>;

function toSeriesSummary(row: SeriesRow): SeriesSummary {
  return { ...row };
}

export interface CreateSeriesParams {
  roomId: string;
  userId: string;
  weekday: number;
  localStartMinutes: number;
  localEndMinutes: number;
  timezone: string;
  occurrenceCount: number;
  occurrences: { startsAt: Date; endsAt: Date }[];
  roomSnapshot: RoomSnapshot;
  requestId: string;
}

export interface CreatedSeries {
  series: SeriesSummary;
  occurrences: BookingSummary[];
}

// One booking_series row plus N bookings rows, all inside one transaction
// — all-or-nothing (booking-domain.md): if any occurrence's INSERT hits
// the exclusion constraint, the whole transaction (series row included)
// rolls back together. Occurrences are inserted one at a time with
// sequential awaits, not Promise.all — they share this one transaction's
// single connection, and Prisma's interactive transactions don't support
// concurrent queries against the same tx (typescript.md: "Do not
// Promise.all over writes that must share a transaction").
export async function createSeries(
  params: CreateSeriesParams,
): Promise<CreatedSeries> {
  return prisma.$transaction(async (tx) => {
    const series = await tx.bookingSeries.create({
      data: {
        roomId: params.roomId,
        userId: params.userId,
        weekday: params.weekday,
        localStartMinutes: params.localStartMinutes,
        localEndMinutes: params.localEndMinutes,
        timezone: params.timezone,
        occurrenceCount: params.occurrenceCount,
      },
      select: seriesSelect,
    });

    const occurrenceRows: BookingRow[] = [];
    for (const occurrence of params.occurrences) {
      const booking = await tx.booking.create({
        data: {
          roomId: params.roomId,
          userId: params.userId,
          seriesId: series.id,
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
          roomSnapshot: params.roomSnapshot,
        },
        select: bookingSelect,
      });
      occurrenceRows.push(booking);
    }

    // One event for the whole series, not one per occurrence — mirrors
    // SERIES_CREATED/SERIES_CANCELLED being their own AuditAction values,
    // distinct from per-occurrence BOOKING_CREATED (security-and-audit.md).
    await writeAuditEvent(tx, {
      actorId: params.userId,
      action: 'SERIES_CREATED',
      outcome: 'SUCCESS',
      roomId: params.roomId,
      bookingId: null,
      requestId: params.requestId,
      payload: {
        seriesId: series.id,
        occurrenceCount: params.occurrenceCount,
        occurrences: params.occurrences.map((o) => ({
          startsAt: o.startsAt.toISOString(),
          endsAt: o.endsAt.toISOString(),
        })),
      },
    });

    return {
      series: toSeriesSummary(series),
      occurrences: occurrenceRows.map(toSummary),
    };
  });
}

export async function findSeriesById(
  id: string,
): Promise<SeriesSummary | null> {
  const row = await prisma.bookingSeries.findUnique({
    where: { id },
    select: seriesSelect,
  });
  return row ? toSeriesSummary(row) : null;
}

export interface CancelSeriesParams {
  seriesId: string;
  actorId: string;
  requestId: string;
  roomId: string | null;
}

// "Cancels the remaining future occurrences and leaves past ones intact"
// (booking-domain.md) — "future" here means the same `endsAt > now()` line
// every other time-based rule in this module uses, not `startsAt > now()`:
// an in-progress occurrence is still "remaining", not yet done. One
// updateMany, not N individual updates with N audit rows — one
// SERIES_CANCELLED event lists which booking ids it touched.
export async function cancelRemainingOccurrences(
  params: CancelSeriesParams,
): Promise<{ cancelledIds: string[] }> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const toCancel = await tx.booking.findMany({
      where: {
        seriesId: params.seriesId,
        status: 'CONFIRMED',
        endsAt: { gt: now },
      },
      select: { id: true },
    });
    const cancelledIds = toCancel.map((booking) => booking.id);

    if (cancelledIds.length > 0) {
      await tx.booking.updateMany({
        where: { id: { in: cancelledIds } },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
    }

    await writeAuditEvent(tx, {
      actorId: params.actorId,
      action: 'SERIES_CANCELLED',
      outcome: 'SUCCESS',
      roomId: params.roomId,
      bookingId: null,
      requestId: params.requestId,
      payload: { seriesId: params.seriesId, cancelledBookingIds: cancelledIds },
    });

    return { cancelledIds };
  });
}

export interface CancelBookingParams {
  id: string;
  actorId: string;
  requestId: string;
}

// The time/status rules (already ended, already cancelled, already started
// and moving endsAt earlier than now) are all checked in the service before
// this is called — this just does the write. No WHERE-clause status guard
// against a concurrent double-cancel: unlike the overlap invariant, ending
// up CANCELLED twice is harmless (same end state either way), so it doesn't
// need the same hard DB-level enforcement — see ADR 0001 for which
// invariant actually needed that.
export async function cancelBooking(
  params: CancelBookingParams,
): Promise<BookingSummary> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.update({
      where: { id: params.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      select: bookingSelect,
    });

    await writeAuditEvent(tx, {
      actorId: params.actorId,
      action: 'BOOKING_CANCELLED',
      outcome: 'SUCCESS',
      roomId: booking.roomId,
      bookingId: booking.id,
      requestId: params.requestId,
      payload: { cancelledAt: booking.cancelledAt?.toISOString() ?? null },
    });

    return toSummary(booking);
  });
}

export interface ShortenBookingParams {
  id: string;
  endsAt: Date;
  actorId: string;
  requestId: string;
}

export async function shortenBooking(
  params: ShortenBookingParams,
): Promise<BookingSummary> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.update({
      where: { id: params.id },
      data: { endsAt: params.endsAt },
      select: bookingSelect,
    });

    await writeAuditEvent(tx, {
      actorId: params.actorId,
      action: 'BOOKING_SHORTENED',
      outcome: 'SUCCESS',
      roomId: booking.roomId,
      bookingId: booking.id,
      requestId: params.requestId,
      payload: { endsAt: params.endsAt.toISOString() },
    });

    return toSummary(booking);
  });
}

export async function findById(id: string): Promise<BookingSummary | null> {
  const row = await prisma.booking.findUnique({
    where: { id },
    select: bookingSelect,
  });
  return row ? toSummary(row) : null;
}

export interface BookingPage {
  items: BookingSummary[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

// "My bookings" surfaces what's actually useful first: CONFIRMED bookings
// that haven't ended yet, soonest start first (an in-progress booking, by
// definition already started, sorts ahead of ones that haven't started
// yet). Everything else — cancelled, or already ended — follows, most
// recently relevant first. That's two partitions of one logical list
// sorted in *opposite* directions, and page-number pagination has to slice
// a single window out of their concatenation.
//
// Deliberately two `count` + two `findMany` calls (all through the query
// builder, no $queryRaw) rather than one cleverer query: work out how many
// rows of each partition a page needs, then only query the partition(s)
// that page actually overlaps. A page fully inside one partition only
// queries that one; only the page straddling the boundary queries both.
function upcomingWhere(userId: string, now: Date): Prisma.BookingWhereInput {
  return { userId, status: 'CONFIRMED', endsAt: { gt: now } };
}

function pastWhere(userId: string, now: Date): Prisma.BookingWhereInput {
  return { userId, OR: [{ status: 'CANCELLED' }, { endsAt: { lte: now } }] };
}

export async function listByUser(
  userId: string,
  query: BookingListPagination,
): Promise<BookingPage> {
  const { page, pageSize } = query;
  // One instant for the whole call — count and findMany must agree on
  // which bucket each row is in, or a row could be double-counted or
  // dropped for a page that happens to straddle the boundary.
  const now = new Date();

  const [upcomingCount, pastCount] = await Promise.all([
    prisma.booking.count({ where: upcomingWhere(userId, now) }),
    prisma.booking.count({ where: pastWhere(userId, now) }),
  ]);

  const totalItems = upcomingCount + pastCount;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const skip = (page - 1) * pageSize;

  // How much of this page's window falls in each partition. A page
  // entirely within the upcoming partition takes 0 from the past one (and
  // vice versa) — the `> 0` guards below skip querying a partition this
  // page doesn't touch at all.
  const upcomingTake = Math.max(0, Math.min(pageSize, upcomingCount - skip));
  const pastTake = pageSize - upcomingTake;
  const pastSkip = Math.max(0, skip - upcomingCount);

  const [upcomingRows, pastRows] = await Promise.all([
    upcomingTake > 0
      ? prisma.booking.findMany({
          where: upcomingWhere(userId, now),
          select: bookingSelect,
          // Tiebreaker matches the primary column's direction, same
          // reasoning as room.repository.ts's buildRoomOrderBy: without
          // it, two bookings tied on startsAt could land on either side
          // of a skip/take boundary in a different order on every
          // request.
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          skip,
          take: upcomingTake,
        })
      : Promise.resolve([]),
    pastTake > 0
      ? prisma.booking.findMany({
          where: pastWhere(userId, now),
          select: bookingSelect,
          orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
          skip: pastSkip,
          take: pastTake,
        })
      : Promise.resolve([]),
  ]);

  const items = [...upcomingRows, ...pastRows].map(toSummary);

  return { items, page, pageSize, totalItems, totalPages };
}
