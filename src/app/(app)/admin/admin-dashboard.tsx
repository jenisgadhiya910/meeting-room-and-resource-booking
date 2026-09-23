'use client';

import { useEffect, useState } from 'react';

import { RoomPagination } from '@/components/room-pagination';
import { apiFetch } from '@/lib/api-client';
import { inputClassName } from '@/lib/ui';

import { CreateEquipmentForm } from './create-equipment-form';
import { CreateRoomForm } from './create-room-form';
import { RoomList } from './room-list';

import type {
  AdminRoomSummary,
  EquipmentSummary,
} from '@/server/modules/room/room.repository';
import type { ChangeEvent } from 'react';

interface RoomListResponse {
  data: AdminRoomSummary[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

interface EquipmentListResponse {
  data: EquipmentSummary[];
  meta: { nextCursor: string | null };
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function AdminDashboard() {
  const [rooms, setRooms] = useState<AdminRoomSummary[] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [equipmentOptions, setEquipmentOptions] = useState<EquipmentSummary[]>(
    [],
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  // Re-fetches a page of rooms from the server rather than patching the
  // local array in place — with a fixed page size, a local push/splice
  // after create/update/delete would leave this page showing the wrong
  // number of rows and a stale totalItems/totalPages. If the target page
  // turns out empty (e.g. deleting the last room on the last page), steps
  // back one page instead of showing a dead end.
  async function loadRoomsPage(targetPage: number): Promise<void> {
    try {
      const response = await apiFetch<RoomListResponse>(
        `/api/admin/rooms?page=${targetPage}&pageSize=${pageSize}`,
      );
      if (response.data.length === 0 && targetPage > 1) {
        return await loadRoomsPage(targetPage - 1);
      }
      setRooms(response.data);
      setPage(response.meta.page);
      setTotalItems(response.meta.totalItems);
      setTotalPages(response.meta.totalPages);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const [roomsResponse, equipmentResponse] = await Promise.all([
          apiFetch<RoomListResponse>('/api/admin/rooms'),
          apiFetch<EquipmentListResponse>('/api/equipment?limit=200'),
        ]);
        setRooms(roomsResponse.data);
        setPage(roomsResponse.meta.page);
        setTotalItems(roomsResponse.meta.totalItems);
        setTotalPages(roomsResponse.meta.totalPages);
        setEquipmentOptions(equipmentResponse.data);
      } catch (err: unknown) {
        setLoadError(
          err instanceof Error ? err.message : 'Something went wrong',
        );
      }
    }

    void load();
  }, []);

  function handleEquipmentCreated(equipment: EquipmentSummary): void {
    setEquipmentOptions((current) => [...current, equipment]);
  }

  function handleRoomsMutated(): void {
    void loadRoomsPage(page);
  }

  function handlePageChange(nextPage: number): void {
    void loadRoomsPage(nextPage);
  }

  function handlePageSizeChange(event: ChangeEvent<HTMLSelectElement>): void {
    setPageSize(Number(event.target.value));
    void loadRoomsPage(1);
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-10 p-6">
      <h1 className="text-xl font-semibold">Admin: rooms &amp; equipment</h1>

      {loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Create equipment type</h2>
        <CreateEquipmentForm onCreated={handleEquipmentCreated} />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Create room</h2>
        <CreateRoomForm
          equipmentOptions={equipmentOptions}
          onCreated={handleRoomsMutated}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Rooms</h2>
        {rooms === null ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : (
          <>
            <RoomList
              rooms={rooms}
              equipmentOptions={equipmentOptions}
              onUpdated={handleRoomsMutated}
              onDeleted={handleRoomsMutated}
            />

            {rooms.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                  <label htmlFor="roomsPageSize">Rows per page</label>
                  <select
                    id="roomsPageSize"
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
          </>
        )}
      </section>
    </div>
  );
}
