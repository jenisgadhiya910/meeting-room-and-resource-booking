// The single definition of "hours available" for the utilisation view —
// booking-domain.md asks for exactly one, never re-typed inside a query
// string. Documented in README.md's "Documented decisions".
//
// `timeZone` decides where a week (and therefore a weekday) starts and ends.
// UTC matches how every timestamp is stored and compared; a real single-site
// deployment would set its office zone here, and nothing else would change —
// every calendar calculation that uses it happens in Postgres
// (utilisation.repository.ts), which is DST-aware.
export const BOOKABLE_WINDOW = {
  timeZone: 'UTC',
  // 0 = Sunday .. 6 = Saturday, the same convention as BookingSeries.weekday.
  weekdays: [1, 2, 3, 4, 5],
  startMinutes: 8 * 60,
  endMinutes: 18 * 60,
} as const;

// Constant for every whole week, including across a DST change: the change
// happens overnight, outside 08:00-18:00, so each bookable day stays exactly
// ten real hours long.
export const AVAILABLE_MINUTES_PER_WEEK =
  BOOKABLE_WINDOW.weekdays.length *
  (BOOKABLE_WINDOW.endMinutes - BOOKABLE_WINDOW.startMinutes);
