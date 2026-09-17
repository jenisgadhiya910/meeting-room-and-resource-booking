'use client';

import { useEffect, useState } from 'react';

import { apiFetch, ApiError } from '@/lib/api-client';

import type { SessionUser } from '@/server/auth/session';

interface MeResponse {
  user: SessionUser;
}

export default function HomePage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await apiFetch<MeResponse>('/api/auth/me');
        if (!cancelled) setUser(response.user);
      } catch (err: unknown) {
        if (!cancelled)
          setError(
            err instanceof ApiError ? err.message : 'Something went wrong',
          );
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="text-center">
        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : user ? (
          <>
            <p className="text-lg">
              Logged in as <span className="font-medium">{user.email}</span>
            </p>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Room search lands in Phase 6.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        )}
      </div>
    </div>
  );
}
