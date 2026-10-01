# Meeting Room & Resource Booking — POC

A two-week solo proof of concept for booking meeting rooms with a guarantee that two
overlapping requests for the same room can never both succeed. Requirements are in
[`PROJECT.md`](./PROJECT.md), architecture and conventions in [`CLAUDE.md`](./CLAUDE.md).

## Build roadmap

This is being built as a full-stack learning exercise, in small phases — see
[`docs/roadmap.md`](./docs/roadmap.md) for the phase-by-phase plan and prompts, tracked with a
checkbox per phase.

## Prerequisites

- Docker with Compose v2 — this is all you need to run the app.
- Node.js 22+ and Yarn Classic (`1.22.x`) — only for host-side work: `yarn dev`,
  `yarn db:studio`, and the `yarn verify:*` scripts.

## Run it

```bash
cp .env.example .env
# set SESSION_SECRET — at least 32 characters, e.g. `openssl rand -hex 32`
docker compose up --build
```

Then open <http://localhost:3000> and log in with one of the [seeded accounts](#seeded-accounts).
Use `localhost`, not a LAN IP: the container runs with `NODE_ENV=production`, so the session
cookie is `Secure`, and browsers only accept that over plain HTTP on `localhost`.

There are no manual steps. `web` waits for the `db` healthcheck, and every time it starts, its
entrypoint (`docker/entrypoint.sh`) runs `prisma migrate deploy`, then the seed, then the
standalone Next.js server. Both steps are safe to repeat on every restart. `migrate deploy` only
applies migrations not already recorded, and the seed upserts. `docker compose down -v` deletes
the database volume, so you start fresh next time.

```bash
curl localhost:3000/api/health
# {"status":"ok","env":"production"}
```

Postgres is also published on the host at `localhost:$POSTGRES_PORT` (default `5433`). This is
only so `yarn db:studio` can browse the data, along with the verify scripts' cleanup. The app
container connects to it over the compose network as `db:5432`.

### Developing on the host instead

```bash
docker compose up db -d   # Postgres only
yarn install
yarn db:migrate           # applies all migrations, including the exclusion constraint
yarn db:seed
yarn dev                  # stop the `web` container first — both want port 3000
```

## Seeded accounts

The seed runs automatically on every `web` container start (and via `yarn db:seed` on the host).
It is idempotent, so it's safe to re-run, and it creates:

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

```bash
curl -b cookies.txt -X POST localhost:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"roomId":"<id>","recurrence":{"weekday":2,"localStartTime":"10:00","localEndTime":"11:00","timezone":"Asia/Kolkata","occurrenceCount":8}}'
# 201 — { series, occurrences: [...] }. weekday: 0=Sun..6=Sat. First occurrence is the next
# Tuesday whose 10:00 hasn't happened yet; each later one is exactly 7 local days after that,
# so the series stays at 10:00 local even across a DST boundary in `timezone`.

curl -i -b cookies.txt -X DELETE localhost:3000/api/booking-series/<seriesId>
# 204 — cancels every remaining CONFIRMED, not-yet-ended occurrence; past/already-ended ones,
# and any occurrence already cancelled individually, are left exactly as they were.
```

The same POST endpoint handles both shapes — a `recurrence` object in the body means recurring,
its absence means single. A recurring request is all-or-nothing: if _any_ occurrence in the
series would collide, the whole thing is rejected with `409 ROOM_ALREADY_BOOKED` and
`details.conflicts` listing every colliding occurrence and what it clashed with — not just the
first one found — and nothing partial is ever booked. `DELETE /api/bookings/:id` still cancels
one occurrence without touching the rest of its series; an occurrence is just a `bookings` row
with `seriesId` set, identical in every other respect to a one-off booking.

## Admin: utilisation

```bash
curl -b admin-cookies.txt \
  'localhost:3000/api/admin/utilisation?roomId=<id>&from=2026-09-21&to=2026-10-18'
# 200 — { data: [{ room, weeks: [{ weekStart, bookedMinutes, availableMinutes, bookingCount }],
#   totals }], meta: { from, to, bookableWindow } }. Omit roomId for every room.
```

Admin only (`403 FORBIDDEN` for a `USER` session). `from`/`to` are calendar dates
(`YYYY-MM-DD`, inclusive, at most 366 days apart) and select whole weeks. Every week in range is
returned, including weeks with no bookings. Durations are integer minutes, so the UI divides by
60 to show hours. Booked time is aggregated in one SQL query grouped by room and
`date_trunc('week', "startsAt")`. When scoped to one room, the query uses
`bookings_roomId_startsAt_idx`. The plan is explained in `utilisation.repository.ts`, and the
rules are under "Documented decisions" below.

In the browser, `/admin/utilisation` (the "Utilisation" nav link, admins only) shows every room
against the selected weeks. Selecting a room name opens its week-by-week table of hours booked
vs. available. The page checks the admin role server-side in its own `page.tsx`, not only in
`admin/layout.tsx`, because Next.js layouts don't re-run on client-side navigation. A non-admin
who opens the URL directly is redirected to `/` before any data is fetched, and the API refuses
them with `403` regardless.

## Concurrency verification

The headline demo. It proves two truly simultaneous overlapping booking requests can never both
succeed. Run it from the host against the running stack, either `docker compose up` or
`yarn dev`. Both serve `localhost:3000` and both already have the seeded alice and john accounts:

