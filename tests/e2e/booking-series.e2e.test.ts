import { randomUUID } from 'node:crypto';

import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ALICE_EMAIL,
  JOHN_EMAIL,
  ROOM_IDS,
  api,
  bookingSchema,
  errorOf,
  login,
} from './support/api-client';
import { insertBooking, resetTestData, testDb } from './support/test-db';
import { minutesFromNow } from './support/time';

import type { CreateRecurringBookingInput } from '@/server/modules/booking/booking.schema';

const createdSeriesSchema = z.object({
  series: z.object({
    id: z.uuid(),
    weekday: z.number().int(),
    localStartMinutes: z.number().int(),
    localEndMinutes: z.number().int(),
    timezone: z.string(),
    occurrenceCount: z.number().int(),
  }),
  occurrences: z.array(bookingSchema),
});

const seriesConflictDetailsSchema = z.object({
  conflicts: z.array(
    z.object({
      occurrenceStartsAt: z.string(),
      occurrenceEndsAt: z.string(),
      conflicts: z.array(z.object({ id: z.uuid() })),
    }),
  ),
});

let aliceCookie: string;
let johnCookie: string;

beforeAll(async () => {
  [aliceCookie, johnCookie] = await Promise.all([
    login(ALICE_EMAIL),
    login(JOHN_EMAIL),
  ]);
});

beforeEach(async () => {
  await resetTestData();
});

afterAll(async () => {
  await testDb.$disconnect();
});

function weekly(
  overrides: Partial<CreateRecurringBookingInput['recurrence']> = {},
  roomId: string = ROOM_IDS.gamma,
): CreateRecurringBookingInput {
  return {
    roomId,
    recurrence: {
      weekday: 2,
      localStartTime: '10:00',
      localEndTime: '11:00',
      timezone: 'America/New_York',
      occurrenceCount: 4,
      ...overrides,
    },
  };
}

async function createSeries(
  cookie: string,
  body: CreateRecurringBookingInput,
): Promise<z.infer<typeof createdSeriesSchema>> {
  const response = await api('/api/bookings', { method: 'POST', cookie, body });
  expect(response.status).toBe(201);
  return createdSeriesSchema.parse(response.body);
}

function localParts(
  iso: string,
  timeZone: string,
): { weekday: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return {
    weekday: part('weekday'),
    time: `${part('hour')}:${part('minute')}`,
  };
}

describe('POST /api/bookings with a recurrence', () => {
  it('materialises one booking per week, all linked to the series', async () => {
    const { series, occurrences } = await createSeries(aliceCookie, weekly());

    expect(series).toMatchObject({
      weekday: 2,
      localStartMinutes: 600,
      localEndMinutes: 660,
      timezone: 'America/New_York',
      occurrenceCount: 4,
    });
    expect(occurrences).toHaveLength(4);
    expect(new Set(occurrences.map((o) => o.seriesId))).toEqual(
      new Set([series.id]),
    );
    expect(new Date(occurrences[0]?.startsAt ?? 0).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it('keeps the local wall-clock time in the series time zone across weeks', async () => {
    // Twelve weeks always spans a US DST change somewhere in the year when
    // run in March or November; at any other time it still has to hold.
    const { occurrences } = await createSeries(
      aliceCookie,
      weekly({ occurrenceCount: 12 }),
    );

    for (const occurrence of occurrences) {
      expect(localParts(occurrence.startsAt, 'America/New_York')).toEqual({
        weekday: 'Tue',
        time: '10:00',
      });
    }
  });

  it('rejects the whole series if any occurrence clashes, listing which', async () => {
    const blocker = await createSeries(
      johnCookie,
      weekly({ occurrenceCount: 1 }),
    );

    const response = await api('/api/bookings', {
      method: 'POST',
      cookie: aliceCookie,
      body: weekly({ occurrenceCount: 3 }),
    });

    expect(response.status).toBe(409);
    const error = errorOf(response);
    expect(error.code).toBe('ROOM_ALREADY_BOOKED');
    const { conflicts } = seriesConflictDetailsSchema.parse(error.details);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.conflicts.map((c) => c.id)).toEqual([
      blocker.occurrences[0]?.id,
    ]);
    const aliceBookings = await testDb.booking.count({
      where: { user: { email: ALICE_EMAIL } },
    });
    const aliceSeries = await testDb.bookingSeries.count({
      where: { user: { email: ALICE_EMAIL } },
    });
    expect(aliceBookings).toBe(0);
    expect(aliceSeries).toBe(0);
  });

  it.each([
    ['an unknown time zone', weekly({ timezone: 'Mars/Olympus_Mons' })],
    ['more than 52 occurrences', weekly({ occurrenceCount: 53 })],
    ['zero occurrences', weekly({ occurrenceCount: 0 })],
    ['an end time before the start time', weekly({ localEndTime: '09:00' })],
    ['a 12-hour time', weekly({ localStartTime: '9:00' })],
    ['a weekday out of range', weekly({ weekday: 7 })],
  ])('rejects %s with 400', async (_label, body) => {
    const response = await api('/api/bookings', {
      method: 'POST',
      cookie: aliceCookie,
      body,
    });

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });
});

describe('DELETE /api/booking-series/:seriesId', () => {
  it('cancels the future occurrences and leaves past ones alone', async () => {
    const { series, occurrences } = await createSeries(aliceCookie, weekly());
    const pastId = await insertBooking({
      roomId: ROOM_IDS.gamma,
      email: ALICE_EMAIL,
      startsAt: minutesFromNow(-7 * 24 * 60),
      endsAt: minutesFromNow(-7 * 24 * 60 + 60),
      seriesId: series.id,
    });

    const response = await api(`/api/booking-series/${series.id}`, {
      method: 'DELETE',
      cookie: aliceCookie,
    });

    expect(response.status).toBe(204);
    const rows = await testDb.booking.findMany({
      where: { seriesId: series.id },
      select: { id: true, status: true },
    });
    const statusById = new Map(rows.map((row) => [row.id, row.status]));
    for (const occurrence of occurrences) {
      expect(statusById.get(occurrence.id)).toBe('CANCELLED');
    }
    expect(statusById.get(pastId)).toBe('CONFIRMED');
  });

  it('leaves the series intact when a single occurrence is cancelled', async () => {
    const { occurrences } = await createSeries(aliceCookie, weekly());
    const [first, ...rest] = occurrences;

    const response = await api(`/api/bookings/${first?.id ?? ''}`, {
      method: 'DELETE',
      cookie: aliceCookie,
    });

    expect(response.status).toBe(204);
    const stillConfirmed = await testDb.booking.count({
      where: { id: { in: rest.map((o) => o.id) }, status: 'CONFIRMED' },
    });
    expect(stillConfirmed).toBe(rest.length);
  });

  it("returns 403 for someone else's series and cancels nothing", async () => {
    const { series } = await createSeries(aliceCookie, weekly());

    const response = await api(`/api/booking-series/${series.id}`, {
      method: 'DELETE',
      cookie: johnCookie,
    });

    expect(response.status).toBe(403);
    const cancelled = await testDb.booking.count({
      where: { seriesId: series.id, status: 'CANCELLED' },
    });
    expect(cancelled).toBe(0);
  });

  it('returns 404 for an unknown series and 401 without a session', async () => {
    const unknown = await api(`/api/booking-series/${randomUUID()}`, {
      method: 'DELETE',
      cookie: aliceCookie,
    });
    const anonymous = await api(`/api/booking-series/${randomUUID()}`, {
      method: 'DELETE',
    });

    expect(unknown.status).toBe(404);
    expect(anonymous.status).toBe(401);
  });
});
