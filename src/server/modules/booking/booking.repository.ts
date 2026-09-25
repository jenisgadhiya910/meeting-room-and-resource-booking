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
