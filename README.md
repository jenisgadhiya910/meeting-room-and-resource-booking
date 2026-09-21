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
| `admin@example.com` | ADMIN | `Password123!` |

plus 4 rooms (Alpha, Beta, Gamma, Delta) with a mix of projector / video-conferencing /
whiteboard equipment.

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
- **No Jest/Vitest/Playwright.** `scripts/verify-concurrency.ts` and `scripts/verify-ownership.ts`
  are the runnable evidence in place of an automated test suite — a deliberate substitution,
  documented in `CLAUDE.md`.
- Still to resolve in later phases: shortening an already-started booking, the all-or-nothing
  recurring series rule, and the bookable window used by the utilisation view.
