// Pure date/timezone math for recurring series — no Prisma, no I/O. Kept
// separate from booking.repository.ts / booking.service.ts because it's a
// genuinely different concern (calendar arithmetic) from either of theirs
// (persistence, business rules), and because getting it right is the
// specific thing this phase is about (booking-domain.md: "Weekly
// recurrence is computed in the series' stored timezone, not in UTC, so an
// 8-week Tuesday 10:00 series stays at 10:00 local across a DST
// boundary"). No date library added for this — before adding one to the
// project, CLAUDE.md asks what it replaces and why the standard library
// won't do; `Intl.DateTimeFormat` already can, with the technique below.

export interface RecurrenceInput {
  weekday: number; // 0 = Sunday .. 6 = Saturday, matching JS Date#getDay()
  localStartMinutes: number;
  localEndMinutes: number;
  timezone: string;
  occurrenceCount: number;
}

export interface Occurrence {
  startsAt: Date;
  endsAt: Date;
}

interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

export function isValidIanaTimeZone(timezone: string): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return formatter.resolvedOptions().timeZone !== undefined;
  } catch {
    return false;
  }
}

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// "HH:MM" (24-hour, zero-padded — what a native <input type="time"> reads
// and writes) to minutes since local midnight. Shape is validated by
// booking.schema.ts's regex already; this re-checks rather than trusting
// that boundary, since a bad parse here would silently mis-book a time.
export function parseLocalTime(value: string): number {
  const match = LOCAL_TIME_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid HH:MM time: ${value}`);
  const [, hoursText, minutesText] = match;
  if (hoursText === undefined || minutesText === undefined) {
    throw new Error(`Invalid HH:MM time: ${value}`);
  }
  return Number(hoursText) * 60 + Number(minutesText);
}

function datePart(parts: Intl.DateTimeFormatPart[], type: string): number {
  const found = parts.find((part) => part.type === type);
  if (!found) throw new Error(`Missing "${type}" in formatted date`);
  return Number(found.value);
}

// The calendar date `instant` falls on in `timeZone` — e.g. "what day is
// it right now in Asia/Kolkata".
function calendarDateInZone(instant: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  return {
    year: datePart(parts, 'year'),
    month: datePart(parts, 'month'),
    day: datePart(parts, 'day'),
  };
}

// Day-of-week is a property of the calendar date alone, independent of any
// timezone or instant — treating it as a UTC midnight is just a way to
// borrow JS's proleptic-Gregorian weekday calculation, not a timezone
// conversion.
function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

// Converts a local wall-clock date + time-of-day in `timeZone` to the UTC
// instant it actually refers to. Standard technique absent a date library:
// treat the wall-clock numbers as if they were already UTC (`guess`), ask
// Intl what that instant displays as in `timeZone`, and correct `guess` by
// the difference. One correction pass, not iterated to convergence — exact
// everywhere except inside the DST transition window itself (at most an
// hour, at most twice a year, only for whichever zone is configured);
// acceptable for this POC, see README's "Documented decisions".
function zonedDateTimeToUtc(
  date: CalendarDate,
  minutesSinceMidnight: number,
  timeZone: string,
): Date {
  const hours = Math.floor(minutesSinceMidnight / 60);
  const minutes = minutesSinceMidnight % 60;
  const guessMs = Date.UTC(date.year, date.month - 1, date.day, hours, minutes);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(guessMs));

  const displayedAsUtcMs = Date.UTC(
    datePart(parts, 'year'),
    datePart(parts, 'month') - 1,
    datePart(parts, 'day'),
    datePart(parts, 'hour'),
    datePart(parts, 'minute'),
    datePart(parts, 'second'),
  );

  return new Date(guessMs + (guessMs - displayedAsUtcMs));
}

// The first occurrence's calendar date: the next date on/after "today" (in
// the series' own timezone) that falls on `weekday`, skipped forward a
// further week if that candidate's start has already happened — a brand
// new series' first occurrence is never something already in progress or
// past. Not specified verbatim in booking-domain.md; see README's
// "Documented decisions".
function firstOccurrenceDate(
  input: Pick<RecurrenceInput, 'weekday' | 'localStartMinutes' | 'timezone'>,
  now: Date,
): CalendarDate {
  const today = calendarDateInZone(now, input.timezone);
  const daysUntilWeekday = (input.weekday - weekdayOf(today) + 7) % 7;
  const candidate = addDays(today, daysUntilWeekday);

  const candidateStart = zonedDateTimeToUtc(
    candidate,
    input.localStartMinutes,
    input.timezone,
  );
  return candidateStart > now ? candidate : addDays(candidate, 7);
}

export function generateOccurrences(
  input: RecurrenceInput,
  now: Date = new Date(),
): Occurrence[] {
  const first = firstOccurrenceDate(input, now);

  const occurrences: Occurrence[] = [];
  for (let i = 0; i < input.occurrenceCount; i += 1) {
    const date = i === 0 ? first : addDays(first, 7 * i);
    occurrences.push({
      startsAt: zonedDateTimeToUtc(
        date,
        input.localStartMinutes,
        input.timezone,
      ),
      endsAt: zonedDateTimeToUtc(date, input.localEndMinutes, input.timezone),
    });
  }
  return occurrences;
}
