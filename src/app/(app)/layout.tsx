import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';

import { LogoutButton } from './logout-button';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await getSession();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-800">
        <nav className="flex items-center gap-4">
          <span className="font-semibold">Meeting Room Booking</span>
          <Link
            href="/"
            className="text-sm text-gray-500 hover:underline dark:text-gray-400"
          >
            Search
          </Link>
          {user.role === 'USER' ? (
            <Link
              href="/my-bookings"
              className="text-sm text-gray-500 hover:underline dark:text-gray-400"
            >
              My bookings
            </Link>
          ) : null}
          {user.role === 'ADMIN' ? (
            <Link
              href="/admin"
              className="text-sm text-gray-500 hover:underline dark:text-gray-400"
            >
              Admin
            </Link>
          ) : null}
        </nav>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-500 dark:text-gray-400">{user.email}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
