'use client';

import { useState } from 'react';

import { ApiError, apiFetch } from '@/lib/api-client';
import { primaryButtonClassName, secondaryButtonClassName } from '@/lib/ui';

import type { CreateBookingInput } from '@/server/modules/booking/booking.schema';

interface Props {
  roomId: string;
  startsAt: string;
  endsAt: string;
  // Re-runs the same search that produced this result, so a 409 (or a
  // successful book) is immediately reflected in the list rather than
  // leaving a now-stale room sitting there looking available.
  onSearchAgain: () => void;
}

type Step = 'idle' | 'confirming' | 'booking' | 'booked';

interface BookingError {
  code: string;
  message: string;
}

function formatWindow(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const startText = start.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const endText = end.toLocaleTimeString(undefined, { timeStyle: 'short' });
  return `${startText} – ${endText}`;
}

// Surfaces the specific failure the roadmap calls out (409 conflict) rather
// than a generic message, and gives every other code a sensible one too —
// falling back to the server's own message for anything not called out
// here (e.g. VALIDATION_FAILED already reads fine as-is).
function messageFor(error: ApiError): string {
  switch (error.code) {
    case 'ROOM_ALREADY_BOOKED':
      return 'Someone beat you to it — this slot was just booked.';
    case 'UNAUTHENTICATED':
      return 'Your session has expired. Please log in again.';
    case 'FORBIDDEN':
      return "You don't have permission to book a room.";
    default:
      return error.message;
  }
}

export function BookRoomButton({
  roomId,
  startsAt,
  endsAt,
  onSearchAgain,
}: Props) {
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<BookingError | null>(null);

  async function confirmBooking() {
    setError(null);
    setStep('booking');

    try {
      const body: CreateBookingInput = { roomId, startsAt, endsAt };
      await apiFetch('/api/bookings', { method: 'POST', body });
      setStep('booked');
    } catch (err: unknown) {
      setStep('idle');
      setError(
        err instanceof ApiError
          ? { code: err.code, message: messageFor(err) }
          : {
              code: 'UNKNOWN',
              message: 'Something went wrong. Please try again.',
            },
      );
    }
  }

  function handleBookClick(): void {
    setError(null);
    setStep('confirming');
  }

  function handleCancelClick(): void {
    setStep('idle');
  }

  function handleConfirmClick(): void {
    void confirmBooking();
  }

  function handleSearchAgainClick(): void {
    setError(null);
    onSearchAgain();
  }

  if (step === 'booked') {
    return (
      <p className="text-sm font-medium text-green-600 dark:text-green-400">
        ✓ Booked
      </p>
    );
  }

  if (step === 'confirming' || step === 'booking') {
    return (
      <div className="flex flex-col items-end gap-2 text-right">
        <span className="text-sm">
          Book for {formatWindow(startsAt, endsAt)}?
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirmClick}
            disabled={step === 'booking'}
            className={primaryButtonClassName}
          >
            {step === 'booking' ? 'Booking…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={handleCancelClick}
            disabled={step === 'booking'}
            className={secondaryButtonClassName}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2 text-right">
      <button
        type="button"
        onClick={handleBookClick}
        className={primaryButtonClassName}
      >
        Book
      </button>

      {error ? (
        <div>
          <p className="text-sm text-red-600 dark:text-red-400">
            {error.message}
          </p>
          {error.code === 'ROOM_ALREADY_BOOKED' ? (
            <button
              type="button"
              onClick={handleSearchAgainClick}
              className="text-sm underline"
            >
              Search again
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
