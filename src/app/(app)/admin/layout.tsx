import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';

// The parent (app)/layout.tsx already guarantees a session exists; this adds
// the role check, server-side — not a hidden nav link a non-admin could
// still reach directly.
export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const session = await getSession();
  if (session?.role !== 'ADMIN') redirect('/');

  return <>{children}</>;
}
