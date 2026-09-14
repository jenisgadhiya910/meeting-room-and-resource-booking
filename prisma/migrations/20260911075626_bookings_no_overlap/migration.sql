-- Enforces "two overlapping CONFIRMED bookings for the same room can never
-- both exist" at the database level. Prisma's schema DSL has no way to
-- express a range-overlap exclusion constraint, so this is hand-written.
-- See docs/adr/0001-double-booking-prevention.md for the full rationale.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings"
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    "roomId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE (status = 'CONFIRMED');
