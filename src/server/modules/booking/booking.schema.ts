import { z } from 'zod';

import { isValidIanaTimeZone } from './booking-recurrence';

const createSingleBookingSchema = z
  .object({
    roomId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

export type CreateSingleBookingInput = z.infer<
  typeof createSingleBookingSchema
>;

// "HH:MM", 24-hour, zero-padded — what a native <input type="time"> reads
// and writes (see booking-recurrence.ts's parseLocalTime, which re-checks
// this same shape rather than trusting the boundary).
const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24-hour)');

export const recurrenceSchema = z
  .object({
    // 0 = Sunday .. 6 = Saturday, matching JS Date#getDay() — see
    // schema.prisma's BookingSeries.weekday.
    weekday: z.number().int().min(0).max(6),
    localStartTime: localTimeSchema,
    localEndTime: localTimeSchema,
    timezone: z.string().refine(isValidIanaTimeZone, 'Unknown IANA time zone'),
    // A year of weekly bookings is already a lot for one request; this POC
    // doesn't support an open-ended series. See README's "Documented
    // decisions".
    occurrenceCount: z.number().int().min(1).max(52),
  })
  .refine((v) => v.localEndTime > v.localStartTime, {
    // Safe as a plain string comparison: both sides are the same
    // zero-padded "HH:MM" shape, so lexicographic order matches
    // chronological order.
    message: 'localEndTime must be after localStartTime',
    path: ['localEndTime'],
  });

const createRecurringBookingSchema = z.object({
  roomId: z.uuid(),
  recurrence: recurrenceSchema,
});

export type CreateRecurringBookingInput = z.infer<
  typeof createRecurringBookingSchema
>;

// POST /api/bookings is "single or recurring" (api-routes.md) — which one
// is decided by whether the body has a `recurrence` object, not a separate
// discriminator field. booking.service.ts narrows on `'recurrence' in body`.
export const createBookingSchema = z.union([
  createSingleBookingSchema,
  createRecurringBookingSchema,
]);

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const bookingIdParamSchema = z.object({
  bookingId: z.uuid(),
});

export const seriesIdParamSchema = z.object({
  seriesId: z.uuid(),
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
