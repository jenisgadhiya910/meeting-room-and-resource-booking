import { randomUUID } from 'node:crypto';

import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ADMIN_EMAIL,
  ALICE_EMAIL,
  JOHN_EMAIL,
  ROOM_IDS,
  api,
  bookingSchema,
  errorOf,
  login,
  pageOf,
} from './support/api-client';
import {
  auditActionsFor,
  insertBooking,
  resetTestData,
  testDb,
} from './support/test-db';
import { futureIso, minutesFromNow } from './support/time';

import type { BookingBody } from './support/api-client';
import type { CreateSingleBookingInput } from '@/server/modules/booking/booking.schema';

const conflictDetailsSchema = z.object({
  conflicts: z.array(
    z.object({ id: z.uuid(), startsAt: z.string(), endsAt: z.string() }),
  ),
});

let aliceCookie: string;
let johnCookie: string;
let adminCookie: string;

beforeAll(async () => {
  [aliceCookie, johnCookie, adminCookie] = await Promise.all([
    login(ALICE_EMAIL),
    login(JOHN_EMAIL),
    login(ADMIN_EMAIL),
  ]);
});

beforeEach(async () => {
  await resetTestData();
});

afterAll(async () => {
  await testDb.$disconnect();
});

function slot(
  startHour: number,
  endHour: number,
  roomId: string = ROOM_IDS.alpha,
): CreateSingleBookingInput {
  return {
    roomId,
    startsAt: futureIso(0, startHour),
    endsAt: futureIso(0, endHour),
  };
}

async function book(
  cookie: string,
  body: CreateSingleBookingInput,
): Promise<BookingBody> {
  const response = await api('/api/bookings', { method: 'POST', cookie, body });
  expect(response.status).toBe(201);
  return bookingSchema.parse(response.body);
}

