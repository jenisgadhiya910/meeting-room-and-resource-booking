'use client';

import { useState } from 'react';

import { apiFetch } from '@/lib/api-client';
import { inputClassName, primaryButtonClassName } from '@/lib/ui';

import type {
  AdminRoomSummary,
  EquipmentSummary,
  RoomSummary,
} from '@/server/modules/room/room.repository';
import type { CreateRoomInput } from '@/server/modules/room/room.schema';
import type { FormEvent } from 'react';

interface Props {
  equipmentOptions: EquipmentSummary[];
  onCreated: (room: AdminRoomSummary) => void;
}

export function CreateRoomForm({ equipmentOptions, onCreated }: Props) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState('');
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleEquipment(key: string, checked: boolean): void {
    setSelectedEquipment((current) =>
      checked ? [...current, key] : current.filter((value) => value !== key),
    );
  }

  async function submit() {
    setError(null);
    setIsSubmitting(true);

    try {
      const body: CreateRoomInput = {
        name,
        location,
        capacity: Number(capacity),
        equipmentKeys: selectedEquipment,
      };
      const room = await apiFetch<RoomSummary>('/api/admin/rooms', {
        method: 'POST',
        body,
      });
      // A freshly created room is always active — the create endpoint
      // doesn't return `active` since the public RoomSummary shape omits it.
      onCreated({ ...room, active: true });
      setName('');
      setLocation('');
      setCapacity('');
      setSelectedEquipment([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1">
        <label htmlFor="room-name" className="block text-sm font-medium">
          Name
        </label>
        <input
          id="room-name"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          className={inputClassName}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="room-location" className="block text-sm font-medium">
          Location
        </label>
        <input
          id="room-location"
          required
          value={location}
          onChange={(event) => {
            setLocation(event.target.value);
          }}
          className={inputClassName}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="room-capacity" className="block text-sm font-medium">
          Capacity
        </label>
        <input
          id="room-capacity"
          type="number"
          min={1}
          required
          value={capacity}
          onChange={(event) => {
            setCapacity(event.target.value);
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

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">
          {error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className={primaryButtonClassName}
        >
          {isSubmitting ? 'Creating…' : 'Create room'}
        </button>
      </div>
    </form>
  );
}
