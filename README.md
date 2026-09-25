# Meeting Room & Resource Booking — POC

A two-week solo proof of concept for booking meeting rooms with a guarantee that two
overlapping requests for the same room can never both succeed. Requirements are in
[`PROJECT.md`](./PROJECT.md), architecture and conventions in [`CLAUDE.md`](./CLAUDE.md).

## Build roadmap

This is being built as a full-stack learning exercise, in small phases — see
[`docs/roadmap.md`](./docs/roadmap.md) for the phase-by-phase plan and prompts, tracked with a
checkbox per phase.

## Prerequisites

- Node.js 22+
- Yarn (Classic, `1.22.x`)
- Docker, for the Postgres database

## Setup

```bash
cp .env.example .env      # adjust POSTGRES_PORT if 5433 is also taken
docker compose up db -d   # starts Postgres only — the app itself still runs on the host
yarn install
yarn db:migrate           # applies all migrations, including the exclusion constraint
yarn db:seed              # seeds the accounts, rooms and equipment below
yarn dev
```

Confirm it's up:

```bash
curl localhost:3000/api/health
# {"status":"ok","env":"development"}
```

Full containerisation of the app itself (a `web` service, multi-stage Dockerfile,
non-interactive migrations on boot) lands in a later phase — see `docs/roadmap.md`. Until then,
Docker Compose only runs the database.

## Seeded accounts

`yarn db:seed` is idempotent — safe to re-run — and creates:

| Email               | Role  | Password       |
| ------------------- | ----- | -------------- |
| `alice@example.com` | USER  | `Password123!` |
| `john@example.com`  | USER  | `Password123!` |
| `admin@example.com` | ADMIN | `Password123!` |

plus 4 rooms (Alpha, Beta, Gamma, Delta) with a mix of projector / video-conferencing /
whiteboard equipment. Two seeded `USER` accounts exist so `scripts/verify-concurrency.ts` can
race two different people over the same room, not one person against themselves.

## Auth

```bash
curl -i -c cookies.txt -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"Password123!"}'

curl -b cookies.txt localhost:3000/api/auth/me
curl -b cookies.txt -X POST localhost:3000/api/auth/logout
```

Sessions are a signed JWT in an `httpOnly`, `sameSite=lax` cookie (7-day expiry, `secure` in
production). Login responses don't distinguish "no such account" from "wrong password", and the
route is rate-limited to 5 attempts per minute per IP (`429 RATE_LIMITED`). There's no signup
flow — only the seeded accounts above can log in.

## Admin: rooms & equipment

```bash
curl -i -c admin-cookies.txt -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"Password123!"}'

curl -b admin-cookies.txt -X POST localhost:3000/api/admin/equipment \
  -H 'Content-Type: application/json' -d '{"key":"standing_desk","label":"Standing desk"}'

curl -b admin-cookies.txt -X POST localhost:3000/api/admin/rooms \
  -H 'Content-Type: application/json' \
  -d '{"name":"Epsilon","location":"Floor 3","capacity":6,"equipmentKeys":["whiteboard"]}'

curl -b admin-cookies.txt -X PATCH localhost:3000/api/admin/rooms/<id> \
  -H 'Content-Type: application/json' -d '{"capacity":8}'

curl -b admin-cookies.txt -X DELETE localhost:3000/api/admin/rooms/<id>
```

Only `admin@example.com` can call these (`403 FORBIDDEN` otherwise). See "Documented decisions"
below for the update/delete guard and why bookings never show live room data.

## Bookings

```bash
curl -b cookies.txt -X POST localhost:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"roomId":"<id>","startsAt":"2026-10-01T10:00:00.000Z","endsAt":"2026-10-01T11:00:00.000Z"}'
# 201, with the room's name/location/capacity/equipment captured in roomSnapshot

curl -b cookies.txt -X POST localhost:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"roomId":"<id>","startsAt":"2026-10-01T10:30:00.000Z","endsAt":"2026-10-01T11:30:00.000Z"}'
# 409 ROOM_ALREADY_BOOKED — same room, overlapping window

curl -b cookies.txt localhost:3000/api/bookings          # your own bookings, page-paginated
curl -b cookies.txt localhost:3000/api/bookings/<id>      # 403 if it isn't yours, 404 if it doesn't exist
```

