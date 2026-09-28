'use client';

import { useState } from 'react';
import { z } from 'zod';

import { ApiError, apiFetch, specificMessage } from '@/lib/api-client';
import { formatDateTimeRange, timeInputValue } from '@/lib/format';
import {
  inputClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from '@/lib/ui';

import type { CreateRecurringBookingInput } from '@/server/modules/booking/booking.schema';
import type { ChangeEvent, FormEvent } from 'react';

interface Props {
  roomId: string;
  // The slot the caller searched for — used only to seed sensible defaults
  // (its weekday and time-of-day), never sent as-is: a recurring booking is
  // defined by a weekday + time-of-day + timezone, not one specific instant.
  startsAt: string;
  endsAt: string;
  onCancel: () => void;
}

const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const DEFAULT_OCCURRENCE_COUNT = 8;

interface SeriesConflict {
  occurrenceStartsAt: string;
  occurrenceEndsAt: string;
}

// Matches booking.repository.ts's SeriesConflict shape as it comes over the
// wire (strings, not Dates) — parsed rather than asserted, since it's
// crossing a real boundary (the error envelope's untyped `details`), same
// principle as any other DB/HTTP-boundary `unknown` in this codebase.
const seriesErrorDetailsSchema = z.object({
  conflicts: z.array(
    z.object({
      occurrenceStartsAt: z.string(),
      occurrenceEndsAt: z.string(),
    }),
  ),
});

function extractSeriesConflicts(details: unknown): SeriesConflict[] | null {
  const parsed = seriesErrorDetailsSchema.safeParse(details);
  return parsed.success ? parsed.data.conflicts : null;
}

interface FormError {
  message: string;
  conflicts: SeriesConflict[] | null;
}

interface CreatedSeriesResponse {
  series: { occurrenceCount: number };
  occurrences: unknown[];
}

function messageFor(error: ApiError): string {
  switch (error.code) {
    case 'ROOM_ALREADY_BOOKED':
      return 'This room is already booked for part of the series.';
    case 'UNAUTHENTICATED':
      return 'Your session has expired. Please log in again.';
    case 'FORBIDDEN':
      return "You don't have permission to book a room.";
    default:
      return specificMessage(error);
  }
}

export function RecurringBookingForm({
  roomId,
  startsAt,
  endsAt,
  onCancel,
}: Props) {
  const [weekday, setWeekday] = useState(() => new Date(startsAt).getDay());
  const [localStartTime, setLocalStartTime] = useState(() =>
    timeInputValue(startsAt),
  );
  const [localEndTime, setLocalEndTime] = useState(() =>
    timeInputValue(endsAt),
  );
  const [occurrenceCount, setOccurrenceCount] = useState(
    DEFAULT_OCCURRENCE_COUNT,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookedCount, setBookedCount] = useState<number | null>(null);
  const [error, setError] = useState<FormError | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    setIsSubmitting(true);
    try {
      // No per-user timezone setting anywhere in this app — the browser's
      // own zone is what "local" already means for every other date/time
      // input here too.
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const body: CreateRecurringBookingInput = {
        roomId,
        recurrence: {
          weekday,
          localStartTime,
          localEndTime,
          timezone,
          occurrenceCount,
        },
      };
      const response = await apiFetch<CreatedSeriesResponse>('/api/bookings', {
        method: 'POST',
        body,
      });
      setBookedCount(response.occurrences.length);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? {
              message: messageFor(err),
              conflicts: extractSeriesConflicts(err.details),
            }
          : {
              message: 'Something went wrong. Please try again.',
              conflicts: null,
            },
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  function handleWeekdayChange(event: ChangeEvent<HTMLSelectElement>): void {
    setWeekday(Number(event.target.value));
  }

  if (bookedCount !== null) {
    return (
      <p className="text-sm font-medium text-green-600 dark:text-green-400">
        ✓ Booked {bookedCount} weekly occurrence{bookedCount === 1 ? '' : 's'}
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-72 space-y-3 rounded-md border border-gray-200 bg-white p-3 text-left dark:border-gray-800 dark:bg-gray-900"
    >
      <p className="text-sm font-medium">Book weekly</p>

      <div className="space-y-1">
        <label
          htmlFor={`weekday-${roomId}`}
          className="block text-sm font-medium"
        >
          Repeats every
        </label>
        <select
          id={`weekday-${roomId}`}
          value={weekday}
          onChange={handleWeekdayChange}
          className={inputClassName}
        >
          {WEEKDAY_LABELS.map((label, index) => (
            <option key={label} value={index}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label
            htmlFor={`start-${roomId}`}
            className="block text-sm font-medium"
          >
            Start time
          </label>
          <input
            id={`start-${roomId}`}
            type="time"
            required
            value={localStartTime}
            onChange={(event) => {
              setLocalStartTime(event.target.value);
            }}
            className={inputClassName}
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor={`end-${roomId}`}
            className="block text-sm font-medium"
          >
            End time
          </label>
          <input
            id={`end-${roomId}`}
            type="time"
            required
            value={localEndTime}
            onChange={(event) => {
              setLocalEndTime(event.target.value);
            }}
            className={inputClassName}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label
          htmlFor={`weeks-${roomId}`}
          className="block text-sm font-medium"
        >
          Number of weeks
        </label>
        <input
          id={`weeks-${roomId}`}
          type="number"
          min={1}
          max={52}
          required
          value={occurrenceCount}
          onChange={(event) => {
            setOccurrenceCount(Number(event.target.value));
          }}
          className={inputClassName}
        />
      </div>

      {error ? (
        <div>
          <p className="text-sm text-red-600 dark:text-red-400">
            {error.message}
          </p>
          {error.conflicts ? (
            <div className="mt-1 rounded border border-red-200 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950">
              <p className="text-xs font-medium text-red-700 dark:text-red-400">
                Nothing was booked — these weeks already clash with an existing
                booking:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-red-700 dark:text-red-400">
                {error.conflicts.map((conflict) => (
                  <li key={conflict.occurrenceStartsAt}>
                    {formatDateTimeRange(
                      conflict.occurrenceStartsAt,
                      conflict.occurrenceEndsAt,
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className={primaryButtonClassName}
        >
          {isSubmitting ? 'Booking…' : 'Confirm weekly booking'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className={secondaryButtonClassName}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
