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
