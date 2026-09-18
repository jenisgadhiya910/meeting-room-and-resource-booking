'use client';

import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api-client';

import type { RoomSummary } from '@/server/modules/room/room.repository';
import type { FormEvent } from 'react';

interface RoomListResponse {
  data: RoomSummary[];
  meta: { nextCursor: string | null };
}

interface EquipmentOption {
  key: string;
  label: string;
}

interface EquipmentListResponse {
  data: EquipmentOption[];
  meta: { nextCursor: string | null };
}

const inputClassName =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900';

function todayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Interprets the date+time pair as the browser's local time (how the native
// date/time inputs present them) and converts to the UTC instant the API
// expects — there's no per-user timezone setting in this app.
function toIsoDateTime(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

export function RoomSearch() {
  const [equipmentOptions, setEquipmentOptions] = useState<EquipmentOption[]>(
    [],
  );

  const [date, setDate] = useState(todayLocalDate);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [minCapacity, setMinCapacity] = useState('');
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);

  const [results, setResults] = useState<RoomSummary[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    async function loadEquipmentOptions() {
      try {
        // From the equipment catalogue directly (GET /api/equipment), not
        // derived from room search results — so a type shows up as a filter
        // option even before any room actually has it.
        const response = await apiFetch<EquipmentListResponse>(
          '/api/equipment?limit=200',
        );
        setEquipmentOptions(
          [...response.data].sort((a, b) => a.key.localeCompare(b.key)),
        );
      } catch {
        // Checkboxes are a nice-to-have; failing to load them shouldn't block searching.
      }
    }

    void loadEquipmentOptions();
  }, []);

  function toggleEquipment(key: string, checked: boolean): void {
    setSelectedEquipment((current) =>
      checked ? [...current, key] : current.filter((value) => value !== key),
    );
  }

  async function search() {
    setSearchError(null);
    setIsSearching(true);
    setResults(null);

    try {
      const from = toIsoDateTime(date, startTime);
      const to = toIsoDateTime(date, endTime);
      if (new Date(to) <= new Date(from)) {
        throw new Error('End time must be after start time.');
      }

      const params = new URLSearchParams({ from, to });
      if (minCapacity) params.set('minCapacity', minCapacity);
      for (const key of selectedEquipment) params.append('equipment', key);

      const response = await apiFetch<RoomListResponse>(
        `/api/rooms/availability?${params.toString()}`,
      );
      setResults(response.data);
    } catch (err: unknown) {
      setSearchError(
        err instanceof Error ? err.message : 'Something went wrong',
      );
    } finally {
      setIsSearching(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void search();
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h1 className="mb-6 text-xl font-semibold">Find a room</h1>

      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="date" className="block text-sm font-medium">
            Date
          </label>
          <input
            id="date"
            type="date"
            required
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
            }}
            className={inputClassName}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="minCapacity" className="block text-sm font-medium">
            Min capacity
          </label>
          <input
            id="minCapacity"
            type="number"
            min={1}
            placeholder="Any"
            value={minCapacity}
            onChange={(event) => {
              setMinCapacity(event.target.value);
            }}
            className={inputClassName}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="startTime" className="block text-sm font-medium">
            Start time
          </label>
          <input
            id="startTime"
            type="time"
            required
            value={startTime}
            onChange={(event) => {
              setStartTime(event.target.value);
            }}
            className={inputClassName}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="endTime" className="block text-sm font-medium">
            End time
          </label>
          <input
            id="endTime"
            type="time"
            required
            value={endTime}
            onChange={(event) => {
              setEndTime(event.target.value);
            }}
            className={inputClassName}
          />
        </div>

        {equipmentOptions.length > 0 ? (
          <div className="space-y-1 sm:col-span-2">
            <span className="block text-sm font-medium">Equipment</span>
            <div className="flex flex-wrap gap-4">
              {equipmentOptions.map((option) => (
                <label
                  key={option.key}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedEquipment.includes(option.key)}
                    onChange={(event) => {
                      toggleEquipment(option.key, event.target.checked);
                    }}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={isSearching}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {isSearching ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      <div className="mt-8 space-y-3">
        {searchError ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            {searchError}
          </p>
        ) : null}

        {!searchError && results === null ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Search for a time window to see available rooms.
          </p>
        ) : null}

        {results !== null && results.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No rooms are free for that window.
          </p>
        ) : null}

        {results?.map((room) => (
          <div
            key={room.id}
            className="rounded-md border border-gray-200 p-4 dark:border-gray-800"
          >
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-medium">{room.name}</span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {room.location}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Capacity: {room.capacity}
            </p>
            {room.equipment.length > 0 ? (
              <p className="mt-1 text-sm">
                {room.equipment.map((item) => item.label).join(', ')}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
