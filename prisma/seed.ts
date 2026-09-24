import { createHash } from 'node:crypto';

import 'dotenv/config';

import { argon2id, hash } from 'argon2';

import { prisma } from '@/server/db/prisma';

const DEMO_PASSWORD = 'Password123!';

// Fixed ids (generated once with crypto.randomUUID(), then hardcoded) so
// re-running the seed upserts the same rows instead of creating duplicates —
// rooms have no natural unique key the way users (email) and equipment (key)
// do. They must be real v4 UUIDs, not placeholder-style strings: `roomId`
// fields are validated with zod's z.uuid() everywhere, which checks the
// version/variant nibbles and rejects anything that isn't a well-formed UUID.
const ROOM_IDS = {
  alpha: 'b51e345f-28a3-49a7-a0c5-4c8bef759786',
  beta: '3c8fa20d-5c38-4531-80ac-f997ef001f6f',
  gamma: '375f5f22-c879-43aa-9453-ae4e09717507',
  delta: 'f5d708d0-c2f0-4940-9e8b-338cdc5b482e',
} as const;

// One hundred hardcoded UUIDs would be unreadable, so the bulk rooms below
// (added to exercise keyset pagination — see room.repository.ts — with more
// than one page of results) derive their id from a fixed namespace plus the
// room's own name instead: a UUID v5 per RFC 4122 §4.3. Same name always
// hashes to the same id, so re-running the seed still upserts rather than
// duplicating, without hand-listing a hundred ids the way ROOM_IDS does for
// the four named demo rooms.
const BULK_ROOM_NAMESPACE = '6f6a6c1e-6b8b-4a0a-9c8a-9f6b8f6a2f10';
const BULK_ROOM_COUNT = 100;

function deterministicRoomId(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  const hash = createHash('sha1')
    .update(namespaceBytes)
    .update(name, 'utf8')
    .digest();

  // RFC 4122 version (5) and variant nibbles — required for zod's z.uuid()
  // (and Postgres's uuid column) to accept the result as a well-formed UUID.
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x50, 6);
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8);

  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// `noUncheckedIndexedAccess` makes `items[index % items.length]` come back
// `T | undefined` even though the modulo guarantees an in-range index —
// this narrows it back without a non-null assertion.
function cyclic<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length];
  if (item === undefined)
    throw new Error('cyclic() called with an empty array');
  return item;
}

async function main() {
  const passwordHash = await hash(DEMO_PASSWORD, { type: argon2id });

  const [alice, john, admin] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'alice@example.com' },
      update: {},
      create: { email: 'alice@example.com', passwordHash },
    }),
    prisma.user.upsert({
      where: { email: 'john@example.com' },
      update: {},
      create: { email: 'john@example.com', passwordHash },
    }),
    prisma.user.upsert({
      where: { email: 'admin@example.com' },
      update: {},
      create: { email: 'admin@example.com', passwordHash, role: 'ADMIN' },
    }),
  ]);

  const [projector, videoConferencing, whiteboard] = await Promise.all([
    prisma.equipment.upsert({
      where: { key: 'projector' },
      update: { label: 'Projector' },
      create: { key: 'projector', label: 'Projector' },
    }),
    prisma.equipment.upsert({
      where: { key: 'video_conferencing' },
      update: { label: 'Video conferencing' },
      create: { key: 'video_conferencing', label: 'Video conferencing' },
    }),
    prisma.equipment.upsert({
      where: { key: 'whiteboard' },
      update: { label: 'Whiteboard' },
      create: { key: 'whiteboard', label: 'Whiteboard' },
    }),
  ]);

  const namedRooms = [
    {
      id: ROOM_IDS.alpha,
      name: 'Alpha',
      location: 'Floor 1',
      capacity: 4,
      equipment: [whiteboard],
    },
    {
      id: ROOM_IDS.beta,
      name: 'Beta',
      location: 'Floor 1',
      capacity: 8,
      equipment: [projector, whiteboard],
    },
    {
      id: ROOM_IDS.gamma,
      name: 'Gamma',
      location: 'Floor 2',
      capacity: 12,
      equipment: [projector, videoConferencing, whiteboard],
    },
    {
      id: ROOM_IDS.delta,
      name: 'Delta',
      location: 'Floor 2',
      capacity: 2,
      equipment: [],
    },
  ];

  // Capacities repeat on purpose — Phase 9's keyset cursor has to stay
  // stable once several rooms tie on the sort column, and that only gets
  // exercised if the seed data actually ties.
  const bulkCapacities = [2, 4, 6, 8, 10, 12, 15, 20, 25, 30];
  const bulkEquipmentCycle = [
    [],
    [whiteboard],
    [projector, whiteboard],
    [projector, videoConferencing, whiteboard],
    [videoConferencing],
  ];

  const bulkRooms = Array.from({ length: BULK_ROOM_COUNT }, (_, index) => {
    const name = `Bulk Room ${String(index + 1).padStart(3, '0')}`;
    return {
      id: deterministicRoomId(BULK_ROOM_NAMESPACE, name),
      name,
      location: `Floor ${(index % 10) + 1}`,
      capacity: cyclic(bulkCapacities, index),
      equipment: cyclic(bulkEquipmentCycle, index),
    };
  });

  const rooms = [...namedRooms, ...bulkRooms];

  for (const room of rooms) {
    await prisma.$transaction(async (tx) => {
      await tx.room.upsert({
        where: { id: room.id },
        update: {
          name: room.name,
          location: room.location,
          capacity: room.capacity,
        },
        create: {
          id: room.id,
          name: room.name,
          location: room.location,
          capacity: room.capacity,
        },
      });

      await tx.roomEquipment.deleteMany({ where: { roomId: room.id } });

      if (room.equipment.length > 0) {
        await tx.roomEquipment.createMany({
          data: room.equipment.map((item) => ({
            roomId: room.id,
            equipmentId: item.id,
          })),
        });
      }
    });
  }

  console.log(
    `Seeded users: ${alice.email} (USER), ${john.email} (USER), ${admin.email} (ADMIN) — password: ${DEMO_PASSWORD}`,
  );
  console.log(
    `Seeded equipment: ${projector.key}, ${videoConferencing.key}, ${whiteboard.key}`,
  );
  console.log(
    `Seeded rooms: ${namedRooms.length} named (${namedRooms.map((room) => room.name).join(', ')}) + ${bulkRooms.length} bulk`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
