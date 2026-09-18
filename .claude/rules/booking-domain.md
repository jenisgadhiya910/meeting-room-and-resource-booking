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

- `rooms` — id, `name` (unique), location, capacity, active
- `equipment` — id, key, label
- `room_equipment` — join table, `@@id([roomId, equipmentId])` (many-to-many)
- `booking_series` — id, `roomId` (nullable), userId, weekday, localStartTime, localEndTime,
  timezone, occurrenceCount, createdAt
- `bookings` — id, `roomId` (nullable), userId, `seriesId` (nullable), startsAt, endsAt,
  `status` (`CONFIRMED` | `CANCELLED`), createdAt, cancelledAt, `roomSnapshot` (jsonb)

`roomId` on `booking_series`, `bookings` and `audit_events` is nullable with `ON DELETE SET
NULL`, not the default `RESTRICT` — see "Admin: rooms & equipment" below for why.

A one-off booking is a `bookings` row with `seriesId = null`. A series is one `booking_series`
row plus N `bookings` rows. Nothing else in the system needs to know the difference.

`startsAt` / `endsAt` are `timestamptz`, half-open `[start, end)`: a booking ending at 11:00
and one starting at 11:00 do not overlap.

## Admin: rooms & equipment

Admins can create, update and delete rooms, and create equipment types
(`{ role: 'ADMIN' }` on `withRoute` — see api-routes.md).

- **A room can't be updated or deleted while it has any `CONFIRMED` booking that hasn't ended
  yet** — one where `endsAt > now()`, covering both "in progress" and "still upcoming". Reject
  with `409 ROOM_HAS_ACTIVE_OR_FUTURE_BOOKINGS`. This is a blanket rule: it applies to every
  field on the room, not just structural ones like `active` — there's no per-field carve-out.
- That rule means a room can only be edited or deleted once **all** its bookings are already in
  the past. `bookings.roomId`, `booking_series.roomId` and `audit_events.roomId` are therefore
  nullable with `ON DELETE SET NULL` rather than the default `RESTRICT` — otherwise a room could
  never be deleted once it had a single historical (fully past, already-cancelled-or-completed)
  booking, ever. The row itself is never touched or deleted, only its link to the now-gone room.
- **A booking always displays `roomSnapshot`** (name, location, capacity, equipment — captured
  once, at booking creation), never a live join to `room`. Given the rule above, an active or
  future booking's snapshot is always identical to the room's live data anyway (the room can't
  have changed since), so "always show the snapshot" is simpler than conditionally choosing
  between live and snapshot data by booking status, and it's the only option once the room has
  been deleted (`roomId` is `null` at that point — there's nothing live to join to).
- Room names are unique (`rooms.name`) so admin-created rooms can't silently collide.
- A duplicate name/key is a `409` with a specific code (`ROOM_NAME_TAKEN` /
  `EQUIPMENT_KEY_TAKEN`), detected from Prisma's `P2002`. With the `@prisma/adapter-pg` driver
  adapter, the constraint name is not where the standard Prisma docs say to look (`meta.target`,
  an array of column names, from the classic Rust query engine) — it's nested under
  `meta.driverAdapterError.cause.constraint.index` instead, and it's the index name (e.g.
  `"rooms_name_key"`), not a column list. Confirmed by hand against this exact stack; don't
  assume the documented shape without checking.

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
