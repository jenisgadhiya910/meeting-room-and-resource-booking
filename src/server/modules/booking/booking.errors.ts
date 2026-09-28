import { ConflictError } from '@/server/http/errors';

import type { ConflictingBooking, SeriesConflict } from './booking.repository';

export class RoomAlreadyBookedError extends ConflictError {
  constructor(conflicts: ConflictingBooking[]) {
    super(
      'ROOM_ALREADY_BOOKED',
      'This room is already booked for part of the requested time',
      { conflicts },
    );
  }
}

// Same code as the single-booking conflict — it's the same underlying
// reason (the room's already booked for part of the requested time) — but
// `details.conflicts` is shaped per occurrence, not a flat list, per
// booking-domain.md's "All-or-nothing": "the whole series is rejected with
// 409 and details.conflicts listing which dates clashed and with what."
export class SeriesAlreadyBookedError extends ConflictError {
  constructor(conflicts: SeriesConflict[]) {
    super(
      'ROOM_ALREADY_BOOKED',
      'This room is already booked for part of the requested series',
      { conflicts },
    );
  }
}

// Covers every reason a cancel/shorten is refused by a time or status rule
// (already ended, already cancelled, or — shorten only — already started
// and the new endsAt is earlier than now) — see booking-domain.md's
// "Cancel and shorten". The message differs per call site; the code never
// does.
export class BookingNotModifiableError extends ConflictError {
  constructor(message: string) {
    super('BOOKING_NOT_MODIFIABLE', message);
  }
}
