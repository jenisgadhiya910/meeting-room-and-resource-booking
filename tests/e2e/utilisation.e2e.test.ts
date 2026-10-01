import { randomUUID } from 'node:crypto';

import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ADMIN_EMAIL,
  ALICE_EMAIL,
  ROOM_IDS,
  SEEDED_ROOM_COUNT,
  api,
  bookingSchema,
  errorOf,
  login,
} from './support/api-client';
import { resetTestData, testDb } from './support/test-db';
import { futureIso } from './support/time';

const minutesSchema = z.object({
  bookedMinutes: z.number().int(),
  availableMinutes: z.number().int(),
  bookingCount: z.number().int(),
});

const utilisationSchema = z.object({
  data: z.array(
    z.object({
      room: z.object({ id: z.uuid(), name: z.string(), active: z.boolean() }),
      weeks: z.array(minutesSchema.extend({ weekStart: z.iso.datetime() })),
      totals: minutesSchema,
    }),
  ),
  meta: z.object({
    from: z.string(),
    to: z.string(),
    bookableWindow: z.object({ availableMinutesPerWeek: z.number().int() }),
  }),
});

// futureIso(3, ...) is Monday 4 January 2100; this range is that whole week.
const WEEK = { from: '2100-01-04', to: '2100-01-10' };

let adminCookie: string;
let aliceCookie: string;

beforeAll(async () => {
  [adminCookie, aliceCookie] = await Promise.all([
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

async function utilisation(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return api(`/api/admin/utilisation?${params.toString()}`, {
    cookie: adminCookie,
  });
}

describe('GET /api/admin/utilisation', () => {
  it('sums confirmed booked minutes for the week and ignores cancelled ones', async () => {
    const kept = await api('/api/bookings', {
      method: 'POST',
      cookie: aliceCookie,
      body: {
        roomId: ROOM_IDS.alpha,
        startsAt: futureIso(3, 10),
        endsAt: futureIso(3, 11, 30),
      },
    });
    const dropped = await api('/api/bookings', {
      method: 'POST',
      cookie: aliceCookie,
      body: {
        roomId: ROOM_IDS.alpha,
        startsAt: futureIso(4, 10),
        endsAt: futureIso(4, 12),
      },
    });
    expect(kept.status).toBe(201);
    const droppedId = bookingSchema.parse(dropped.body).id;
    await api(`/api/bookings/${droppedId}`, {
      method: 'DELETE',
      cookie: aliceCookie,
    });

    const response = await utilisation({ ...WEEK, roomId: ROOM_IDS.alpha });

    expect(response.status).toBe(200);
    const { data, meta } = utilisationSchema.parse(response.body);
    expect(data).toHaveLength(1);
    expect(data[0]?.weeks).toHaveLength(1);
    expect(data[0]?.totals).toEqual({
      bookedMinutes: 90,
      availableMinutes: meta.bookableWindow.availableMinutesPerWeek,
      bookingCount: 1,
    });
    expect(data[0]?.weeks[0]?.weekStart).toBe('2100-01-04T00:00:00.000Z');
  });

  it('reports every room, with empty weeks filled in, when roomId is omitted', async () => {
    const response = await utilisation({
      from: '2100-01-04',
      to: '2100-01-17',
    });

    const { data } = utilisationSchema.parse(response.body);
    expect(data).toHaveLength(SEEDED_ROOM_COUNT);
    for (const room of data) {
      expect(room.weeks).toHaveLength(2);
      expect(room.totals.bookedMinutes).toBe(0);
    }
  });

  it('returns 404 for an unknown room', async () => {
    const response = await utilisation({ ...WEEK, roomId: randomUUID() });

    expect(response.status).toBe(404);
  });

  it.each([
    ['to before from', { from: '2100-01-10', to: '2100-01-04' }],
    ['a range over 366 days', { from: '2100-01-01', to: '2101-06-01' }],
    [
      'a datetime instead of a date',
      { from: futureIso(0, 0), to: '2100-01-10' },
    ],
  ])('rejects %s with 400', async (_label, query) => {
    const response = await utilisation(query);

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });

  it('is admin only', async () => {
    const params = new URLSearchParams(WEEK).toString();

    const asUser = await api(`/api/admin/utilisation?${params}`, {
      cookie: aliceCookie,
    });
    const anonymous = await api(`/api/admin/utilisation?${params}`);

    expect(asUser.status).toBe(403);
    expect(anonymous.status).toBe(401);
  });
});
