-- Serves the utilisation aggregate (GET /api/admin/utilisation) when it is
-- scoped to one room: `"roomId" = $1 AND "startsAt" >= $2 AND "startsAt" < $3`
-- becomes a single index range seek. Measured with EXPLAIN ANALYZE against
-- ~540k synthetic rows: 4.2ms (bitmap scan of bookings_no_overlap on roomId
-- alone, then filtering startsAt) down to 0.56ms. Unscoped (all rooms), the
-- planner legitimately prefers a seq scan once the range covers a few percent
-- of the table, so no separate ("startsAt") index — it wasn't a measurable win.

-- CreateIndex
CREATE INDEX "bookings_roomId_startsAt_idx" ON "bookings"("roomId", "startsAt");
