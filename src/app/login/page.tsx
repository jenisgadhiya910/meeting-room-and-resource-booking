import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';

import { LoginForm } from './login-form';

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect('/');

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Meeting Room Booking</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Sign in to search and book a room.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
