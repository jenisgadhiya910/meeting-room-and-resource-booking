'use client';

import { useEffect, useState } from 'react';

import { BookingListItem } from './booking-list-item';
import { RoomPagination } from '@/components/room-pagination';
import { apiFetch } from '@/lib/api-client';
import { inputClassName } from '@/lib/ui';

import type { BookingSummary } from '@/server/modules/booking/booking.repository';
import type { ChangeEvent } from 'react';

// What the client actually receives: JSON has no Date type, so every
// Date field on BookingSummary comes back over the wire as the ISO string
// it was serialised from, not a Date instance.
export type ClientBooking = Omit<
  BookingSummary,
  'startsAt' | 'endsAt' | 'createdAt' | 'cancelledAt'
> & {
  startsAt: string;
  endsAt: string;
  createdAt: string;
  cancelledAt: string | null;
};

interface BookingListResponse {
  data: ClientBooking[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function MyBookings() {
  const [bookings, setBookings] = useState<ClientBooking[] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadPage(
    targetPage: number,
    targetPageSize: number,
  ): Promise<void> {
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        pageSize: String(targetPageSize),
      });
      const response = await apiFetch<BookingListResponse>(
        `/api/bookings?${params.toString()}`,
      );
      setBookings(response.data);
      setPage(response.meta.page);
      setPageSize(response.meta.pageSize);
      setTotalItems(response.meta.totalItems);
      setTotalPages(response.meta.totalPages);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  useEffect(() => {
    // Not just `void loadPage(1, 10)` — react-hooks/set-state-in-effect
    // flags a direct call to an outer-scoped function from the effect body
    // even though its setState calls only happen after the awaited fetch
    // resolves, not synchronously. Same shape as admin-dashboard.tsx's
    // initial load for the same reason.
    async function load() {
      try {
        const response = await apiFetch<BookingListResponse>(
          '/api/bookings?page=1&pageSize=10',
        );
        setBookings(response.data);
        setPage(response.meta.page);
        setPageSize(response.meta.pageSize);
        setTotalItems(response.meta.totalItems);
        setTotalPages(response.meta.totalPages);
      } catch (err: unknown) {
        setLoadError(
          err instanceof Error ? err.message : 'Something went wrong',
        );
      }
    }

    void load();
  }, []);

  function handlePageChange(nextPage: number): void {
    void loadPage(nextPage, pageSize);
  }

  function handlePageSizeChange(event: ChangeEvent<HTMLSelectElement>): void {
    void loadPage(1, Number(event.target.value));
  }

  // Cancel (DELETE) returns 204 — no body to read the new cancelledAt from
  // — but the one thing we know for certain is the status, so that's all
  // this flips locally. Never removed from the list: a cancelled booking
  // stays visible as part of the caller's history (booking-domain.md).
  function handleCancelled(bookingId: string): void {
    setBookings((current) =>
      current === null
        ? current
        : current.map((booking) =>
            booking.id === bookingId
              ? { ...booking, status: 'CANCELLED' }
              : booking,
          ),
    );
  }

  // Shorten (PATCH) returns the full updated resource, so this swaps in
  // the server's own authoritative copy rather than guessing at a merge.
  function handleShortened(updated: ClientBooking): void {
    setBookings((current) =>
      current === null
        ? current
        : current.map((booking) =>
            booking.id === updated.id ? updated : booking,
          ),
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h1 className="mb-6 text-xl font-semibold">My bookings</h1>

      {loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      ) : null}

      {bookings === null && !loadError ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : null}

      {bookings !== null && bookings.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          You haven&apos;t booked any rooms yet.
        </p>
      ) : null}

      {bookings !== null && bookings.length > 0 ? (
        <>
          <ul className="space-y-3">
            {bookings.map((booking) => (
              <BookingListItem
                key={booking.id}
                booking={booking}
                onCancelled={handleCancelled}
                onShortened={handleShortened}
              />
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <label htmlFor="bookingsPageSize">Rows per page</label>
              <select
                id="bookingsPageSize"
                value={pageSize}
                onChange={handlePageSizeChange}
                className={inputClassName}
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <span>
                {totalItems} booking{totalItems === 1 ? '' : 's'}
              </span>
            </div>

            <RoomPagination
              page={page}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