describe('POST /api/bookings', () => {
  it('creates a confirmed booking with a room snapshot and an audit row', async () => {
    const booking = await book(aliceCookie, slot(9, 10));

    expect(booking).toMatchObject({
      roomId: ROOM_IDS.alpha,
      seriesId: null,
      status: 'CONFIRMED',
      startsAt: futureIso(0, 9),
      endsAt: futureIso(0, 10),
      roomSnapshot: {
        name: 'Alpha',
        location: 'Floor 1',
        capacity: 4,
        equipment: [{ key: 'whiteboard', label: 'Whiteboard' }],
      },
    });
    expect(await auditActionsFor(booking.id)).toEqual(['BOOKING_CREATED']);
  });

  it('normalises an offset timestamp to UTC', async () => {
    const booking = await book(aliceCookie, {
      roomId: ROOM_IDS.alpha,
      startsAt: '2100-01-01T15:30:00+05:30',
      endsAt: '2100-01-01T16:30:00+05:30',
    });

    expect(booking.startsAt).toBe('2100-01-01T10:00:00.000Z');
  });

  it('requires a session', async () => {
    const response = await api('/api/bookings', {
      method: 'POST',
      body: slot(9, 10),
    });

    expect(response.status).toBe(401);
  });

  it('is refused for an admin session', async () => {
    const response = await api('/api/bookings', {
      method: 'POST',
      cookie: adminCookie,
      body: slot(9, 10),
    });

    expect(response.status).toBe(403);
  });

  it.each([
    ['endsAt equal to startsAt', slot(9, 9)],
    ['endsAt before startsAt', slot(10, 9)],
    [
      'a timestamp without an offset',
      { ...slot(9, 10), startsAt: '2100-01-01T09:00:00' },
    ],
    ['a malformed room id', { ...slot(9, 10), roomId: 'alpha' }],
    ['an unknown room id', slot(9, 10, randomUUID())],
  ])('rejects %s with 400', async (_label, body) => {
    const response = await api('/api/bookings', {
      method: 'POST',
      cookie: aliceCookie,
      body,
    });

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });

  it('rejects an overlap with 409, lists the conflict, and audits the attempt', async () => {
    const existing = await book(aliceCookie, slot(9, 11));

    const response = await api('/api/bookings', {
      method: 'POST',
      cookie: johnCookie,
      body: slot(10, 12),
    });

    expect(response.status).toBe(409);
    const error = errorOf(response);
    expect(error.code).toBe('ROOM_ALREADY_BOOKED');
    expect(
      conflictDetailsSchema.parse(error.details).conflicts.map((c) => c.id),
    ).toEqual([existing.id]);
    const rejected = await testDb.auditEvent.count({
      where: { action: 'BOOKING_REJECTED_OVERLAP', roomId: ROOM_IDS.alpha },
    });
    expect(rejected).toBe(1);
  });

  it('allows back-to-back bookings, since ranges are half-open', async () => {
    await book(aliceCookie, slot(9, 10));

    const next = await book(johnCookie, slot(10, 11));

    expect(next.status).toBe('CONFIRMED');
  });

  it('allows the same slot in a different room', async () => {
    await book(aliceCookie, slot(9, 10, ROOM_IDS.alpha));

    const other = await book(johnCookie, slot(9, 10, ROOM_IDS.beta));

    expect(other.roomId).toBe(ROOM_IDS.beta);
  });

  it('lets exactly one of several simultaneous overlapping requests win', async () => {
    const contenders = [
      aliceCookie,
      johnCookie,
      aliceCookie,
      johnCookie,
      aliceCookie,
    ];

    const responses = await Promise.all(
      contenders.map((cookie, index) =>
        api('/api/bookings', {
          method: 'POST',
          cookie,
          // Every request overlaps every other one, none identically.
          body: {
            roomId: ROOM_IDS.delta,
            startsAt: futureIso(0, 9, index * 5),
            endsAt: futureIso(0, 11, index * 5),
          },
        }),
      ),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    const confirmed = await testDb.booking.count({
      where: { roomId: ROOM_IDS.delta, status: 'CONFIRMED' },
    });
    expect(confirmed).toBe(1);
  });
});

describe('GET /api/bookings', () => {
  it("lists only the caller's own bookings", async () => {
    const mine = await book(aliceCookie, slot(9, 10));
    await book(johnCookie, slot(10, 11));

    const response = await api('/api/bookings', { cookie: aliceCookie });

    expect(response.status).toBe(200);
    const { data, meta } = pageOf(response, bookingSchema);
    expect(data.map((booking) => booking.id)).toEqual([mine.id]);
    expect(meta.totalItems).toBe(1);
  });

  it('puts upcoming bookings before past ones', async () => {
    const pastId = await insertBooking({
      roomId: ROOM_IDS.beta,
      email: ALICE_EMAIL,
      startsAt: minutesFromNow(-120),
      endsAt: minutesFromNow(-60),
    });
    const upcoming = await book(aliceCookie, slot(9, 10));

    const response = await api('/api/bookings', { cookie: aliceCookie });

    const { data } = pageOf(response, bookingSchema);
    expect(data.map((booking) => booking.id)).toEqual([upcoming.id, pastId]);
  });

  it('paginates', async () => {
    for (const hour of [8, 9, 10])
      await book(aliceCookie, slot(hour, hour + 1));

    const response = await api('/api/bookings?page=2&pageSize=2', {
      cookie: aliceCookie,
    });

    const { data, meta } = pageOf(response, bookingSchema);
    expect(data).toHaveLength(1);
    expect(meta).toEqual({
      page: 2,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
    });
  });

  it('requires a session', async () => {
    const response = await api('/api/bookings');

    expect(response.status).toBe(401);
  });
});

describe('GET /api/bookings/:bookingId', () => {
  it('returns 200 to the owner, 403 to anyone else, 404 for an unknown id', async () => {
    const booking = await book(aliceCookie, slot(9, 10));

    const owner = await api(`/api/bookings/${booking.id}`, {
      cookie: aliceCookie,
    });
    const other = await api(`/api/bookings/${booking.id}`, {
      cookie: johnCookie,
    });
    const unknown = await api(`/api/bookings/${randomUUID()}`, {
      cookie: aliceCookie,
    });
    const malformed = await api('/api/bookings/123', { cookie: aliceCookie });

    expect(owner.status).toBe(200);
    expect(bookingSchema.parse(owner.body).id).toBe(booking.id);
    expect(other.status).toBe(403);
    expect(errorOf(other).code).toBe('FORBIDDEN');
    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(400);
  });
});

describe('DELETE /api/bookings/:bookingId', () => {
  it('cancels the booking, frees the slot, and audits it', async () => {
    const booking = await book(aliceCookie, slot(9, 10));

    const response = await api(`/api/bookings/${booking.id}`, {
      method: 'DELETE',
      cookie: aliceCookie,
    });

    expect(response.status).toBe(204);
    const after = bookingSchema.parse(
      (await api(`/api/bookings/${booking.id}`, { cookie: aliceCookie })).body,
    );
    expect(after.status).toBe('CANCELLED');
    expect(after.cancelledAt).not.toBeNull();
    await book(johnCookie, slot(9, 10));
    expect(await auditActionsFor(booking.id)).toEqual([
      'BOOKING_CREATED',
      'BOOKING_CANCELLED',
    ]);
  });

  it('refuses to cancel twice', async () => {
    const booking = await book(aliceCookie, slot(9, 10));
    await api(`/api/bookings/${booking.id}`, {
      method: 'DELETE',
      cookie: aliceCookie,
    });

    const again = await api(`/api/bookings/${booking.id}`, {
      method: 'DELETE',
      cookie: aliceCookie,
    });

    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('BOOKING_NOT_MODIFIABLE');
  });

  it('refuses to cancel a booking that has ended', async () => {
    const bookingId = await insertBooking({
      roomId: ROOM_IDS.alpha,
      email: ALICE_EMAIL,
      startsAt: minutesFromNow(-120),
      endsAt: minutesFromNow(-60),
    });

    const response = await api(`/api/bookings/${bookingId}`, {
      method: 'DELETE',
      cookie: aliceCookie,
    });

    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('BOOKING_NOT_MODIFIABLE');
  });

  it("returns 403 for someone else's booking and leaves it confirmed", async () => {
    const booking = await book(aliceCookie, slot(9, 10));

    const response = await api(`/api/bookings/${booking.id}`, {
      method: 'DELETE',
      cookie: johnCookie,
    });

    expect(response.status).toBe(403);
    const row = await testDb.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(row.status).toBe('CONFIRMED');
  });
});

describe('PATCH /api/bookings/:bookingId', () => {
  async function shorten(
    bookingId: string,
    endsAt: string,
    cookie = aliceCookie,
  ) {
    return api(`/api/bookings/${bookingId}`, {
      method: 'PATCH',
      cookie,
      body: { endsAt },
    });
  }

  it('moves endsAt earlier, frees the tail, and audits it', async () => {
    const booking = await book(aliceCookie, slot(9, 11));

    const response = await shorten(booking.id, futureIso(0, 10));

    expect(response.status).toBe(200);
    expect(bookingSchema.parse(response.body).endsAt).toBe(futureIso(0, 10));
    await book(johnCookie, slot(10, 11));
    expect(await auditActionsFor(booking.id)).toEqual([
      'BOOKING_CREATED',
      'BOOKING_SHORTENED',
    ]);
  });

  it('rejects moving endsAt later with 400', async () => {
    const booking = await book(aliceCookie, slot(9, 10));

    const response = await shorten(booking.id, futureIso(0, 11));

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });

  it('rejects an endsAt at or before startsAt with 400', async () => {
    const booking = await book(aliceCookie, slot(9, 10));

    const response = await shorten(booking.id, futureIso(0, 9));

    expect(response.status).toBe(400);
  });

  it('shortens a booking in progress to a time no earlier than now', async () => {
    const bookingId = await insertBooking({
      roomId: ROOM_IDS.alpha,
      email: ALICE_EMAIL,
      startsAt: minutesFromNow(-30),
      endsAt: minutesFromNow(60),
    });

    const toFuture = await shorten(bookingId, minutesFromNow(30).toISOString());
    const toPast = await shorten(bookingId, minutesFromNow(-10).toISOString());

    expect(toFuture.status).toBe(200);
    expect(toPast.status).toBe(409);
    expect(errorOf(toPast).code).toBe('BOOKING_NOT_MODIFIABLE');
  });

  it('refuses to shorten a cancelled booking', async () => {
    const booking = await book(aliceCookie, slot(9, 11));
    await api(`/api/bookings/${booking.id}`, {
      method: 'DELETE',
      cookie: aliceCookie,
    });

    const response = await shorten(booking.id, futureIso(0, 10));

    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('BOOKING_NOT_MODIFIABLE');
  });

  it("returns 403 for someone else's booking and leaves it unchanged", async () => {
    const booking = await book(aliceCookie, slot(9, 11));

    const response = await shorten(booking.id, futureIso(0, 10), johnCookie);

    expect(response.status).toBe(403);
    const row = await testDb.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(row.endsAt.toISOString()).toBe(futureIso(0, 11));
  });
});
