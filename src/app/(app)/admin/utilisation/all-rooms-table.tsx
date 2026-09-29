import { formatHours, formatWeekStart } from '@/lib/format';

import { UtilisationMeter } from './utilisation-meter';

import type { ClientRoomUtilisation } from './utilisation-dashboard';

interface Props {
  rooms: ClientRoomUtilisation[];
  timeZone: string;
  onSelectRoom: (roomId: string) => void;
}

const cellClassName = 'px-3 py-2 whitespace-nowrap';

// Rooms down, weeks across. Every room carries the same week list (the API
// returns zero-booking weeks too), so the first room's weeks are the header.
export function AllRoomsTable({ rooms, timeZone, onSelectRoom }: Props) {
  const weekStarts = rooms[0]?.weeks.map((week) => week.weekStart) ?? [];

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">All rooms</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Select a room name for its week-by-week hours.
      </p>

      <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 text-left text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <tr>
              <th scope="col" className={cellClassName}>
                Room
              </th>
              {weekStarts.map((weekStart) => (
                <th key={weekStart} scope="col" className={cellClassName}>
                  {formatWeekStart(weekStart, timeZone)}
                </th>
              ))}
              <th scope="col" className={cellClassName}>
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-900">
            {rooms.map(({ room, weeks, totals }) => (
              <tr key={room.id}>
                <th
                  scope="row"
                  className={`${cellClassName} text-left font-normal`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectRoom(room.id)}
                    className="text-left hover:underline"
                  >
                    {room.name}
                  </button>
                  {room.active ? null : (
                    <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                      (inactive)
                    </span>
                  )}
                </th>
                {weeks.map((week) => (
                  <td key={week.weekStart} className={cellClassName}>
                    <UtilisationMeter
                      bookedMinutes={week.bookedMinutes}
                      availableMinutes={week.availableMinutes}
                      label={`${room.name}, week of ${formatWeekStart(
                        week.weekStart,
                        timeZone,
                      )}`}
                    />
                  </td>
                ))}
                <td className={cellClassName}>
                  <div className="space-y-1">
                    <UtilisationMeter
                      bookedMinutes={totals.bookedMinutes}
                      availableMinutes={totals.availableMinutes}
                      label={`${room.name}, whole range`}
                    />
                    <p className="text-xs text-gray-500 tabular-nums dark:text-gray-400">
                      {formatHours(totals.bookedMinutes)} /{' '}
                      {formatHours(totals.availableMinutes)} h
                    </p>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
