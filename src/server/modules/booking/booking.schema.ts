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

// "My bookings" keeps real keyset (cursor) pagination rather than the
// page-number pagination room listings switched to — see README's
// "Documented decisions": a caller-scoped, potentially fast-growing
// collection like bookings is exactly the case that page-number pagination
// was deliberately not chosen for. The cursor is opaque to the caller; see
// booking.repository.ts for what it actually encodes and why an id-only
// cursor isn't enough once the list is ordered by startsAt.
export const listBookingsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;

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
