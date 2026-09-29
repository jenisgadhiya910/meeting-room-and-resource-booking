// Formatting for display is a presentation concern that stays in the UI
// layer (CLAUDE.md) — this is the one place that turns an ISO instant pair
// into the browser-local text shown across booking-related components.
export function formatDateTimeRange(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const startText = start.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const endText = end.toLocaleTimeString(undefined, { timeStyle: 'short' });
  return `${startText} – ${endText}`;
}

// The same HH:MM shape a native <input type="time"> reads and writes, in
// the instant's browser-local time.
export function timeInputValue(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

// The API reports durations as integer minutes (CLAUDE.md); hours are a
// display concern.
export function formatHours(minutes: number): string {
  return (minutes / 60).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });
}

export function utilisationPercent(
  bookedMinutes: number,
  availableMinutes: number,
): number {
  return availableMinutes === 0
    ? 0
    : Math.round((bookedMinutes / availableMinutes) * 100);
}

// A week bucket's start instant, as the calendar date it is in the zone the
// buckets were computed in — not the browser's zone, which could render a
// Monday-00:00-UTC bucket as the preceding Sunday.
export function formatWeekStart(weekStart: string, timeZone: string): string {
  return new Date(weekStart).toLocaleDateString(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface BookableWindowDescription {
  timeZone: string;
  weekdays: readonly number[];
  startMinutes: number;
  endMinutes: number;
  availableMinutesPerWeek: number;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatMinutesOfDay(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
}

// e.g. "50 h per room per week (Mon, Tue, Wed, Thu, Fri, 08:00–18:00 UTC)" —
// rendered from the API's own bookableWindow so the page can't drift from
// the constant the numbers were computed with.
export function formatBookableWindow(
  bookableWindow: BookableWindowDescription,
): string {
  const days = bookableWindow.weekdays
    .map((day) => WEEKDAY_NAMES[day] ?? String(day))
    .join(', ');
  return `${formatHours(bookableWindow.availableMinutesPerWeek)} h per room per week (${days}, ${formatMinutesOfDay(
    bookableWindow.startMinutes,
  )}–${formatMinutesOfDay(bookableWindow.endMinutes)} ${bookableWindow.timeZone})`;
}
