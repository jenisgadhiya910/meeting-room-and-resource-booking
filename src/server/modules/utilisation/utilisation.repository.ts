import { z } from 'zod';

import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/server/db/prisma';

import { BOOKABLE_WINDOW } from './bookable-window';

import type { UtilisationQuery } from './utilisation.schema';

// $queryRaw, not the query builder: grouping by the computed
// date_trunc('week', ...) expression has no query-builder equivalent (see
// prisma-postgres.md). The row shape is still parsed, never cast.
const utilisationRowSchema = z.object({
  roomId: z.string(),
  roomName: z.string(),
  roomActive: z.boolean(),
  weekStart: z.date(),
  bookedMinutes: z.number().int(),
  bookingCount: z.number().int(),
});

export type UtilisationRow = z.infer<typeof utilisationRowSchema>;

// One row per (room, week) for every week in range — zero-booking weeks
// included, via the generate_series cross join, so the caller never has to
// fill gaps. Ordered so each room's weeks are contiguous.
//
// Week boundaries are computed in Postgres, in the bookable window's zone:
// `date_trunc('week', <local date>)` is that zone's Monday 00:00, and
// `AT TIME ZONE` turns it into the UTC instant it corresponds to (DST-aware).
// The same expressions bound the "startsAt" range predicate, so bucketing and
// filtering can't disagree about where a week starts.
//
// Plan (EXPLAIN ANALYZE, ~540k synthetic bookings, 8-week range):
// - roomId given: Bitmap Index Scan on bookings_roomId_startsAt_idx with both
//   `"roomId" = $1` and the "startsAt" range as Index Cond — ~0.5ms.
// - no roomId: the range is a few percent of the table across every room, so
//   the planner picks a parallel seq scan + HashAggregate (~29ms). A
//   per-room LATERAL variant forced the index but was slower (~41ms), so the
//   planner's choice stands. A narrower range flips it back to an index scan.
export async function aggregateUtilisation(
  query: UtilisationQuery,
): Promise<UtilisationRow[]> {
  const timeZone = Prisma.sql`${BOOKABLE_WINDOW.timeZone}::text`;
  const firstWeekLocal = Prisma.sql`date_trunc('week', ${query.from}::date::timestamp)`;
  const lastWeekLocal = Prisma.sql`date_trunc('week', ${query.to}::date::timestamp)`;
  const rangeStart = Prisma.sql`(${firstWeekLocal} AT TIME ZONE ${timeZone})`;
  const rangeEnd = Prisma.sql`((${lastWeekLocal} + interval '1 week') AT TIME ZONE ${timeZone})`;

  const bookingRoomFilter = query.roomId
    ? Prisma.sql`AND b."roomId" = ${query.roomId}::uuid`
    : Prisma.empty;
  const roomFilter = query.roomId
    ? Prisma.sql`WHERE r.id = ${query.roomId}::uuid`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<unknown[]>`
    WITH weeks AS (
      SELECT (w AT TIME ZONE ${timeZone}) AS week_start
      FROM generate_series(${firstWeekLocal}, ${lastWeekLocal}, interval '1 week') AS w
    ),
    booked AS (
      SELECT
        b."roomId" AS room_id,
        date_trunc('week', b."startsAt", ${timeZone}) AS week_start,
        SUM(EXTRACT(EPOCH FROM (b."endsAt" - b."startsAt"))) AS booked_seconds,
        COUNT(*) AS booking_count
      FROM bookings b
      WHERE b.status = 'CONFIRMED'
        AND b."startsAt" >= ${rangeStart}
        AND b."startsAt" < ${rangeEnd}
        ${bookingRoomFilter}
      GROUP BY 1, 2
    )
    SELECT
      r.id::text AS "roomId",
      r.name AS "roomName",
      r.active AS "roomActive",
      w.week_start AS "weekStart",
      COALESCE(ROUND(bk.booked_seconds / 60), 0)::int AS "bookedMinutes",
      COALESCE(bk.booking_count, 0)::int AS "bookingCount"
    FROM rooms r
    CROSS JOIN weeks w
    LEFT JOIN booked bk ON bk.room_id = r.id AND bk.week_start = w.week_start
    ${roomFilter}
    ORDER BY r.name, r.id, w.week_start
  `;

  return z.array(utilisationRowSchema).parse(rows);
}
