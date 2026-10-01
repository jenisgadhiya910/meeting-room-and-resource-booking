import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';

import { TEST_DATABASE_URL } from './e2e-env';

import type { AuditAction } from '@/generated/prisma/enums';

// Direct database access for the two things the API can't do on its own:
// asserting what landed in audit_events, and arranging bookings that have
// already started or ended (the API only ever sees "now").
export const testDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
});

// Prefixes every room and equipment key a test creates, so the reset below
// can remove them without touching the seeded catalogue.
export const E2E_ROOM_PREFIX = 'E2E ';
export const E2E_EQUIPMENT_PREFIX = 'e2e_';

export async function resetTestData(): Promise<void> {
  await testDb.$executeRawUnsafe(
    'TRUNCATE "audit_events", "bookings", "booking_series"',
  );
  await testDb.room.deleteMany({
    where: { name: { startsWith: E2E_ROOM_PREFIX } },
  });
  await testDb.equipment.deleteMany({
    where: { key: { startsWith: E2E_EQUIPMENT_PREFIX } },
  });
}

export async function userIdByEmail(email: string): Promise<string> {
  const user = await testDb.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  return user.id;
}

export interface InsertBookingParams {
  roomId: string;
  email: string;
  startsAt: Date;
  endsAt: Date;
  seriesId?: string;
}

export async function insertBooking(
  params: InsertBookingParams,
): Promise<string> {
  const booking = await testDb.booking.create({
    data: {
      roomId: params.roomId,
      userId: await userIdByEmail(params.email),
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      seriesId: params.seriesId ?? null,
      roomSnapshot: {
        name: 'Seeded',
        location: '',
        capacity: 1,
        equipment: [],
      },
    },
    select: { id: true },
  });
  return booking.id;
}

export async function auditActionsFor(
  bookingId: string,
): Promise<AuditAction[]> {
  const events = await testDb.auditEvent.findMany({
    where: { bookingId },
    orderBy: { occurredAt: 'asc' },
    select: { action: true },
  });
  return events.map((event) => event.action);
}
