import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ALICE_EMAIL,
  ROOM_IDS,
  SEEDED_ROOM_COUNT,
  api,
  errorOf,
  login,
  pageOf,
} from './support/api-client';
import { resetTestData, testDb } from './support/test-db';
import { futureIso } from './support/time';

const roomSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  location: z.string(),
  capacity: z.number().int(),
  equipment: z.array(z.object({ key: z.string(), label: z.string() })),
});

const equipmentPageSchema = z.object({
  data: z.array(z.object({ key: z.string(), label: z.string() })),
  meta: z.object({ nextCursor: z.uuid().nullable() }),
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe('GET /api/rooms', () => {
  it('is public and paginates with the documented defaults', async () => {
    const response = await api('/api/rooms');

    expect(response.status).toBe(200);
    const { data, meta } = pageOf(response, roomSchema);
    expect(meta).toEqual({
      page: 1,
      pageSize: 10,
      totalItems: SEEDED_ROOM_COUNT,
      totalPages: Math.ceil(SEEDED_ROOM_COUNT / 10),
    });
    expect(data).toHaveLength(10);
    const names = data.map((room) => room.name);
    expect(names).toEqual([...names].sort());
  });

  it('filters by minimum capacity', async () => {
    const response = await api('/api/rooms?minCapacity=25&pageSize=200');

    const { data, meta } = pageOf(response, roomSchema);
    expect(meta.totalItems).toBeGreaterThan(0);
    expect(data.every((room) => room.capacity >= 25)).toBe(true);
  });

  it('requires every requested equipment key, not any of them', async () => {
    const response = await api(
      '/api/rooms?equipment=projector&equipment=video_conferencing&pageSize=200',
    );

    const { data } = pageOf(response, roomSchema);
    expect(data.map((room) => room.id)).toContain(ROOM_IDS.gamma);
    expect(data.map((room) => room.id)).not.toContain(ROOM_IDS.beta);
    for (const room of data) {
      const keys = room.equipment.map((item) => item.key);
      expect(keys).toEqual(
        expect.arrayContaining(['projector', 'video_conferencing']),
      );
    }
  });

  it('sorts by capacity descending', async () => {
    const response = await api('/api/rooms?sort=capacity&order=desc');

    const { data } = pageOf(response, roomSchema);
    const capacities = data.map((room) => room.capacity);
    expect(capacities).toEqual([...capacities].sort((a, b) => b - a));
  });

  it.each([
    ['pageSize above the cap', 'pageSize=201'],
    ['an unknown sort column', 'sort=location'],
    ['a non-positive capacity', 'minCapacity=0'],
  ])('rejects %s with 400', async (_label, query) => {
    const response = await api(`/api/rooms?${query}`);

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/equipment', () => {
  it('lists the seeded catalogue', async () => {
    const response = await api('/api/equipment');

    expect(response.status).toBe(200);
    const { data } = equipmentPageSchema.parse(response.body);
    expect(data.map((item) => item.key)).toEqual(
      expect.arrayContaining(['projector', 'video_conferencing', 'whiteboard']),
    );
  });

  it('pages by cursor', async () => {
    const first = equipmentPageSchema.parse(
      (await api('/api/equipment?limit=1')).body,
    );
    expect(first.data).toHaveLength(1);
    expect(first.meta.nextCursor).not.toBeNull();

    const second = equipmentPageSchema.parse(
      (await api(`/api/equipment?limit=1&cursor=${first.meta.nextCursor}`))
        .body,
    );
    expect(second.data).toHaveLength(1);
    expect(second.data[0]?.key).not.toBe(first.data[0]?.key);
  });
});

describe('GET /api/rooms/availability', () => {
  let cookie: string;

  beforeAll(async () => {
    cookie = await login(ALICE_EMAIL);
  });

  beforeEach(async () => {
    await resetTestData();
    const booked = await api('/api/bookings', {
      method: 'POST',
      cookie,
      body: {
        roomId: ROOM_IDS.alpha,
        startsAt: futureIso(0, 10),
        endsAt: futureIso(0, 11),
      },
    });
    expect(booked.status).toBe(201);
  });

  async function availableRoomIds(from: string, to: string): Promise<string[]> {
    const params = new URLSearchParams({ from, to, pageSize: '200' });
    const response = await api(`/api/rooms/availability?${params.toString()}`);
    expect(response.status).toBe(200);
    return pageOf(response, roomSchema).data.map((room) => room.id);
  }

  it('excludes a room booked for part of the window', async () => {
    const ids = await availableRoomIds(futureIso(0, 10, 30), futureIso(0, 12));

    expect(ids).not.toContain(ROOM_IDS.alpha);
    expect(ids).toContain(ROOM_IDS.beta);
  });

  it('treats a booking ending exactly at `from` as not overlapping', async () => {
    const ids = await availableRoomIds(futureIso(0, 11), futureIso(0, 12));

    expect(ids).toContain(ROOM_IDS.alpha);
  });

  it('applies capacity and equipment filters together with the window', async () => {
    const params = new URLSearchParams({
      from: futureIso(0, 10),
      to: futureIso(0, 11),
      minCapacity: '10',
      pageSize: '200',
    });
    params.append('equipment', 'video_conferencing');

    const response = await api(`/api/rooms/availability?${params.toString()}`);

    const { data } = pageOf(response, roomSchema);
    expect(data.map((room) => room.id)).toContain(ROOM_IDS.gamma);
    expect(data.every((room) => room.capacity >= 10)).toBe(true);
  });

  it('rejects a window that ends before it starts', async () => {
    const params = new URLSearchParams({
      from: futureIso(0, 12),
      to: futureIso(0, 11),
    });

    const response = await api(`/api/rooms/availability?${params.toString()}`);

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });

  it('requires from and to', async () => {
    const response = await api('/api/rooms/availability');

    expect(response.status).toBe(400);
  });
});
