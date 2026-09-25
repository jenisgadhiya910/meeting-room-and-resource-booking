// The headline demo (CLAUDE.md, docs/adr/0001-double-booking-prevention.md):
// fires two genuinely simultaneous overlapping POST /api/bookings requests,
// from two different users, for the same room and the same slot, against a
// running `yarn dev` server — and asserts that the database, not
// application code, lets exactly one of them win.
//
// A single passing run is not sufficient evidence. Promise.all dispatches
// both requests back-to-back, but which one's INSERT reaches Postgres first
// — and therefore which one blocks on the other's exclusion-constraint
// check — depends on OS scheduling, connection-pool acquisition order and
// network jitter, none of which this script controls. A race that only
// fails one time in twenty is still a failure (ADR 0001), so this runs the
// race DEFAULT_ROUNDS times, each against its own never-before-booked slot,
// and only passes if every single round comes back exactly one 201 and one
// 409 ROOM_ALREADY_BOOKED. Re-run the whole script a few times too — see
// the roadmap's Phase 13 verify step.
//
// This isn't hypothetical: building this script surfaced a real gap twice.
// First, a genuinely-simultaneous pair can make Postgres's deadlock
// detector abort one side with a serialization failure (SQLSTATE
// 40001/40P01, Prisma code P2034) instead of the clean 23P01 the ADR
// describes — booking.service.ts now retries that specific, documented
// "please retry your transaction" error once. Second, an earlier version of
// this script picked each run's slots from a wall-clock-derived anchor,
// which made consecutive back-to-back runs collide with each other almost
// every time (see the comment on `runAnchor` below) — a bug in the harness,
// not the constraint, but it produced the same 409+409 symptom and would
// have been read as a false failure of the thing this script exists to
// prove.
//
// Every row this run creates is cleaned up before the process exits, pass
// or fail (see cleanUp() below) — this is the one script meant to be run
// repeatedly against a real dev database, and it shouldn't leave 20+ throwaway
// bookings behind every time. Cleanup goes through Prisma directly rather
// than the API: there's no DELETE /api/bookings/:id yet (Phase 14), and
// deleting is not the thing this script exists to verify anyway — only the
// POST /api/bookings race above is.

import 'dotenv/config';

import { randomInt } from 'node:crypto';

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

const DEFAULT_ROUNDS = 20;

// Every round gets its own day, `ROUND_SPACING_MS` apart, so rounds within
// one run can never collide with each other no matter how many run.
//
// Across separate runs, a wall-clock-derived anchor (e.g. `Date.now()`)
// does NOT work here, despite looking like it should: two runs started even
// a few seconds apart still land within the same hour once both are
// anchored the same way and offset by whole days, so back-to-back reruns —
// exactly what the roadmap's Phase 13 verify step asks for — would collide
// almost every time (confirmed the hard way: a second run right after a
// first came back 409+409 on every round, because every "fresh" slot was
// already occupied by the previous run's booking a few seconds earlier).
// `runAnchor` is instead a uniformly random hour within a 900-year span,
// decoupled from wall-clock time entirely, so two independent runs land on
// the same slot only by astronomical coincidence.
const ROUND_SPACING_MS = 24 * 60 * 60 * 1000;
const SLOT_DURATION_MS = 60 * 60 * 1000;
const CALENDAR_BASE_MS = Date.UTC(2100, 0, 1);
const RUN_ANCHOR_SPAN_HOURS = 900 * 365 * 24;
const runAnchor =
  CALENDAR_BASE_MS + randomInt(0, RUN_ANCHOR_SPAN_HOURS) * 60 * 60 * 1000;

function windowForRound(round: number): { startsAt: string; endsAt: string } {
  const startsAt = new Date(runAnchor + round * ROUND_SPACING_MS);
  const endsAt = new Date(startsAt.getTime() + SLOT_DURATION_MS);
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}

interface RoundResult {
  round: number;
  passed: boolean;
  detail: string;
}

