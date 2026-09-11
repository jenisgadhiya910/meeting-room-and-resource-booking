---
paths:
  - 'src/server/auth/**'
  - 'src/server/audit/**'
  - 'src/server/http/**'
  - 'src/server/modules/**/*.service.ts'
  - 'src/app/api/**/*.ts'
  - 'src/proxy.ts'
  - 'src/server/logger.ts'
---

# Authentication, authorisation and audit

## Sessions

There is no anonymous path to booking, cancelling or shortening. Every mutating route resolves
a real user before doing anything else.

For this POC use a signed JWT in an `httpOnly`, `sameSite=lax`, `secure`-in-production cookie,
issued after a password check against an `argon2` hash. Keep it in `src/server/auth/` behind
two functions:

```ts
export async function getSession(): Promise<Session | null>;
export async function requireUser(): Promise<SessionUser>; // throws UnauthenticatedError
```

`requireUser()` is called from `withRoute`, and the resulting user id is what every service
receives as `actorId`. If you swap in Auth.js later, these two functions are the only thing
that changes.

`proxy.ts` (renamed from `middleware.ts` in Next.js 16) may redirect unauthenticated browsers
away from UI routes for convenience. It is **not** the authorisation boundary — proxy-layer
checks have been bypassable in the past, and API routes are hit directly by scripts anyway.
The check that counts happens in the route handler and the service.

## Ownership

Authorisation is a service-layer concern, enforced against the session id:

```ts
const booking = await bookingRepository.findById(bookingId);
if (!booking) throw new NotFoundError('BOOKING');
if (booking.userId !== actorId) throw new ForbiddenError();
```

- Never accept a `userId` from a request body or query string for a mutation. The only source
  of the actor's identity is the session.
- Guessing another user's booking id must produce `403`, not a successful cancel. This is
  explicitly checked; `scripts/verify-ownership.ts` should demonstrate it end to end.
- `GET /api/bookings` filters by session user in the `WHERE` clause, not after fetching.
- Admin-only routes check a role on the session, in the same place, the same way.

## Audit trail

Booking lifecycle events are evidence, not debug output. They go to an `audit_events` table:

`id, occurredAt, actorId, action, roomId, bookingId, outcome, requestId, payload (jsonb)`

Actions to record: `BOOKING_CREATED`, `BOOKING_REJECTED_OVERLAP`, `BOOKING_CANCELLED`,
`BOOKING_SHORTENED`, `SERIES_CREATED`, `SERIES_CANCELLED`.

Two things that are easy to get wrong:

- The rejected-overlap event **must not** be written inside the transaction that just failed —
  it would roll back with it. Write it after the catch, in its own statement.
- Successful events are written inside the same transaction as the change they describe, so a
  booking can never exist without its audit row.

## Request logging

- `pino` with JSON output. Every log line carries `requestId`, and authenticated lines carry
  `userId`.
- The `requestId` is generated in `withRoute` (or taken from an inbound `x-request-id`) and
  returned on the response so a support conversation can be tied to a log line.
- Never log password hashes, cookie values, tokens, or full request bodies containing them.
  Log ids and outcomes.

## General

- Secrets come from validated environment variables only — no defaults baked into source, no
  committed `.env`.
- Passwords are hashed with `argon2id`. Never `md5`, `sha256`, or `bcrypt` with a low cost.
- Login responses do not distinguish "no such user" from "wrong password".
- Rate-limit the login route even in the POC; a fixed-window counter is enough and takes ten
  minutes.
