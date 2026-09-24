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

curl -b cookies.txt localhost:3000/api/bookings          # your own bookings, cursor-paginated
curl -b cookies.txt localhost:3000/api/bookings/<id>      # 403 if it isn't yours, 404 if it doesn't exist
```

Every overlapping request is rejected by the `bookings_no_overlap` exclusion constraint, never
by an application-level check — see [ADR 0001](./docs/adr/0001-double-booking-prevention.md).
A rejected attempt still writes a `BOOKING_REJECTED_OVERLAP` audit row.

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
- **`GET /api/bookings` keeps real keyset (cursor) pagination**, ordered by `startsAt desc, id
desc` — the one collection the room-listings decision above explicitly carves out, being
  scoped to one caller and, unlike the room catalogue, expected to keep growing. The cursor is
  an opaque token encoding `(startsAt, id)`, not just `id`: `startsAt` alone isn't unique (two
  bookings, even for different rooms, can start at the same instant), so an id-only cursor would
  risk skipping or repeating a row at a page boundary — the exact failure mode
  [Phase 9](./docs/roadmap.md) exists to teach avoiding.
- Still to resolve in later phases: shortening an already-started booking, the all-or-nothing
  recurring series rule, and the bookable window used by the utilisation view.