async function runRound(
  round: number,
  roomId: string,
  cookieA: string,
  cookieB: string,
): Promise<RoundResult> {
  const { startsAt, endsAt } = windowForRound(round);
  const body: CreateBookingInput = { roomId, startsAt, endsAt };
  const payload = JSON.stringify(body);

  const post = (cookie: string): Promise<Response> =>
    fetch(`${BASE_URL}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: payload,
    });

  // The actual race: both requests are issued before either is awaited, so
  // they are in flight against the server at the same time — Promise.all
  // does not serialize them the way a sequential pair of awaits would.
  const [responseA, responseB] = await Promise.all([
    post(cookieA),
    post(cookieB),
  ]);
  const [bodyA, bodyB]: unknown[] = await Promise.all([
    responseA.json(),
    responseB.json(),
  ]);

  const statuses = [responseA.status, responseB.status];
  const successCount = statuses.filter((status) => status === 201).length;
  const conflictCodes = [bodyA, bodyB]
    .map(errorCodeOf)
    .filter((code): code is string => code !== null);

  if (
    successCount === 1 &&
    conflictCodes.length === 1 &&
    conflictCodes[0] === 'ROOM_ALREADY_BOOKED'
  ) {
    return { round, passed: true, detail: '201 + 409 ROOM_ALREADY_BOOKED' };
  }

  if (successCount === 2) {
    return {
      round,
      passed: false,
      detail:
        'BOTH requests succeeded (201, 201) — the exclusion constraint did not hold',
    };
  }

  return {
    round,
    passed: false,
    detail: `unexpected outcome: [${responseA.status} ${conflictCodes[0] ?? ''}, ${responseB.status} ${conflictCodes[1] ?? ''}]`,
  };
}

// Scoped precisely to what this run itself could have written, not a
// blanket wipe — the dev database can (and typically does) hold real
// bookings from manually testing the UI as the same seeded users, and the
// audit trail in particular is meant to be permanent evidence
// (security-and-audit.md), not something a verification script casually
// clears. Bookings are scoped by room + these two test users + the exact
// slot range this run generated. Audit events tied to a booking are scoped
// by that booking's id (exact); the rejected-overlap events, which have no
// bookingId, are scoped by room + these two users + having occurred no
// earlier than this run started.
async function cleanUp(params: {
  roomId: string;
  rangeStart: Date;
  rangeEnd: Date;
  scriptStartedAt: Date;
}): Promise<{ bookingsDeleted: number; auditEventsDeleted: number }> {
  const users = await prisma.user.findMany({
    where: { email: { in: [USER_A_EMAIL, USER_B_EMAIL] } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  const bookings = await prisma.booking.findMany({
    where: {
      roomId: params.roomId,
      userId: { in: userIds },
      startsAt: { gte: params.rangeStart, lt: params.rangeEnd },
    },
    select: { id: true },
  });
  const bookingIds = bookings.map((booking) => booking.id);

  // audit_events.bookingId has no cascading delete, so it must go first.
  const auditResult = await prisma.auditEvent.deleteMany({
    where: {
      roomId: params.roomId,
      actorId: { in: userIds },
      OR: [
        { bookingId: { in: bookingIds } },
        { bookingId: null, occurredAt: { gte: params.scriptStartedAt } },
      ],
    },
  });
  const bookingResult = await prisma.booking.deleteMany({
    where: { id: { in: bookingIds } },
  });

  return {
    bookingsDeleted: bookingResult.count,
    auditEventsDeleted: auditResult.count,
  };
}

async function main(): Promise<void> {
  const scriptStartedAt = new Date();
  const rounds = Number(process.env.VERIFY_ROUNDS ?? DEFAULT_ROUNDS);
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error('VERIFY_ROUNDS must be a positive integer');
  }

  console.log(
    `Verifying against ${BASE_URL} — ${rounds} round(s), each two simultaneous overlapping bookings for the same room + slot.\n`,
  );

  const roomId = await fetchRoomId();
  const [cookieA, cookieB] = await Promise.all([
    login(USER_A_EMAIL),
    login(USER_B_EMAIL),
  ]);

  try {
    const results: RoundResult[] = [];
    for (let round = 0; round < rounds; round += 1) {
      // Rounds run one after another — each round's own pair of requests
      // still races concurrently. Running rounds themselves in parallel
      // would make a failure's round number meaningless under
      // connection-pool contention, for no extra evidence: each round
      // already exercises an independent slot.
      const result = await runRound(round, roomId, cookieA, cookieB);
      results.push(result);
      console.log(
        `Round ${round + 1}/${rounds}: ${result.passed ? 'PASS' : 'FAIL'} — ${result.detail}`,
      );
    }

    const failures = results.filter((result) => !result.passed);
    if (failures.length > 0) {
      console.error(
        `\n${failures.length}/${rounds} round(s) failed — the exclusion constraint did not hold every time.`,
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `\nAll ${rounds} rounds passed: exactly one 201 and one 409 ROOM_ALREADY_BOOKED, every time.`,
    );
  } finally {
    // Runs whether the rounds above passed, failed, or threw — a failed
    // run's test data needs cleaning up too, not just a passing one.
    const rangeStart = new Date(runAnchor);
    const rangeEnd = new Date(
      runAnchor + (rounds - 1) * ROUND_SPACING_MS + SLOT_DURATION_MS,
    );
    const { bookingsDeleted, auditEventsDeleted } = await cleanUp({
      roomId,
      rangeStart,
      rangeEnd,
      scriptStartedAt,
    });
    console.log(
      `Cleaned up ${bookingsDeleted} test booking(s) and ${auditEventsDeleted} audit event(s).`,
    );
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
