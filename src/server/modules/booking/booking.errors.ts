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
