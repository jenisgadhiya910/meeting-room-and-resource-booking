'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { RoomPagination } from '@/components/room-pagination';
import { apiFetch } from '@/lib/api-client';
import {
  inputClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from '@/lib/ui';
import {
  roomSortSchema,
  sortOrderSchema,
} from '@/server/modules/room/room.schema';

import type {
  EquipmentSummary,
  RoomSummary,
} from '@/server/modules/room/room.repository';
import type { RoomSort, SortOrder } from '@/server/modules/room/room.schema';
import type { ChangeEvent, FormEvent } from 'react';

interface RoomListMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

interface RoomListResponse {
  data: RoomSummary[];
  meta: RoomListMeta;
}

interface EquipmentListResponse {
  data: EquipmentSummary[];
  meta: { nextCursor: string | null };
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [equipmentOptions, setEquipmentOptions] = useState<EquipmentSummary[]>(
    [],
  );

  const [date, setDate] = useState(todayLocalDate);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [minCapacity, setMinCapacity] = useState('');
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);

  // Seeded from the URL so a reload or a shared link keeps the chosen sort —
  // an id-only page like this one has no other state worth round-tripping.
  const [sort, setSort] = useState<RoomSort>(() => {
    const parsed = roomSortSchema.safeParse(searchParams.get('sort'));
    return parsed.success ? parsed.data : 'name';
  });
  const [order, setOrder] = useState<SortOrder>(() => {
    const parsed = sortOrderSchema.safeParse(searchParams.get('order'));
    return parsed.success ? parsed.data : 'asc';
  });

  const [results, setResults] = useState<RoomSummary[] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
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

  // `overrides` lets a sort/order/page/pageSize change build the request
  // with the new value immediately, rather than the state from before that
  // change's re-render.
  function buildAvailabilityParams(overrides?: {
    sort?: RoomSort;
    order?: SortOrder;
    page?: number;
    pageSize?: number;
  }): URLSearchParams {
    const from = toIsoDateTime(date, startTime);
    const to = toIsoDateTime(date, endTime);
    if (new Date(to) <= new Date(from)) {
      throw new Error('End time must be after start time.');
    }

    const params = new URLSearchParams({
      from,
      to,
      sort: overrides?.sort ?? sort,
      order: overrides?.order ?? order,
      page: String(overrides?.page ?? page),
      pageSize: String(overrides?.pageSize ?? pageSize),
    });
    if (minCapacity) params.set('minCapacity', minCapacity);
    for (const key of selectedEquipment) params.append('equipment', key);
    return params;
  }

  async function search(overrides?: {
    sort?: RoomSort;
    order?: SortOrder;
    page?: number;
    pageSize?: number;
  }): Promise<void> {
    setSearchError(null);
    setIsSearching(true);

    try {
      const params = buildAvailabilityParams(overrides);
      const response = await apiFetch<RoomListResponse>(
        `/api/rooms/availability?${params.toString()}`,
      );
      setResults(response.data);
      setPage(response.meta.page);
      setTotalItems(response.meta.totalItems);
      setTotalPages(response.meta.totalPages);
    } catch (err: unknown) {
      setSearchError(
        err instanceof Error ? err.message : 'Something went wrong',
      );
    } finally {
      setIsSearching(false);
    }
  }

  function updateSortInUrl(nextSort: RoomSort, nextOrder: SortOrder): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sort', nextSort);
    params.set('order', nextOrder);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function handleSortChange(event: ChangeEvent<HTMLSelectElement>): void {
    const parsed = roomSortSchema.safeParse(event.target.value);
    if (!parsed.success) return;

    setSort(parsed.data);
    updateSortInUrl(parsed.data, order);
    // Only re-run a search that's already happened — before that, the new
    // sort just takes effect on the next explicit search. A sort change
    // always jumps back to page 1: page 6 of a "by name" search has no
    // relationship to page 6 of a "by capacity" one.
    if (results !== null) void search({ sort: parsed.data, page: 1 });
  }

  function handleOrderToggle(): void {
    const nextOrder: SortOrder = order === 'asc' ? 'desc' : 'asc';
    setOrder(nextOrder);
    updateSortInUrl(sort, nextOrder);
    if (results !== null) void search({ order: nextOrder, page: 1 });
  }

  function handlePageSizeChange(event: ChangeEvent<HTMLSelectElement>): void {
    const nextPageSize = Number(event.target.value);
    setPageSize(nextPageSize);
    if (results !== null) void search({ pageSize: nextPageSize, page: 1 });
  }

  function handlePageChange(nextPage: number): void {
    void search({ page: nextPage });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void search({ page: 1 });
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

        <div className="flex flex-wrap items-end gap-4 sm:col-span-2">
          <div className="space-y-1">
            <label htmlFor="sort" className="block text-sm font-medium">
              Sort by
            </label>
            <select
              id="sort"
              value={sort}
              onChange={handleSortChange}
              className={inputClassName}
            >
              <option value="name">Name</option>
              <option value="capacity">Capacity</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleOrderToggle}
            className={secondaryButtonClassName}
            aria-label={`Currently sorted ${order === 'asc' ? 'ascending' : 'descending'}. Click to sort ${order === 'asc' ? 'descending' : 'ascending'}.`}
          >
            {order === 'asc' ? 'Ascending ↑' : 'Descending ↓'}
          </button>
        </div>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={isSearching}
            className={primaryButtonClassName}
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

      {results !== null && results.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <label htmlFor="pageSize">Rows per page</label>
            <select
              id="pageSize"
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
              {totalItems} room{totalItems === 1 ? '' : 's'}
            </span>
          </div>

          <RoomPagination
            page={page}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        </div>
      ) : null}
    </div>
  );
}
