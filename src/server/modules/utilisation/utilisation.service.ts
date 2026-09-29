import { NotFoundError } from '@/server/http/errors';

import { AVAILABLE_MINUTES_PER_WEEK, BOOKABLE_WINDOW } from './bookable-window';
import { aggregateUtilisation } from './utilisation.repository';

import type { UtilisationRow } from './utilisation.repository';
import type { UtilisationQuery } from './utilisation.schema';

export interface UtilisationMinutes {
  bookedMinutes: number;
  availableMinutes: number;
  bookingCount: number;
}

export interface WeekUtilisation extends UtilisationMinutes {
  weekStart: Date;
}

export interface RoomUtilisation {
  room: { id: string; name: string; active: boolean };
  weeks: WeekUtilisation[];
  totals: UtilisationMinutes;
}

export interface UtilisationReport {
  rooms: RoomUtilisation[];
  bookableWindow: typeof BOOKABLE_WINDOW & {
    availableMinutesPerWeek: number;
  };
}

export async function getUtilisation(
  query: UtilisationQuery,
): Promise<UtilisationReport> {
  const rows = await aggregateUtilisation(query);

  // The range always yields at least one week, so an empty result for a
  // specific room means the room doesn't exist — no separate lookup needed.
  if (query.roomId && rows.length === 0) throw new NotFoundError('Room');

  return {
    rooms: groupByRoom(rows),
    bookableWindow: {
      ...BOOKABLE_WINDOW,
      availableMinutesPerWeek: AVAILABLE_MINUTES_PER_WEEK,
    },
  };
}

// Reshaping only — every number was already aggregated in SQL. Relies on the
// repository's ORDER BY keeping each room's rows contiguous.
function groupByRoom(rows: readonly UtilisationRow[]): RoomUtilisation[] {
  const rooms: RoomUtilisation[] = [];

  for (const row of rows) {
    let current = rooms.at(-1);
    if (current?.room.id !== row.roomId) {
      current = {
        room: { id: row.roomId, name: row.roomName, active: row.roomActive },
        weeks: [],
        totals: { bookedMinutes: 0, availableMinutes: 0, bookingCount: 0 },
      };
      rooms.push(current);
    }

    current.weeks.push({
      weekStart: row.weekStart,
      bookedMinutes: row.bookedMinutes,
      availableMinutes: AVAILABLE_MINUTES_PER_WEEK,
      bookingCount: row.bookingCount,
    });
    current.totals.bookedMinutes += row.bookedMinutes;
    current.totals.availableMinutes += AVAILABLE_MINUTES_PER_WEEK;
    current.totals.bookingCount += row.bookingCount;
  }

  return rooms;
}
