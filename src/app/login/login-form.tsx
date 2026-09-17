'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { apiFetch, ApiError } from '@/lib/api-client';

import type { SessionUser } from '@/server/auth/session';
import type { FormEvent } from 'react';

interface LoginResponse {
  user: SessionUser;
}

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setIsSubmitting(true);

    try {
      await apiFetch<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      router.push('/');
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
