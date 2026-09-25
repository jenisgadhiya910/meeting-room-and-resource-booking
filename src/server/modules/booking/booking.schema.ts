import { z } from 'zod';

export const createBookingSchema = z
  .object({
    roomId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const bookingIdParamSchema = z.object({
  bookingId: z.uuid(),
});

// Shorten only moves endsAt earlier — the cross-field comparison against
// the booking's *current* endsAt can't be expressed here (this schema only
// ever sees the request body, never the existing row), so that half of the
// rule lives in booking.service.ts instead. See booking-domain.md.
export const shortenBookingSchema = z.object({
  endsAt: z.iso.datetime({ offset: true }),
});

export type ShortenBookingInput = z.infer<typeof shortenBookingSchema>;

// Page-number pagination, same shape as room.schema.ts's
// roomListPaginationSchema — lets the "My bookings" UI show real page
// numbers via the same RoomPagination component the room listings use,
// rather than a cursor-driven "load more". See booking.repository.ts for
// how this interacts with the upcoming/past sort — two Prisma queries
// (count + findMany) per bucket, never raw SQL.
export const bookingListPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(10),
});

export type BookingListPagination = z.infer<typeof bookingListPaginationSchema>;

// Booking.roomSnapshot is stored as Json — untyped until parsed. This is the
// one place that knows its shape, per booking-domain.md ("name/location/
// capacity/equipment, captured once at booking creation").
export const roomSnapshotSchema = z.object({
  name: z.string(),
  location: z.string(),
  capacity: z.number().int(),
  equipment: z.array(z.object({ key: z.string(), label: z.string() })),
});

export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
