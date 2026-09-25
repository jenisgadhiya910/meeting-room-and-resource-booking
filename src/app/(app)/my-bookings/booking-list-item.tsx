'use client';

import { useState } from 'react';

import { ApiError, apiFetch } from '@/lib/api-client';
import { formatDateTimeRange } from '@/lib/format';
import {
  dangerButtonClassName,
  inputClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from '@/lib/ui';

import type { ClientBooking } from './my-bookings';
import type { ShortenBookingInput } from '@/server/modules/booking/booking.schema';
import type { FormEvent } from 'react';

interface Props {
  booking: ClientBooking;
  onCancelled: (bookingId: string) => void;
  onShortened: (booking: ClientBooking) => void;
}

// The same HH:MM shape a native <input type="time"> reads and writes, in
// the booking's own end date's local time.
function timeInputValue(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

function parseTimeInput(
  value: string,
): { hours: number; minutes: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, hoursText, minutesText] = match;
  if (hoursText === undefined || minutesText === undefined) return null;
  return { hours: Number(hoursText), minutes: Number(minutesText) };
}

// The roadmap calls this out by name ("surface BOOKING_NOT_MODIFIABLE
// clearly"); everything else falls back to the server's own message, which
// already reads fine as-is (e.g. the "moving it later is a new booking"
// validation text).
function messageFor(error: ApiError): string {
  switch (error.code) {
    case 'BOOKING_NOT_MODIFIABLE':
      return 'This booking can no longer be changed.';
    case 'FORBIDDEN':
      return "You don't have permission to change this booking.";
    case 'UNAUTHENTICATED':
      return 'Your session has expired. Please log in again.';
    default:
      return error.message;
  }
}

export function BookingListItem({ booking, onCancelled, onShortened }: Props) {
  const [isShortening, setIsShortening] = useState(false);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [newEndTime, setNewEndTime] = useState(() =>
    timeInputValue(booking.endsAt),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleApiError(err: unknown): void {
    setError(
      err instanceof ApiError
        ? messageFor(err)
        : 'Something went wrong. Please try again.',
    );
  }

  async function submitShorten(): Promise<void> {
    const parsed = parseTimeInput(newEndTime);
    if (!parsed) {
      setError('Enter a valid time.');
      return;
    }

    // Only the time of day changes — a "simple time picker" (roadmap), not
    // a full date+time one, so the booking's own end date is kept as-is.
    const endDate = new Date(booking.endsAt);
    endDate.setHours(parsed.hours, parsed.minutes, 0, 0);

    setError(null);
    setIsSubmitting(true);
    try {
      const body: ShortenBookingInput = { endsAt: endDate.toISOString() };
      const updated = await apiFetch<ClientBooking>(
        `/api/bookings/${booking.id}`,
        { method: 'PATCH', body },
      );
      onShortened(updated);
      setIsShortening(false);
    } catch (err: unknown) {
      handleApiError(err);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmCancel(): Promise<void> {
    setError(null);
    setIsSubmitting(true);
    try {
      await apiFetch(`/api/bookings/${booking.id}`, { method: 'DELETE' });
      onCancelled(booking.id);
      setIsConfirmingCancel(false);
    } catch (err: unknown) {
      handleApiError(err);
      setIsConfirmingCancel(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleShortenSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submitShorten();
  }

  function handleShortenClick(): void {
    setError(null);
    setNewEndTime(timeInputValue(booking.endsAt));
    setIsShortening(true);
  }

  function handleCancelShortenClick(): void {
    setIsShortening(false);
  }

  function handleCancelClick(): void {
    setError(null);
    setIsConfirmingCancel(true);
  }

  function handleCancelCancelClick(): void {
    setIsConfirmingCancel(false);
  }

  function handleConfirmCancelClick(): void {
    void confirmCancel();
  }

  const isCancelled = booking.status === 'CANCELLED';
  // Not live-ticking — recomputed on whatever re-render already happens
  // (a mutation, opening the shorten form, typing in it), which is close
  // enough for a label; this isn't the source of truth the way the
  // server's own now()-based checks are (booking.service.ts), so a few
  // stale seconds here can never let a stale action through — the request
  // would still 409 BOOKING_NOT_MODIFIABLE if it somehow got sent.
  const hasEnded = new Date() >= new Date(booking.endsAt);
  const hasStarted = new Date() >= new Date(booking.startsAt);
  const canModify = !isCancelled && !hasStarted;

  let statusLabel: string | null = null;
  if (isCancelled) statusLabel = 'cancelled';
  else if (hasEnded) statusLabel = 'completed';
  else if (hasStarted) statusLabel = 'in progress';

  return (
    <li className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{booking.roomSnapshot.name}</span>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {booking.roomSnapshot.location}
            </span>
            {statusLabel ? (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                {statusLabel}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {formatDateTimeRange(booking.startsAt, booking.endsAt)}
          </p>
        </div>

        {canModify && !isShortening && !isConfirmingCancel ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={handleShortenClick}
              className={secondaryButtonClassName}
            >
              Shorten
            </button>
            <button
              type="button"
              onClick={handleCancelClick}
              className={dangerButtonClassName}
            >
              Cancel booking
            </button>
          </div>
        ) : null}

        {canModify && isConfirmingCancel ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-sm">Cancel this booking?</span>
            <button
              type="button"
              onClick={handleConfirmCancelClick}
              disabled={isSubmitting}
              className={dangerButtonClassName}
            >
              {isSubmitting ? 'Cancelling…' : 'Yes, cancel'}
            </button>
            <button
              type="button"
              onClick={handleCancelCancelClick}
              disabled={isSubmitting}
              className={secondaryButtonClassName}
            >
              Never mind
            </button>
          </div>
        ) : null}
      </div>

      {canModify && isShortening ? (
        <form
          onSubmit={handleShortenSubmit}
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3 dark:border-gray-800"
        >
          <div className="space-y-1">
            <label
              htmlFor={`shorten-${booking.id}`}
              className="block text-sm font-medium"
            >
              New end time
            </label>
            <input
              id={`shorten-${booking.id}`}
              type="time"
              required
              max={timeInputValue(booking.endsAt)}
              value={newEndTime}
              onChange={(event) => {
                setNewEndTime(event.target.value);
              }}
              className={inputClassName}
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className={primaryButtonClassName}
          >
            {isSubmitting ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={handleCancelShortenClick}
            disabled={isSubmitting}
            className={secondaryButtonClassName}
          >
            Cancel
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </li>
  );
}
