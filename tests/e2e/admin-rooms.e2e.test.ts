import { randomUUID } from 'node:crypto';

import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ADMIN_EMAIL,
  ALICE_EMAIL,
  SEEDED_ROOM_COUNT,
  api,
  bookingSchema,
  errorOf,
  login,
  pageOf,
} from './support/api-client';
import {
  E2E_EQUIPMENT_PREFIX,
  E2E_ROOM_PREFIX,
  insertBooking,
  resetTestData,
  testDb,
} from './support/test-db';
import { futureIso, minutesFromNow } from './support/time';

import type {
  CreateEquipmentInput,
  CreateRoomInput,
} from '@/server/modules/room/room.schema';

const roomSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  location: z.string(),
  capacity: z.number().int(),
  equipment: z.array(z.object({ key: z.string(), label: z.string() })),
});

const adminRoomSchema = roomSchema.extend({ active: z.boolean() });

let adminCookie: string;
let userCookie: string;

beforeAll(async () => {
  [adminCookie, userCookie] = await Promise.all([
    login(ADMIN_EMAIL),
    login(ALICE_EMAIL),
  ]);
});

beforeEach(async () => {
  await resetTestData();
});

afterAll(async () => {
  await testDb.$disconnect();
});

async function createRoom(
  overrides: Partial<CreateRoomInput> = {},
): Promise<z.infer<typeof roomSchema>> {
  const body: CreateRoomInput = {
    name: `${E2E_ROOM_PREFIX}${randomUUID()}`,
    location: 'Lab',
    capacity: 6,
    equipmentKeys: [],
    ...overrides,
  };
  const response = await api('/api/admin/rooms', {
    method: 'POST',
    cookie: adminCookie,
    body,
  });
  expect(response.status).toBe(201);
  return roomSchema.parse(response.body);
}

describe('admin route gating', () => {
  it.each([
    ['GET', '/api/admin/rooms'],
    ['POST', '/api/admin/rooms'],
    ['POST', '/api/admin/equipment'],
    ['PATCH', `/api/admin/rooms/${randomUUID()}`],
    ['DELETE', `/api/admin/rooms/${randomUUID()}`],
  ] as const)(
    '%s %s is 401 anonymously and 403 for a user',
    async (method, path) => {
      const body = method === 'GET' || method === 'DELETE' ? undefined : {};

      const anonymous = await api(path, { method, body });
      const asUser = await api(path, { method, body, cookie: userCookie });

      expect(anonymous.status).toBe(401);
      expect(asUser.status).toBe(403);
      expect(errorOf(asUser).code).toBe('FORBIDDEN');
    },
  );
});

describe('POST /api/admin/rooms', () => {
  it('creates a room with its equipment', async () => {
    const room = await createRoom({ equipmentKeys: ['projector'] });

    expect(room.equipment).toEqual([{ key: 'projector', label: 'Projector' }]);
    const listed = pageOf(
      await api('/api/rooms?pageSize=200&minCapacity=6'),
      roomSchema,
    );
    expect(listed.data.map((item) => item.id)).toContain(room.id);
  });

  it('rejects a duplicate name with 409 ROOM_NAME_TAKEN', async () => {
    const room = await createRoom();

    const response = await api('/api/admin/rooms', {
      method: 'POST',
      cookie: adminCookie,
      body: { name: room.name, location: 'Elsewhere', capacity: 2 },
    });

    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('ROOM_NAME_TAKEN');
  });

  it.each([
    [
      'zero capacity',
      { name: `${E2E_ROOM_PREFIX}x`, location: 'L', capacity: 0 },
    ],
    ['an empty name', { name: '', location: 'L', capacity: 2 }],
    [
      'a fractional capacity',
      { name: `${E2E_ROOM_PREFIX}x`, location: 'L', capacity: 2.5 },
    ],
  ])('rejects %s with 400', async (_label, body) => {
    const response = await api('/api/admin/rooms', {
      method: 'POST',
      cookie: adminCookie,
      body,
    });

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/admin/rooms', () => {
  it('includes inactive rooms that the public catalogue hides', async () => {
    const room = await createRoom();
    const deactivated = await api(`/api/admin/rooms/${room.id}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { active: false },
    });
    expect(deactivated.status).toBe(200);

    const adminList = pageOf(
      await api('/api/admin/rooms?pageSize=200', { cookie: adminCookie }),
      adminRoomSchema,
    );
    const publicList = pageOf(await api('/api/rooms?pageSize=200'), roomSchema);

    expect(adminList.meta.totalItems).toBe(SEEDED_ROOM_COUNT + 1);
    expect(adminList.data.find((item) => item.id === room.id)?.active).toBe(
      false,
    );
    expect(publicList.data.map((item) => item.id)).not.toContain(room.id);
  });
});

describe('PATCH /api/admin/rooms/:roomId', () => {
  it('updates only the fields provided', async () => {
    const room = await createRoom({ equipmentKeys: ['whiteboard'] });

    const response = await api(`/api/admin/rooms/${room.id}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { capacity: 9 },
    });

    expect(response.status).toBe(200);
    expect(roomSchema.parse(response.body)).toMatchObject({
      name: room.name,
      capacity: 9,
      equipment: [{ key: 'whiteboard', label: 'Whiteboard' }],
    });
  });

  it('rejects an empty body with 400', async () => {
    const room = await createRoom();

    const response = await api(`/api/admin/rooms/${room.id}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: {},
    });

    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown room and 400 for a malformed id', async () => {
    const unknown = await api(`/api/admin/rooms/${randomUUID()}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { capacity: 3 },
    });
    const malformed = await api('/api/admin/rooms/not-a-uuid', {
      method: 'PATCH',
      cookie: adminCookie,
      body: { capacity: 3 },
    });

    expect(unknown.status).toBe(404);
    expect(errorOf(unknown).code).toBe('NOT_FOUND');
    expect(malformed.status).toBe(400);
  });
});

