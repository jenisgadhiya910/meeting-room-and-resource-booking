import { ConflictError } from '@/server/http/errors';

export class RoomNameTakenError extends ConflictError {
  constructor(name: string) {
    super('ROOM_NAME_TAKEN', `A room named "${name}" already exists`);
  }
}

export class EquipmentKeyTakenError extends ConflictError {
  constructor(key: string) {
    super('EQUIPMENT_KEY_TAKEN', `Equipment key "${key}" already exists`);
  }
}

// Blanket rule: a room can't be updated or deleted while it has any
// CONFIRMED booking that hasn't ended yet (in progress or still upcoming).
export class RoomHasActiveOrFutureBookingsError extends ConflictError {
  constructor() {
    super(
      'ROOM_HAS_ACTIVE_OR_FUTURE_BOOKINGS',
      'This room has an active or upcoming booking and cannot be changed or deleted',
    );
  }
}
