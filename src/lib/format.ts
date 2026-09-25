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
