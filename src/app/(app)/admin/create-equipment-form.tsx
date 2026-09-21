'use client';

import { useState } from 'react';

import { apiFetch } from '@/lib/api-client';
import { inputClassName, primaryButtonClassName } from '@/lib/ui';

import type { EquipmentSummary } from '@/server/modules/room/room.repository';
import type { CreateEquipmentInput } from '@/server/modules/room/room.schema';
import type { FormEvent } from 'react';

interface Props {
  onCreated: (equipment: EquipmentSummary) => void;
}

export function CreateEquipmentForm({ onCreated }: Props) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setIsSubmitting(true);

    try {
      const body: CreateEquipmentInput = { key, label };
      const equipment = await apiFetch<EquipmentSummary>(
        '/api/admin/equipment',
        { method: 'POST', body },
      );
      onCreated(equipment);
      setKey('');
      setLabel('');
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
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label htmlFor="equipment-key" className="block text-sm font-medium">
          Key
        </label>
        <input
          id="equipment-key"
          required
          pattern="[a-z0-9_]+"
          title="Lowercase letters, numbers, and underscores only"
          placeholder="standing_desk"
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
          }}
          className={inputClassName}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="equipment-label" className="block text-sm font-medium">
          Label
        </label>
        <input
          id="equipment-label"
          required
          placeholder="Standing desk"
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
          className={inputClassName}
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className={primaryButtonClassName}
      >
        {isSubmitting ? 'Adding…' : 'Add equipment'}
      </button>

      {error ? (
        <p className="w-full text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </form>
  );
}
