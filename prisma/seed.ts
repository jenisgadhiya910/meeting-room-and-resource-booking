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

async function main() {
  const passwordHash = await hash(DEMO_PASSWORD, { type: argon2id });

  const [alice, admin] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'alice@example.com' },
      update: {},
      create: { email: 'alice@example.com', passwordHash },
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

  const rooms = [
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
    `Seeded users: ${alice.email} (USER), ${admin.email} (ADMIN) — password: ${DEMO_PASSWORD}`,
  );
  console.log(
    `Seeded equipment: ${projector.key}, ${videoConferencing.key}, ${whiteboard.key}`,
  );
  console.log(`Seeded rooms: ${rooms.map((room) => room.name).join(', ')}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
