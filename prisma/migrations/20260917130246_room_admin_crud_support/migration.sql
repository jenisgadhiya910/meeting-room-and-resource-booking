-- Admins can now update/delete rooms (guarded in the service layer: only
-- when the room has no active/future CONFIRMED bookings). That means a
-- room's foreign keys from bookings/booking_series/audit_events can no
-- longer RESTRICT deletion, or a room with any historical (fully past)
-- booking could never be deleted. They become nullable + SET NULL instead —
-- the row itself is never touched, only its link to the (now gone) room.
--
-- bookings additionally gains roomSnapshot: a point-in-time copy of the
-- room's name/location/capacity/equipment, captured once at booking
-- creation. Display always reads this, never a live join to `room` — see
-- booking-domain.md.

-- DropForeignKey
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_roomId_fkey";

-- DropForeignKey
ALTER TABLE "booking_series" DROP CONSTRAINT "booking_series_roomId_fkey";

-- DropForeignKey
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_roomId_fkey";

-- AlterTable
ALTER TABLE "audit_events" ALTER COLUMN "roomId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "booking_series" ALTER COLUMN "roomId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "roomSnapshot" JSONB NOT NULL,
ALTER COLUMN "roomId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "rooms_name_key" ON "rooms"("name");

-- AddForeignKey
ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