Every overlapping request is rejected by the `bookings_no_overlap` exclusion constraint, never
by an application-level check — see [ADR 0001](./docs/adr/0001-double-booking-prevention.md).
A rejected attempt still writes a `BOOKING_REJECTED_OVERLAP` audit row.

```bash
curl -b cookies.txt -X PATCH localhost:3000/api/bookings/<id> \
  -H 'Content-Type: application/json' -d '{"endsAt":"2026-10-01T10:30:00.000Z"}'
# 200 — shorten only; moving endsAt later is 400 VALIDATION_FAILED

curl -i -b cookies.txt -X DELETE localhost:3000/api/bookings/<id>
# 204 — cancels this booking; the row is never deleted, so it stays in your booking history
```

Only the owning user can cancel or shorten their own booking — guessing someone else's id
returns `403 FORBIDDEN`, checked against the session, never an id from the request (see
"Documented decisions" for the exact time/status rules). Cancelling frees the slot immediately:
the exclusion constraint is partial on `status = 'CONFIRMED'`, so a cancelled booking stops
counting the moment its status flips, in the same commit — no separate invalidation step.

## Concurrency verification

The headline demo — proves two truly simultaneous overlapping booking requests can never both
succeed, against a running `yarn dev` server:

```bash
yarn db:seed              # needs the seeded alice@example.com and john@example.com accounts
yarn verify:concurrency
```

Fires 20 rounds of two genuinely simultaneous `POST /api/bookings` requests (one from each
seeded user, `Promise.all`, same room, same slot) and asserts every round comes back exactly
one `201` and one `409 ROOM_ALREADY_BOOKED`. A single passing run isn't evidence on its own —
see the comment at the top of `scripts/verify-concurrency.ts` and
[ADR 0001](./docs/adr/0001-double-booking-prevention.md) for why. Re-running it immediately
back-to-back a handful of times is fine; running it more than a couple of times within the same
minute will trip the login route's rate limit (`429 RATE_LIMITED`) — that's the rate limiter
working as intended, not a bug in the script.

Every booking and audit row the run creates is deleted again before the process exits, whether
the run passed or failed, so it's safe to run repeatedly against a real dev database without
piling up throwaway data — see `cleanUp()` in the script.

## Ownership verification

Proves guessing someone else's booking id never works, on every single-booking route, not just
the happy path:

```bash
yarn verify:ownership
```

Creates one booking as `alice@example.com`, then attempts to read, shorten and cancel it as
`john@example.com` — every attempt must come back `403 FORBIDDEN`, the booking must be
genuinely unchanged afterward, and the real owner's own cancel must still succeed (proving the
403s are ownership working, not the routes being broken outright). Cleans up the booking it
creates before exiting either way.

## Environment variables

| Variable                                              | Purpose                                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Credentials the `db` container is initialised with.                                                                                        |
| `POSTGRES_PORT`                                       | Host port the `db` container is published on. Defaults to `5433`, not `5432`, since a local Postgres install commonly already owns `5432`. |
| `DATABASE_URL`                                        | Connection string the app uses to reach Postgres. Keep the host/port/user/password/db in sync with the `POSTGRES_*` values above.          |
| `SESSION_SECRET`                                      | Signs/verifies the session JWT. At least 32 characters; rotating it invalidates every existing session.                                    |

## Documented decisions

- **Double-booking prevention** — a PostgreSQL exclusion constraint, not application code. Full
  rationale in
  [`docs/adr/0001-double-booking-prevention.md`](./docs/adr/0001-double-booking-prevention.md).
- **A room can only be updated or deleted once it has no active or future booking** — any
  `CONFIRMED` booking with `endsAt` still in the future blocks the edit or delete with
  `409 ROOM_HAS_ACTIVE_OR_FUTURE_BOOKINGS`. This is deliberately a blanket rule (every field,
  not just structural ones), so once a room can be changed at all, every one of its bookings is
  already in the past.
- **A booking always shows the room details captured at the moment it was booked** (name,
  location, capacity, equipment — `roomSnapshot`), never a live join to the room. Given the
  rule above, this makes no difference for an active/future booking (the room can't have
  changed since), but it's what makes a past booking keep showing what was actually true when
  it was made — even after the room is later renamed, recapacitated, or deleted entirely.
