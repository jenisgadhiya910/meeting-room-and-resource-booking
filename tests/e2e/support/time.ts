// Far enough out that a test slot can never collide with a demo booking made
// by hand, and nothing in the suite ever reaches "already started".
const BASE_YEAR = 2100;

const MS_PER_MINUTE = 60_000;

/** An ISO instant on a fixed future day, `dayOffset` days after 1 Jan 2100. */
export function futureIso(dayOffset: number, hour: number, minute = 0): string {
  return new Date(
    Date.UTC(BASE_YEAR, 0, 1 + dayOffset, hour, minute),
  ).toISOString();
}

export function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * MS_PER_MINUTE);
}
