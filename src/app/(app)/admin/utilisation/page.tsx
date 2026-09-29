import { redirect } from 'next/navigation';

import { getSession } from '@/server/auth/session';

import { UtilisationDashboard } from './utilisation-dashboard';

// Checked again here, not just in admin/layout.tsx: layouts don't re-render
// on client-side navigation (Next.js partial rendering), so a layout-only
// check isn't one that runs on every route change. The data itself is
// protected independently — GET /api/admin/utilisation is `{ role: 'ADMIN' }`.
export default async function UtilisationPage() {
  const session = await getSession();
  if (session?.role !== 'ADMIN') redirect('/');

  return <UtilisationDashboard />;
}
