---
paths:
  - 'src/server/modules/booking/**'
  - 'src/server/modules/room/**'
  - 'src/server/modules/utilisation/**'
  - 'prisma/schema.prisma'
  - 'prisma/migrations/**'
  - 'scripts/verify-concurrency.ts'
---

# Booking domain

## Schema shape

Five tables. The important choice is that **a recurring series is not one row** — occurrences
are materialised, so cancelling one Tuesday is an update to one row and nothing else moves.

- `rooms` — id, name, location, capacity, active
- `equipment` — id, key, label
- `room_equipment` — join table, `@@id([roomId, equipmentId])` (many-to-many)
- `booking_series` — id, roomId, userId, weekday, localStartTime, localEndTime, timezone,
  occurrenceCount, createdAt
- `bookings` — id, roomId, userId, `seriesId` (nullable), startsAt, endsAt,
  `status` (`CONFIRMED` | `CANCELLED`), createdAt, cancelledAt

A one-off booking is a `bookings` row with `seriesId = null`. A series is one `booking_series`
row plus N `bookings` rows. Nothing else in the system needs to know the difference.

`startsAt` / `endsAt` are `timestamptz`, half-open `[start, end)`: a booking ending at 11:00
and one starting at 11:00 do not overlap.

## The overlap guarantee

Enforced by the database, not by application code:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings"
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    "roomId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (status = 'CONFIRMED');
```

Two transactions inserting overlapping confirmed rows for the same room cannot both commit:
the second blocks until the first commits, then fails. There is no window in which a check has
passed but the write has not landed.

The partial `WHERE` clause is doing real work — a cancelled row stops participating in the
constraint the instant its status flips, which is exactly the "no stale still-booked window"
requirement for cancellation.

### Handling the rejection

```ts
const PG_EXCLUSION_VIOLATION = '23P01';

export function isOverlapViolation(error: unknown): boolean {
  // Prisma surfaces the driver error; check the SQLSTATE and the constraint name,
  // never the message text.
  ...
}
```

Map it to `409 ROOM_ALREADY_BOOKED` with the conflicting occurrences in `details`. Fetching
those conflicts for the error body happens _after_ the failed transaction has rolled back, in
a fresh read.

### What not to do

- No `SELECT ... WHERE overlaps` followed by an `INSERT` as the guarantee. It is a
  time-of-check/time-of-use race and the whole POC is about not shipping that. A pre-check is
  permitted only as an optimisation for a nicer message, and the constraint remains the thing
  that decides.
- No application-level mutex, no in-process lock, no `setTimeout` retry loop.
- Do not catch the violation and silently retry with a different slot.

## Recurring series

- Occurrences are generated in the service from the series definition and inserted inside one
  `$transaction`.
- **All-or-nothing:** if any occurrence in the requested series collides, the whole series is
  rejected with `409` and `details.conflicts` listing which dates clashed and with what. The
  alternative (book what fits, report the rest) is defensible too — if you switch, change it
  here and in `README.md` at the same time.
- Weekly recurrence is computed in the series' stored timezone, not in UTC, so an 8-week
  Tuesday 10:00 series stays at 10:00 local across a DST boundary. Convert to UTC only at the
  point of writing `startsAt`/`endsAt`.
- Cancelling one occurrence sets that row's status and leaves `booking_series` alone.
  Cancelling the series cancels the remaining future occurrences and leaves past ones intact.

## Cancel and shorten

Only the owning user, checked in the service against the session id — never against an id from
the request body.

- **Cancel:** `status → CANCELLED`, set `cancelledAt`. Never delete the row; the audit trail
  depends on it. The freed window is immediately bookable because the constraint is partial.
- **Shorten:** `endsAt` moves earlier only. Moving it later is a new booking request, not a
  shorten, and is rejected with `VALIDATION_FAILED`.
- A booking that has already **ended** cannot be modified.
- A booking that has already **started** can be shortened, but the new `endsAt` must be at or
  after `now()` — you can end a meeting early, you cannot retroactively unbook time you have
  already occupied. Anything else is `409 BOOKING_NOT_MODIFIABLE`.
- Record the documented rule in `README.md`; it is one of the decisions the review asks for.

## Availability search

One query, built with Prisma's query builder (see prisma-postgres.md for why raw SQL isn't the
default here). Given `from`, `to`, `minCapacity` and a set of required equipment keys, return
rooms free for the _entire_ window:

```ts
const rooms = await prisma.room.findMany({
  where: {
    active: true,
    capacity: { gte: minCapacity },
    // AND-filter: one `some` per required key, not a HAVING count(DISTINCT ...).
    AND: equipmentKeys.map((key) => ({
      equipment: { some: { equipment: { key } } },
    })),
    // No confirmed booking overlaps [from, to): [a,b) && [c,d) <=> a < d AND b > c.
    bookings: {
      none: { status: 'CONFIRMED', startsAt: { lt: to }, endsAt: { gt: from } },
    },
  },
  select: {
    id: true,
    name: true,
    location: true,
    capacity: true,
    equipment: {
      select: { equipment: { select: { key: true, label: true } } },
    },
  },
});
```

An empty `equipmentKeys` array makes `AND: []` a no-op, so there's no special case for "no
equipment filter requested". Be ready to explain the trade-off this makes versus the exclusion
constraint's own `tstzrange(...) && tstzrange(...)` check: this shape doesn't get the GiST
index's range-search benefit the way a raw `&&` query would (measured — see prisma-postgres.md)
— accepted deliberately at this POC's data volume in favour of staying in the query builder.

## Utilisation

Aggregate in SQL, grouped by room and `date_trunc('week', "startsAt")`, summing
`EXTRACT(EPOCH FROM ("endsAt" - "startsAt")) / 3600` over `status = 'CONFIRMED'` rows within
the requested range. "Hours available" comes from a single documented bookable-window constant
(for example 08:00–18:00, Monday to Friday) — define it once in the module, do not hardcode it
in the query string in two places. Be ready to explain the plan: the range predicate on
`startsAt` must be index-backed.