describe('a room with an upcoming booking', () => {
  it('cannot be updated or deleted', async () => {
    const room = await createRoom();
    const booked = await api('/api/bookings', {
      method: 'POST',
      cookie: userCookie,
      body: {
        roomId: room.id,
        startsAt: futureIso(0, 9),
        endsAt: futureIso(0, 10),
      },
    });
    expect(booked.status).toBe(201);

    const update = await api(`/api/admin/rooms/${room.id}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { location: 'Moved' },
    });
    const remove = await api(`/api/admin/rooms/${room.id}`, {
      method: 'DELETE',
      cookie: adminCookie,
    });

    expect(update.status).toBe(409);
    expect(errorOf(update).code).toBe('ROOM_HAS_ACTIVE_OR_FUTURE_BOOKINGS');
    expect(remove.status).toBe(409);
    expect(errorOf(remove).code).toBe('ROOM_HAS_ACTIVE_OR_FUTURE_BOOKINGS');
  });
});

describe('DELETE /api/admin/rooms/:roomId', () => {
  it('deletes a room whose bookings are all in the past, keeping the bookings', async () => {
    const room = await createRoom();
    const bookingId = await insertBooking({
      roomId: room.id,
      email: ALICE_EMAIL,
      startsAt: minutesFromNow(-120),
      endsAt: minutesFromNow(-60),
    });

    const response = await api(`/api/admin/rooms/${room.id}`, {
      method: 'DELETE',
      cookie: adminCookie,
    });

    expect(response.status).toBe(204);
    const booking = await api(`/api/bookings/${bookingId}`, {
      cookie: userCookie,
    });
    expect(booking.status).toBe(200);
    expect(bookingSchema.parse(booking.body).roomId).toBeNull();
  });

  it('returns 404 for an unknown room', async () => {
    const response = await api(`/api/admin/rooms/${randomUUID()}`, {
      method: 'DELETE',
      cookie: adminCookie,
    });

    expect(response.status).toBe(404);
  });
});

describe('POST /api/admin/equipment', () => {
  it('creates an equipment type and rejects its key a second time', async () => {
    const body: CreateEquipmentInput = {
      key: `${E2E_EQUIPMENT_PREFIX}laser`,
      label: 'Laser pointer',
    };

    const first = await api('/api/admin/equipment', {
      method: 'POST',
      cookie: adminCookie,
      body,
    });
    const second = await api('/api/admin/equipment', {
      method: 'POST',
      cookie: adminCookie,
      body,
    });

    expect(first.status).toBe(201);
    expect(first.body).toEqual(body);
    expect(second.status).toBe(409);
    expect(errorOf(second).code).toBe('EQUIPMENT_KEY_TAKEN');
  });

  it('rejects a key that is not lowercase snake case', async () => {
    const response = await api('/api/admin/equipment', {
      method: 'POST',
      cookie: adminCookie,
      body: { key: 'Laser Pointer', label: 'Laser pointer' },
    });

    expect(response.status).toBe(400);
  });
});
