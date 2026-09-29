import { formatHours, formatWeekStart } from '@/lib/format';

import { UtilisationMeter } from './utilisation-meter';

import type { ClientRoomUtilisation } from './utilisation-dashboard';

interface Props {
  room: ClientRoomUtilisation;
  timeZone: string;
}

const cellClassName = 'px-3 py-2';
const numericCellClassName = `${cellClassName} text-right tabular-nums`;

export function RoomWeeksTable({ room, timeZone }: Props) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">
        {room.room.name}
        {room.room.active ? null : (
          <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
            (inactive)
          </span>
        )}
      </h2>

      <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 text-left text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <tr>
              <th scope="col" className={cellClassName}>
                Week of
              </th>
              <th scope="col" className={`${cellClassName} text-right`}>
                Bookings
              </th>
              <th scope="col" className={`${cellClassName} text-right`}>
                Booked (h)
              </th>
              <th scope="col" className={`${cellClassName} text-right`}>
                Available (h)
              </th>
              <th scope="col" className={cellClassName}>
                Utilisation
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-900">
            {room.weeks.map((week) => {
              const weekLabel = formatWeekStart(week.weekStart, timeZone);
              return (
                <tr key={week.weekStart}>
                  <th
                    scope="row"
                    className={`${cellClassName} text-left font-normal`}
                  >
                    {weekLabel}
                  </th>
                  <td className={numericCellClassName}>{week.bookingCount}</td>
                  <td className={numericCellClassName}>
                    {formatHours(week.bookedMinutes)}
                  </td>
                  <td className={numericCellClassName}>
                    {formatHours(week.availableMinutes)}
                  </td>
                  <td className={cellClassName}>
                    <UtilisationMeter
                      bookedMinutes={week.bookedMinutes}
                      availableMinutes={week.availableMinutes}
                      label={`${room.room.name}, week of ${weekLabel}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-gray-200 font-medium dark:border-gray-800">
            <tr>
              <th scope="row" className={`${cellClassName} text-left`}>
                Total
              </th>
              <td className={numericCellClassName}>
                {room.totals.bookingCount}
              </td>
              <td className={numericCellClassName}>
                {formatHours(room.totals.bookedMinutes)}
              </td>
              <td className={numericCellClassName}>
                {formatHours(room.totals.availableMinutes)}
              </td>
              <td className={cellClassName}>
                <UtilisationMeter
                  bookedMinutes={room.totals.bookedMinutes}
                  availableMinutes={room.totals.availableMinutes}
                  label={`${room.room.name}, whole range`}
                />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
