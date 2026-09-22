-- Serves keyset pagination in room.repository.ts (buildRoomOrderAndCursor):
-- GET /api/rooms, GET /api/rooms/availability and GET /api/admin/rooms all
-- accept `sort=name|capacity` and page with a cursor that pairs the sort
-- column's value with `id`. Each unique constraint doubles as the composite
-- index a keyset `ORDER BY <col>, id` + cursor `WHERE` needs — see the
-- comment on the Room model in schema.prisma for why `name` gets one too,
-- even though it's already unique on its own.

-- CreateIndex
CREATE UNIQUE INDEX "rooms_name_id_key" ON "rooms"("name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_capacity_id_key" ON "rooms"("capacity", "id");
