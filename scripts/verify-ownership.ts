// Proves ownership is enforced in the service layer, on every single-
// booking route, not just the happy path (security-and-audit.md): guessing
// someone else's booking id must come back 403 FORBIDDEN — never a
// successful read, and never a successful cancel or shorten. A 403 that
// still silently mutated the booking would be worse than an honest 200, so
// this also checks the booking is genuinely untouched afterward, and that
// the real owner's own request against the same id succeeds — proving the
// 403s above are ownership working, not the routes being broken outright.
// Run against a running `yarn dev` server.

import 'dotenv/config';

import { prisma } from '@/server/db/prisma';

import {
  BASE_URL,
  USER_A_EMAIL,
  USER_B_EMAIL,
  errorCodeOf,
  fetchRoomId,
  login,
} from './lib/verify-client';

import type { CreateBookingInput } from '@/server/modules/booking/booking.schema';

// Far enough out that it can never collide with a real booking; the exact
// slot doesn't matter here the way it does in verify-concurrency.ts, since
// this script only ever creates the one booking it attacks.
const TEST_STARTS_AT = new Date(Date.UTC(2200, 0, 1, 10, 0, 0)).toISOString();
const TEST_ENDS_AT = new Date(Date.UTC(2200, 0, 1, 11, 0, 0)).toISOString();

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

function check(name: string, passed: boolean, detail: string): CheckResult {
  return { name, passed, detail };
}

interface CreatedBooking {
  id: string;
  startsAt: string;
  endsAt: string;
}

async function createBookingAs(
  cookie: string,
  roomId: string,
): Promise<CreatedBooking> {
  const body: CreateBookingInput = {
    roomId,
    startsAt: TEST_STARTS_AT,
    endsAt: TEST_ENDS_AT,
  };
  const response = await fetch(`${BASE_URL}/api/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });

  const json: unknown = await response.json().catch(() => null);
  if (response.status !== 201) {
    throw new Error(
      `Setup booking failed: HTTP ${response.status} ${errorCodeOf(json) ?? ''}`,
    );
  }
  return json as CreatedBooking;
}

async function main(): Promise<void> {
  const roomId = await fetchRoomId();
  const [ownerCookie, attackerCookie] = await Promise.all([
    login(USER_A_EMAIL),
    login(USER_B_EMAIL),
  ]);

  let bookingId: string | undefined;
  try {
    const booking = await createBookingAs(ownerCookie, roomId);
    bookingId = booking.id;

    const results: CheckResult[] = [];

    const getResponse = await fetch(`${BASE_URL}/api/bookings/${booking.id}`, {
      headers: { Cookie: attackerCookie },
    });
    const getBody: unknown = await getResponse.json().catch(() => null);
    results.push(
      check(
        'GET /api/bookings/:id as a non-owner',
        getResponse.status === 403 && errorCodeOf(getBody) === 'FORBIDDEN',
        `HTTP ${getResponse.status} ${errorCodeOf(getBody) ?? ''}`,
      ),
    );

    const patchResponse = await fetch(
      `${BASE_URL}/api/bookings/${booking.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: attackerCookie },
        body: JSON.stringify({ endsAt: booking.startsAt }),
      },
    );
    const patchBody: unknown = await patchResponse.json().catch(() => null);
    results.push(
      check(
        'PATCH /api/bookings/:id (shorten) as a non-owner',
        patchResponse.status === 403 && errorCodeOf(patchBody) === 'FORBIDDEN',
        `HTTP ${patchResponse.status} ${errorCodeOf(patchBody) ?? ''}`,
      ),
    );

    const deleteResponse = await fetch(
      `${BASE_URL}/api/bookings/${booking.id}`,
      { method: 'DELETE', headers: { Cookie: attackerCookie } },
    );
    const deleteBody: unknown = await deleteResponse.json().catch(() => null);
    results.push(
      check(
        'DELETE /api/bookings/:id (cancel) as a non-owner',
        deleteResponse.status === 403 &&
          errorCodeOf(deleteBody) === 'FORBIDDEN',
        `HTTP ${deleteResponse.status} ${errorCodeOf(deleteBody) ?? ''}`,
      ),
    );

    const stillThereResponse = await fetch(
      `${BASE_URL}/api/bookings/${booking.id}`,
      { headers: { Cookie: ownerCookie } },
    );
    const stillThere = (await stillThereResponse.json()) as {
      status?: unknown;
      endsAt?: unknown;
    };
    results.push(
      check(
        "the owner's booking is unchanged after the attacker's attempts",
        stillThere.status === 'CONFIRMED' &&
          stillThere.endsAt === booking.endsAt,
        `status=${String(stillThere.status)} endsAt=${String(stillThere.endsAt)}`,
      ),
    );

    const ownerDeleteResponse = await fetch(
      `${BASE_URL}/api/bookings/${booking.id}`,
      { method: 'DELETE', headers: { Cookie: ownerCookie } },
    );
    results.push(
      check(
        'DELETE /api/bookings/:id (cancel) as the actual owner',
        ownerDeleteResponse.status === 204,
        `HTTP ${ownerDeleteResponse.status}`,
      ),
    );

    for (const result of results) {
      console.log(
        `${result.passed ? 'PASS' : 'FAIL'} — ${result.name}: ${result.detail}`,
      );
    }

    const failures = results.filter((result) => !result.passed);
    if (failures.length > 0) {
      console.error(`\n${failures.length}/${results.length} check(s) failed.`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `\nAll ${results.length} checks passed — ownership is enforced end to end.`,
    );
  } finally {
    if (bookingId !== undefined) {
      await prisma.auditEvent.deleteMany({ where: { bookingId } });
      await prisma.booking.deleteMany({ where: { id: bookingId } });
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
