'use client';

import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api-client';

import { CreateEquipmentForm } from './create-equipment-form';
import { CreateRoomForm } from './create-room-form';
import { RoomList } from './room-list';

import type {
  AdminRoomSummary,
  EquipmentSummary,
} from '@/server/modules/room/room.repository';

interface RoomListResponse {
  data: AdminRoomSummary[];
  meta: { nextCursor: string | null };
}

interface EquipmentListResponse {
  data: EquipmentSummary[];
  meta: { nextCursor: string | null };
}

export function AdminDashboard() {
  const [rooms, setRooms] = useState<AdminRoomSummary[] | null>(null);
  const [equipmentOptions, setEquipmentOptions] = useState<EquipmentSummary[]>(
    [],
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [roomsResponse, equipmentResponse] = await Promise.all([
          apiFetch<RoomListResponse>('/api/admin/rooms?limit=200'),
          apiFetch<EquipmentListResponse>('/api/equipment?limit=200'),
        ]);
        setRooms(roomsResponse.data);
        setEquipmentOptions(equipmentResponse.data);
      } catch (err: unknown) {
        setLoadError(
          err instanceof Error ? err.message : 'Something went wrong',
        );
      }
    }

    void load();
  }, []);

  function handleRoomCreated(room: AdminRoomSummary): void {
    setRooms((current) => (current ? [...current, room] : [room]));
  }

  function handleEquipmentCreated(equipment: EquipmentSummary): void {
    setEquipmentOptions((current) => [...current, equipment]);
  }

  function handleRoomUpdated(updated: AdminRoomSummary): void {
    setRooms(
      (current) =>
        current?.map((room) => (room.id === updated.id ? updated : room)) ??
        current,
    );
  }

  function handleRoomDeleted(roomId: string): void {
    setRooms(
      (current) => current?.filter((room) => room.id !== roomId) ?? current,
    );
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
          onCreated={handleRoomCreated}
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Rooms</h2>
        {rooms === null ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : (
          <RoomList
            rooms={rooms}
            equipmentOptions={equipmentOptions}
            onUpdated={handleRoomUpdated}
            onDeleted={handleRoomDeleted}
          />
        )}
      </section>
    </div>
  );
}
