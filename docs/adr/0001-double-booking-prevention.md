# ADR 0001 — Preventing double bookings

**Status:** Accepted · **Date:** _fill in_ · **Decision owner:** _fill in_

## Context

Two users can request the same room for overlapping times at the same instant. Exactly one must
succeed, and the loser must receive a specific, actionable failure — not a 500, not a silent
success. Overlap is a range predicate, so it cannot be expressed as a unique key.

## Decision

Enforce it with a PostgreSQL **exclusion constraint** on `bookings`, using `btree_gist`,
partial on `status = 'CONFIRMED'`:

```sql
EXCLUDE USING gist ("roomId" WITH =, tstzrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE (status = 'CONFIRMED')
```

The application inserts optimistically and translates SQLSTATE `23P01` into
`409 ROOM_ALREADY_BOOKED`. Two inserts landing at genuinely the same instant occasionally get a
serialization failure (`40001`/`40P01`, Prisma code `P2034`) from Postgres's deadlock detector
instead of a clean `23P01` — the service retries that specific, documented "please retry your
transaction" error once before giving up; see Consequences.

## Why

- The invariant lives in the schema, so it holds for every writer — the API, a seed script, a
  future admin tool, a psql session. It cannot be forgotten at a new call site.
- No read-then-write window exists at all. The second transaction blocks on the index entry
  and fails at insert time.
- Cancellation is a status flip, and the partial predicate means the freed window becomes
  bookable in the same commit — no invalidation step, no stale-availability window.
- The GiST index that backs the constraint also serves the availability search's overlap
  probe, so it earns its keep twice.

## Alternatives considered

**Check-then-insert in application code.** The obvious approach and the one this POC exists to
rule out. Between the `SELECT` that finds no overlap and the `INSERT`, another transaction can
do the same thing. Under `READ COMMITTED` both succeed. It looks correct in manual testing
because the window is milliseconds wide, which is precisely what makes it dangerous.

**Pessimistic row lock — `SELECT ... FROM rooms WHERE id = $1 FOR UPDATE`.** Correct, and easy
to explain. Rejected because it serialises every booking for a room behind one lock even when
the requests do not overlap in time, it relies on every writer remembering to take the lock
first, and the invariant is still only as good as the discipline of the code around it. It is
the right answer in a database without exclusion constraints.

**Postgres advisory lock keyed on room id** (`pg_advisory_xact_lock`). Same serialisation
profile as the row lock without touching a real row, and it does not survive a writer that
forgets to call it. Adds a hashing scheme to maintain for no benefit here.

**`SERIALIZABLE` isolation.** Genuinely correct, and the read-then-write pattern becomes safe.
Rejected for cost and operational shape: it pushes a retry loop into every write path,
serialisation failures surface as `40001` that the caller must distinguish from real
conflicts, and it makes the whole application pay for an invariant that concerns one table.

**A `bookings`-adjacent time-slot table with a unique key on `(roomId, slot)`.** Makes overlap
expressible as uniqueness, but forces a fixed slot granularity, multiplies rows, and turns a
90-minute booking into six rows that must be inserted and cancelled atomically anyway.

## Consequences

- `btree_gist` must exist in the database; it is created in the first migration, and the
  Docker image (`postgres:16-alpine`) ships it in `contrib`.
- Prisma cannot express the constraint, so it lives in a hand-written migration created with
  `prisma migrate dev --create-only`. Anyone regenerating the schema from scratch must not drop
  it.
- Error handling depends on a driver-level SQLSTATE rather than a Prisma error code, so the
  detection helper is the one place that knows about `23P01` and the constraint name.
- Booking rows are never hard-deleted, because the partial predicate depends on `status`.
- The exclusion constraint isn't fully immune to the `40001` retry concern raised against
  `SERIALIZABLE` above — it just hits it far more rarely (only two writers landing at genuinely
  the same instant, not every read-then-write) and the fix is a single bounded retry of the
  same insert, not a retry loop threaded through every write path. `booking.service.ts` retries
  up to twice on Prisma's `P2034` before surfacing anything else as an error; this was not a
  theoretical concern added up front — `scripts/verify-concurrency.ts`'s repeated rounds
  produced one in early testing, surfacing a 500 where a 409 was expected.

## Verification

`scripts/verify-concurrency.ts` issues two overlapping `POST /api/bookings` requests with
`Promise.all` against a running stack and asserts one `201` and one `409` with code
`ROOM_ALREADY_BOOKED`. Run it repeatedly — a race that only fails one time in twenty is still
a failure.
