'use client';

import { useState } from 'react';

import { apiFetch } from '@/lib/api-client';
import {
  dangerButtonClassName,
  inputClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from '@/lib/ui';

import type {
  AdminRoomSummary,
  EquipmentSummary,
} from '@/server/modules/room/room.repository';
import type { UpdateRoomInput } from '@/server/modules/room/room.schema';
import type { FormEvent } from 'react';

interface Props {
  room: AdminRoomSummary;
  equipmentOptions: EquipmentSummary[];
  onUpdated: (room: AdminRoomSummary) => void;
  onDeleted: (roomId: string) => void;
}

export function RoomListItem({
  room,
  equipmentOptions,
  onUpdated,
  onDeleted,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const [name, setName] = useState(room.name);
  const [location, setLocation] = useState(room.location);
  const [capacity, setCapacity] = useState(String(room.capacity));
  const [active, setActive] = useState(room.active);
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>(
    room.equipment.map((item) => item.key),
  );

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleEquipment(key: string, checked: boolean): void {
    setSelectedEquipment((current) =>
      checked ? [...current, key] : current.filter((value) => value !== key),
    );
  }

  function resetFormFields(): void {
    setName(room.name);
    setLocation(room.location);
    setCapacity(String(room.capacity));
    setActive(room.active);
    setSelectedEquipment(room.equipment.map((item) => item.key));
    setError(null);
  }

  async function saveEdit() {
    setError(null);
    setIsSubmitting(true);

    try {
      const body: UpdateRoomInput = {
        name,
        location,
        capacity: Number(capacity),
        active,
        equipmentKeys: selectedEquipment,
      };
      const updated = await apiFetch<AdminRoomSummary>(
        `/api/admin/rooms/${room.id}`,
        { method: 'PATCH', body },
      );
      onUpdated({ ...updated, active });
      setIsEditing(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmDelete() {
    setError(null);
    setIsSubmitting(true);

    try {
      await apiFetch(`/api/admin/rooms/${room.id}`, { method: 'DELETE' });
      onDeleted(room.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setIsSubmitting(false);
      setIsConfirmingDelete(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void saveEdit();
  }

  function handleEditClick(): void {
    setIsEditing(true);
  }

  function handleCancelEditClick(): void {
    resetFormFields();
    setIsEditing(false);
  }

  function handleDeleteClick(): void {
    setError(null);
    setIsConfirmingDelete(true);
  }

  function handleCancelDeleteClick(): void {
    setIsConfirmingDelete(false);
  }

  function handleConfirmDeleteClick(): void {
    void confirmDelete();
  }

  if (isEditing) {
    return (
      <li className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              required
              placeholder="Name"
              className={inputClassName}
            />
            <input
              value={location}
              onChange={(event) => {
                setLocation(event.target.value);
              }}
              required
              placeholder="Location"
              className={inputClassName}
            />
            <input
              type="number"
              min={1}
              value={capacity}
              onChange={(event) => {
                setCapacity(event.target.value);
              }}
              required
              placeholder="Capacity"
              className={inputClassName}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => {
                  setActive(event.target.checked);
                }}
              />
              Active
            </label>
          </div>

          {equipmentOptions.length > 0 ? (
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
          ) : null}

          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className={primaryButtonClassName}
            >
              {isSubmitting ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleCancelEditClick}
              disabled={isSubmitting}
              className={secondaryButtonClassName}
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{room.name}</span>
            {!room.active ? (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                inactive
              </span>
            ) : null}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {room.location} · Capacity {room.capacity}
          </p>
          {room.equipment.length > 0 ? (
            <p className="mt-1 text-sm">
              {room.equipment.map((item) => item.label).join(', ')}
            </p>
          ) : null}
        </div>

        {isConfirmingDelete ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-sm">Delete this room?</span>
            <button
              type="button"
              onClick={handleConfirmDeleteClick}
              disabled={isSubmitting}
              className={dangerButtonClassName}
            >
              {isSubmitting ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button
              type="button"
              onClick={handleCancelDeleteClick}
              disabled={isSubmitting}
              className={secondaryButtonClassName}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={handleEditClick}
              className={secondaryButtonClassName}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={handleDeleteClick}
              className={dangerButtonClassName}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {error ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </li>
  );
}
