'use client';

import { useEffect, useState } from 'react';

import { ApiError, apiFetch, specificMessage } from '@/lib/api-client';
import { formatBookableWindow } from '@/lib/format';
import { inputClassName, primaryButtonClassName } from '@/lib/ui';

import { AllRoomsTable } from './all-rooms-table';
import { RoomWeeksTable } from './room-weeks-table';

import type { AdminRoomSummary } from '@/server/modules/room/room.repository';
import type { UtilisationQuery } from '@/server/modules/utilisation/utilisation.schema';
import type {
  RoomUtilisation,
  UtilisationReport,
  WeekUtilisation,
} from '@/server/modules/utilisation/utilisation.service';
import type { FormEvent } from 'react';

// JSON has no Date type — weekStart arrives as the ISO string it was
// serialised from. Same idea as my-bookings.tsx's ClientBooking.
export type ClientRoomUtilisation = Omit<RoomUtilisation, 'weeks'> & {
  weeks: (Omit<WeekUtilisation, 'weekStart'> & { weekStart: string })[];
};

interface UtilisationResponse {
  data: ClientRoomUtilisation[];
  meta: {
    from: string;
    to: string;
    bookableWindow: UtilisationReport['bookableWindow'];
  };
}

interface RoomListResponse {
  data: AdminRoomSummary[];
  meta: { totalItems: number };
}

// GET /api/admin/rooms's hard cap. Enough for a selector at this POC's
// scale; the "All rooms" view still covers every room regardless.
const ROOM_OPTIONS_LIMIT = 200;
const DEFAULT_WEEKS = 4;

// YYYY-MM-DD for a browser-local calendar date — what <input type="date">
// reads and writes, and what the API's `from`/`to` expect.
function toDateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// This week (Monday) through the Sunday DEFAULT_WEEKS weeks later — already
// whole weeks, so the default range doesn't depend on the API's snapping.
function defaultRange(): { from: string; to: string } {
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + DEFAULT_WEEKS * 7 - 1);
  return { from: toDateInputValue(monday), to: toDateInputValue(sunday) };
}

function utilisationPath(query: UtilisationQuery): string {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.roomId) params.set('roomId', query.roomId);
  return `/api/admin/utilisation?${params.toString()}`;
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) return specificMessage(err);
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function UtilisationDashboard() {
  const [initialRange] = useState(defaultRange);
  const [roomOptions, setRoomOptions] = useState<AdminRoomSummary[]>([]);
  const [totalRooms, setTotalRooms] = useState(0);
  const [roomId, setRoomId] = useState('');
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [report, setReport] = useState<UtilisationResponse | null>(null);
  // Which room the *loaded* report is for — not `roomId`, which follows the
  // select as soon as it changes, before the form is submitted.
  const [reportRoomId, setReportRoomId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [roomsResponse, utilisationResponse] = await Promise.all([
          apiFetch<RoomListResponse>(
            `/api/admin/rooms?pageSize=${ROOM_OPTIONS_LIMIT}&sort=name&order=asc`,
          ),
          apiFetch<UtilisationResponse>(utilisationPath(initialRange)),
        ]);
        setRoomOptions(roomsResponse.data);
        setTotalRooms(roomsResponse.meta.totalItems);
        setReport(utilisationResponse);
      } catch (err: unknown) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [initialRange]);

  async function loadReport(query: UtilisationQuery): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setReport(await apiFetch<UtilisationResponse>(utilisationPath(query)));
      setReportRoomId(query.roomId ?? null);
    } catch (err: unknown) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void loadReport(roomId ? { roomId, from, to } : { from, to });
  }

  // Drilling into one room from the all-rooms table keeps the same range.
  function handleSelectRoom(selectedRoomId: string): void {
    setRoomId(selectedRoomId);
    void loadReport({ roomId: selectedRoomId, from, to });
  }

  const singleRoom = reportRoomId ? report?.data[0] : undefined;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Admin: utilisation</h1>
        {report ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Hours booked vs. available per week. Available:{' '}
            {formatBookableWindow(report.meta.bookableWindow)}. Weeks start on
            Monday; only confirmed bookings count.
          </p>
        ) : null}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-4"
        aria-label="Utilisation filters"
      >
        <div className="min-w-48 flex-1 space-y-1">
          <label htmlFor="utilisationRoom" className="text-sm font-medium">
            Room
          </label>
          <select
            id="utilisationRoom"
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            className={inputClassName}
          >
            <option value="">All rooms</option>
            {roomOptions.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
                {room.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="utilisationFrom" className="text-sm font-medium">
            From
          </label>
          <input
            id="utilisationFrom"
            type="date"
            required
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            className={inputClassName}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="utilisationTo" className="text-sm font-medium">
            To
          </label>
          <input
            id="utilisationTo"
            type="date"
            required
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
            className={inputClassName}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className={primaryButtonClassName}
        >
          {loading ? 'Loading…' : 'Show utilisation'}
        </button>
      </form>

      {totalRooms > roomOptions.length ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          The room list shows the first {roomOptions.length} of {totalRooms}{' '}
          rooms; &ldquo;All rooms&rdquo; still includes every one.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {report === null ? (
        loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : null
      ) : report.data.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No rooms yet.
        </p>
      ) : singleRoom ? (
        <RoomWeeksTable
          room={singleRoom}
          timeZone={report.meta.bookableWindow.timeZone}
        />
      ) : (
        <AllRoomsTable
          rooms={report.data}
          timeZone={report.meta.bookableWindow.timeZone}
          onSelectRoom={handleSelectRoom}
        />
      )}
    </div>
  );
}