```bash
yarn install              # once, for tsx
yarn verify:concurrency
```

The script makes its HTTP requests to `APP_URL` (default `http://localhost:3000`). It uses
`DATABASE_URL` from `.env` to delete what it created, and that variable already points at the
compose database's host port.

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

| Variable                                              | Purpose                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Credentials the `db` container is initialised with.                                                                                                                                                                                                                                                                                                      |
| `POSTGRES_PORT`                                       | Host port the `db` container is published on. Defaults to `5433`, not `5432`, since a local Postgres install commonly already owns `5432`.                                                                                                                                                                                                               |
| `DATABASE_URL`                                        | Connection string for host-side tooling (`yarn dev`, `db:studio`, `verify:*`) — `localhost:$POSTGRES_PORT`. Keep it in sync with the `POSTGRES_*` values above. The `web` container ignores it: compose builds its own URL to `db:5432` from the `POSTGRES_*` values, so a password with URL-reserved characters (`@`, `/`, `:`) needs percent-encoding. |
| `SESSION_SECRET`                                      | Signs/verifies the session JWT. At least 32 characters (`openssl rand -hex 32`); rotating it invalidates every existing session. Required: `docker compose up` refuses to start without it.                                                                                                                                                              |

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
- **A recurring series is all-or-nothing.** If any occurrence in the requested series would
  collide with an existing booking, the whole series is rejected with `409 ROOM_ALREADY_BOOKED`
  and `details.conflicts` listing every clashing occurrence and what it clashed with — nothing
  partial is ever booked. The exclusion constraint can only ever report the first collision it
  happens to hit, one at a time, so `booking.service.ts` runs a pre-check query across all N
  occurrences first to build that full list, then still creates the series through the same
  constraint-backed transaction the pre-check is not a substitute for (ADR 0001) — ending up
  with a real conflict at that point (a race the pre-check couldn't have seen) re-runs the same
  full check after rollback, same "fresh read after a failed transaction" shape the single-
  booking path already uses. The alternative — book what fits, report the rest — is defensible
  too; switching to it means updating this note.
- **A brand-new series' first occurrence is never something already in progress or past.**
  Not spelled out in the spec: given only a weekday, time and occurrence count (no explicit
  start date — see the frontend form in a later phase), the first occurrence is the next date
  matching that weekday whose start time hasn't happened yet, skipping forward a further week
  if today matches but the time already has. Every later occurrence is exactly 7 _local_ days
  after that, converted to UTC fresh per occurrence (not by adding 7×24h to a UTC instant), so
  the series stays pinned to the same local clock time across a DST transition in the series'
  own timezone — verified by hand against a real `America/New_York` series spanning the Nov
  2026 fall-back boundary.
- **Recurring-series timezone conversion uses one `Intl.DateTimeFormat` correction pass, not
  iterated to convergence.** No date library was added for this (`booking-recurrence.ts`) —
  before adding one, CLAUDE.md asks what it replaces and why the standard library won't do, and
  a single correction pass is exact everywhere except inside the DST transition window itself
  (at most an hour, at most twice a year, only for whichever timezone is configured), which is
  an acceptable gap for this POC.
- **A recurring series is capped at 52 occurrences.** A year of weekly bookings is already a
  lot for one request; this POC doesn't support an open-ended series.
- **The utilisation view's "hours available" is 08:00–18:00, Monday to Friday, in UTC: 50 hours
  (3000 minutes) per room per week.** It is defined once, as `BOOKABLE_WINDOW` in
  `src/server/modules/utilisation/bookable-window.ts`. UTC matches how every timestamp is stored.
  A single-site deployment would set its office zone there. Week boundaries are then computed in
  that zone by Postgres (`date_trunc` + `AT TIME ZONE`, DST-aware). A DST change falls overnight,
  outside the window, so the weekly total stays the same.
- **Utilisation reports whole weeks (Monday start), not arbitrary instants.** `from`/`to` are
  dates, and every week containing at least one day of `[from, to]` is included in full. This
  gives every row the same denominator, so a partial first or last week can't look
  under-utilised.
- **A booking's full duration counts towards the week it _starts_ in**, per `date_trunc('week',
"startsAt")`. A booking running across midnight Sunday is not split between weeks. Time booked
  outside the bookable window (evenings, weekends) still counts as booked, because bookings
  aren't restricted to the window. A week can therefore exceed 100% in principle. Only
  `CONFIRMED` bookings count.
- **Utilisation covers every room that still exists, active or not.** Each room's current
  `active` flag is returned so the UI can mark it. Bookings whose room has since been deleted
  (`roomId` is `null`) have no room to report against and are left out.
- **The container ships the standalone server plus a separate, minimal migrate/seed toolkit.**
  `.next/standalone` contains only the node_modules the server traces, so it has no Prisma CLI
  and no `tsx`. The Dockerfile's `db-tools` stage installs `prisma`, `dotenv` and `argon2` into
  `/app/db`, using the exact versions `yarn.lock` resolved. The builder bundles `prisma/seed.ts`
  into one `seed.mjs` with esbuild (`yarn db:seed:bundle`), which resolves the `@/` imports and
  the generated client at build time. esbuild is pinned as a direct dev dependency at the same
  version `tsx` already pulls in. The alternative was shipping the full dev `node_modules` and
  TS sources, which would defeat the point of the standalone build.