- **REST over tRPC, and no Server Actions.** This POC uses Route Handlers and REST throughout
  instead, so there's one input boundary per operation, not two.
- **Room listings (`GET /api/rooms`, `/api/rooms/availability`, `/api/admin/rooms`) paginate by
  page number, not a keyset cursor**, so the UI can jump straight to an arbitrary page with
  shadcn's `Pagination` component — a page/pageSize/totalItems/totalPages response, backed by
  `skip`/`take` plus a `count()` query. A forward-only cursor can't express "page 7" without
  walking every page in between, so this supersedes the keyset cursor pagination built in
  [Phase 9](./docs/roadmap.md) for the same endpoints — a deliberate trade for a room catalogue
  this small and this rarely written to concurrently; it is not the pattern to reach for on a
  large or fast-changing collection (bookings, if they were ever listed this way, would keep
  keyset pagination). `GET /api/equipment` still paginates by cursor; it backs filter checkboxes
  only, never a paged UI.
- **No Jest/Vitest/Playwright.** `scripts/verify-concurrency.ts` and `scripts/verify-ownership.ts`
  are the runnable evidence in place of an automated test suite — a deliberate substitution,
  documented in `CLAUDE.md`.
- **A booking can only be made against an `active` room.** Not stated explicitly in the spec;
  the availability search already only ever surfaces active rooms, so `POST /api/bookings`
  rejects a direct request against an inactive or unknown room the same way — `400
VALIDATION_FAILED`, not a distinct code, since either way the caller sent a room id that isn't
  currently bookable.
- **Only a `USER` session can create a booking; `ADMIN` gets `403 FORBIDDEN`.** Per PROJECT.md's
  role table, booking is a user action — admins manage the room catalogue and view utilisation,
  they don't book rooms themselves. `withRoute(handler, { role: 'USER' })` gates
  `POST /api/bookings` the same generic way `{ role: 'ADMIN' }` gates the admin routes.
- **`GET /api/bookings` paginates by page number**, like the room listings (`page`/`pageSize`
  query params, a `page`/`pageSize`/`totalItems`/`totalPages` response), so "My bookings" can
  show real page numbers through the same `RoomPagination` component the room listings use.
  This supersedes an earlier keyset-cursor design for this endpoint (see git history) — a
  deliberate reversal once the UI needed visible page numbers, not "load more".
- **`GET /api/bookings` sorts your next meeting to the top, not just by start time.** CONFIRMED
  bookings that haven't ended yet come first, soonest start first (so an already-started one
  sorts ahead of ones that haven't started, since its `startsAt` is earlier) — everything else
  (cancelled, or already ended, regardless of which happened first) follows, most recently
  relevant first. A cancelled booking with a future `startsAt` is _not_ "upcoming" — it's
  grouped with the past/done bucket, not the top one; that's a deliberate reading of "your
  bookings" as "what still matters to your schedule," not a literal date sort. This is two
  partitions of one logical list sorted in _opposite_ directions — page-number pagination has to
  slice one window out of their concatenation without ever using `$queryRaw`: `booking.repository.ts`
  runs a `count()` + `findMany()` per partition (skipped entirely for a partition a given page
  doesn't overlap), works out in plain arithmetic how much of the requested page falls in each,
  and concatenates the results — no raw SQL, at the cost of up to four query-builder calls per
  page instead of one. Verified by hand-seeding a dataset with several `startsAt` ties spanning
  the boundary and walking every page at a small page size, confirming it matches a single
  unpaginated fetch row-for-row.
- **An already-started booking can be shortened, but only to `now()` or later.** You can end a
  meeting early; you cannot retroactively unbook time you've already occupied. Anything earlier
  than `now()` is `409 BOOKING_NOT_MODIFIABLE`, not `400` — the request is well-formed, it's just
  refused by a time rule, same status/code family as the double-booking rejection.
- **An already-_cancelled_ booking can't be cancelled or shortened again** (`409
BOOKING_NOT_MODIFIABLE`). Not spelled out explicitly in the spec — a cancelled booking can
  still have a future `endsAt`, so "already ended" alone doesn't cover it — but re-cancelling
  (moving `cancelledAt` forward every time) or shortening a cancelled booking clearly isn't what
  the shorten/cancel rules intend.
- Still to resolve in later phases: the all-or-nothing recurring series rule, and the bookable
  window used by the utilisation view.
