import { z } from 'zod';

import { writeAuditEvent } from '@/server/audit';
import { prisma } from '@/server/db/prisma';
import { ValidationError } from '@/server/http/errors';

import { roomSnapshotSchema } from './booking.schema';

import type { ListBookingsQuery, RoomSnapshot } from './booking.schema';
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

export async function findById(id: string): Promise<BookingSummary | null> {
  const row = await prisma.booking.findUnique({
    where: { id },
    select: bookingSelect,
  });
  return row ? toSummary(row) : null;
}

// Opaque (startsAt, id) cursor. `id` alone isn't enough once the list is
// ordered by startsAt (a non-unique column) — two bookings, even for
// different rooms, can start at the exact same instant, and an id-only
// cursor would then silently skip or repeat a row at that page boundary.
// Same lesson as room.repository.ts's buildRoomOrderBy, just without a
// `@@unique([startsAt, id])` to hand to Prisma's own `cursor` API, so the
// seek predicate below is built by hand instead.
const cursorPayloadSchema = z.object({
  startsAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

function encodeCursor(row: { startsAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ startsAt: row.startsAt.toISOString(), id: row.id }),
  ).toString('base64url');
}

function decodeCursor(cursor: string): { startsAt: Date; id: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError('Invalid cursor');
  }
  const parsed = cursorPayloadSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError('Invalid cursor');
  return { startsAt: new Date(parsed.data.startsAt), id: parsed.data.id };
}

export interface BookingListPage {
  items: BookingSummary[];
  nextCursor: string | null;
}

export async function listByUser(
  userId: string,
  query: ListBookingsQuery,
): Promise<BookingListPage> {
  const { limit, cursor } = query;
  const seek = cursor !== undefined ? decodeCursor(cursor) : null;

  const rows = await prisma.booking.findMany({
    where: {
      userId,
      // Seek method: continue strictly past the cursor row in the same
      // (startsAt desc, id desc) order the query is sorted in.
      ...(seek
        ? {
            OR: [
              { startsAt: { lt: seek.startsAt } },
              { startsAt: seek.startsAt, id: { lt: seek.id } },
            ],
          }
        : {}),
    },
    select: bookingSelect,
    orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor = rows.length > limit && last ? encodeCursor(last) : null;

  return { items: items.map(toSummary), nextCursor };
}
