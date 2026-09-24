import { getSession } from '@/server/auth/session';

import { RoomSearch } from './room-search';

export default async function HomePage() {
  const user = await getSession();
  return <RoomSearch canBook={user?.role === 'USER'} />;
}
