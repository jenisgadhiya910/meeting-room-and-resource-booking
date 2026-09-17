'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { apiFetch } from '@/lib/api-client';

export function LogoutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    setIsSubmitting(true);

    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  function handleClick(): void {
    void submit();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isSubmitting}
      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-700"
    >
      Log out
    </button>
  );
}
