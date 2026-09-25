import { ConflictError } from '@/server/http/errors';

import type { ConflictingBooking } from './booking.repository';

export class RoomAlreadyBookedError extends ConflictError {
  constructor(conflicts: ConflictingBooking[]) {
    super(
      'ROOM_ALREADY_BOOKED',
      'This room is already booked for part of the requested time',
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
