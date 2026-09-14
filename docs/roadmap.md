# Build roadmap

This POC is being built as a full-stack learning exercise, in small phases. Each phase is
worked on in its own session, with a scoped prompt so the previous phase's context doesn't need
to be re-explained. `CLAUDE.md` and `.claude/rules/**` stay loaded throughout and are the source
of truth for how each phase should be implemented — this file only tracks sequencing and
progress.

Check a phase off once its "Verify" step passes, before starting the next one.

## Phase 1 — Foundations (repo, Docker db, env, skeleton)

**Learn:** project structure, env validation, Docker Compose basics, pino logging.

```
Initialize git in this repo. Set up the foundation per CLAUDE.md and .claude/rules/docker-and-env.md:
- docker-compose.yml with just the `db` service (postgres:16-alpine, named volume, healthcheck)
- .env.example and .env with DATABASE_URL for that db
- src/server/env.ts — zod-validated env, fails loudly at boot
- src/server/logger.ts — pino JSON logger
- Move app/ to src/app/ if needed and create the src/server/ skeleton folders from CLAUDE.md
  (modules/, db/, http/, auth/, audit/) with just placeholder index files
- One GET /api/health route to prove the app boots and reads env correctly
Don't add Prisma or auth yet — that's later phases. Explain each config choice briefly as you go.
```

**Verify:** `docker compose up db`, `yarn dev`, `curl localhost:3000/api/health` returns ok.

- [x] Done

## Phase 2 — Data model & the exclusion constraint

**Learn:** Prisma 7 setup, hand-written SQL migrations, Postgres exclusion constraints.

```
Set up Prisma per .claude/rules/prisma-postgres.md and .claude/rules/booking-domain.md:
- prisma/schema.prisma with rooms, equipment, room_equipment, booking_series, bookings, audit_events
- prisma.config.ts and src/server/db/prisma.ts singleton
- Run the normal migration, then a --create-only migration adding btree_gist and the
  bookings_no_overlap exclusion constraint exactly as described in docs/adr/0001
- prisma/seed.ts seeding a couple of users (argon2-hashed passwords), rooms, and equipment
Walk me through why the exclusion constraint can't be expressed in schema.prisma directly.
```

**Verify:** `yarn db:migrate`, `yarn db:seed`, inspect the constraint in `yarn db:studio` or psql.

- [x] Done

## Phase 3 — Auth

**Learn:** sessions, password hashing, the `withRoute` wrapper pattern.

```
Implement auth per .claude/rules/security-and-audit.md and .claude/rules/api-routes.md:
- src/server/auth/ with getSession() and requireUser(), JWT in an httpOnly cookie, argon2id
- src/server/http/ — withRoute wrapper, the error envelope, status/code mapping table
- POST /api/auth/login and POST /api/auth/logout using the seeded users
Keep it to login/logout only — no signup flow needed for this POC. Show me how withRoute
keeps route handlers free of auth logic.
```

**Verify:** log in via curl, get the cookie, confirm a deliberately-protected test route 401s
without it.

- [ ] Done

## Phase 4 — Room catalogue & availability search

**Learn:** filtering in SQL (not in JS), the `NOT EXISTS` overlap-probe query.

```
Implement the room module per .claude/rules/booking-domain.md and .claude/rules/api-routes.md:
- room.schema.ts / .service.ts / .repository.ts
- GET /api/rooms — filter by capacity and equipment
- GET /api/rooms/availability — the real free-for-the-whole-window query, not a client filter
No auth needed on these (browsing is public). Explain the HAVING count(DISTINCT...) trick for
AND-filtering equipment.
```

**Verify:** curl several filter combinations, confirm a room with a partial-overlap booking is
correctly excluded.

- [ ] Done

## Phase 5 — Booking creation (the core feature)

**Learn:** transactions, translating a Postgres SQLSTATE into an API error.

```
Implement single booking creation per .claude/rules/booking-domain.md, .claude/rules/api-routes.md
and .claude/rules/security-and-audit.md:
- booking.schema.ts / .service.ts / .repository.ts / .errors.ts
- POST /api/bookings (auth required), GET /api/bookings (own only), GET /api/bookings/:id
- isOverlapViolation() detecting SQLSTATE 23P01 → 409 ROOM_ALREADY_BOOKED
- audit_events rows for BOOKING_CREATED (inside the tx) and BOOKING_REJECTED_OVERLAP
  (after rollback, its own statement)
No recurring series yet. Show me the exact sequence when the exclusion constraint fires.
```

**Verify:** book a slot, then try an overlapping one manually — confirm 201 then 409 with
`ROOM_ALREADY_BOOKED`.

- [ ] Done

## Phase 6 — Concurrency verification script (the headline demo)

**Learn:** what "genuinely simultaneous" means, `Promise.all` races.

```
Write scripts/verify-concurrency.ts per CLAUDE.md and docs/adr/0001: fire two overlapping
POST /api/bookings requests with Promise.all against the running dev server, assert exactly
one 201 and one 409 ROOM_ALREADY_BOOKED. Wire it as `yarn verify:concurrency`. Run it several
times in a row and explain why a single passing run isn't sufficient evidence.
```

**Verify:** `yarn verify:concurrency` passes repeatedly, including back-to-back runs.

- [ ] Done

## Phase 7 — Cancel, shorten & ownership

**Learn:** authorization-in-service-layer, time-based business rules.

```
Implement cancel/shorten per .claude/rules/booking-domain.md and .claude/rules/security-and-audit.md:
- PATCH /api/bookings/:id (shorten only, endsAt earlier), DELETE /api/bookings/:id (cancel)
- Ownership re-checked against the session id, never trust an id in the request
- BOOKING_NOT_MODIFIABLE rules: already-ended bookings can't change; already-started bookings
  can be shortened but only to now() or later
- scripts/verify-ownership.ts proving a 403 when hitting someone else's booking id directly
- Add the shorten-after-start rule to README.md under "Documented decisions"
```

**Verify:** run the ownership verification script, confirm cancelling frees the slot
immediately.

- [ ] Done

## Phase 8 — Recurring bookings

**Learn:** materialized occurrences vs. one row per series, all-or-nothing transactions,
DST-safe recurrence.

```
Implement recurring series per .claude/rules/booking-domain.md:
- booking_series creation generating N occurrences inside one $transaction
- All-or-nothing: any occurrence collision rejects the whole series with 409 + details.conflicts
- Weekly recurrence computed in the series' stored timezone, converted to UTC only at write time
- DELETE /api/bookings/:id still cancels one occurrence without touching the series
- DELETE /api/booking-series/:id cancels the remaining future occurrences
- Document the all-or-nothing rule in README.md
```

**Verify:** book an 8-week series, cancel week 3 only, confirm weeks 1-2 and 4-8 are untouched.

- [ ] Done

## Phase 9 — Utilisation view

**Learn:** aggregate SQL, `date_trunc`, admin-only routes, explaining a query plan.

```
Implement the utilisation view per .claude/rules/booking-domain.md and .claude/rules/security-and-audit.md:
- utilisation.service.ts / .repository.ts — aggregate by room and date_trunc('week', startsAt)
- A single documented "bookable window" constant (e.g. 08:00-18:00 Mon-Fri) used for hours-available
- GET /api/admin/utilisation?roomId=&from=&to= (admin role required)
- Document the bookable-window definition in README.md
Run EXPLAIN on the aggregate query and walk me through whether the index is being used.
```

**Verify:** query across a date range, cross-check the summed hours by hand for one room/week.

- [ ] Done

## Phase 10 — Frontend: search, booking, my bookings

**Learn:** App Router data fetching, forms, client-side state for a booking flow.

```
Build the core UI in src/app/(app)/ using Tailwind (already set up):
- Login page
- Room search page: date/time range, min capacity, equipment checkboxes → results
- Book a room from a search result, with confirmation and a clear error state for
  ROOM_ALREADY_BOOKED (someone beat you to it, not a generic error)
- "My bookings" page listing own bookings with cancel and shorten actions
No recurring UI or admin UI yet — those are next.
```

**Verify:** run the golden path in the browser end to end; then open two tabs and try to book
the same slot from both to see the 409 surface properly.

- [ ] Done

## Phase 11 — Frontend: recurring booking + admin utilisation

**Learn:** presenting an all-or-nothing conflict result, a simple aggregate dashboard.

```
Add to the UI:
- A "recurring" option on the booking form (weekday, time, week count), showing
  details.conflicts clearly if the series is rejected
- An admin utilisation page: room selector, date range, table or simple chart of hours
  booked vs. available per week
Gate the admin page behind the admin role.
```

**Verify:** create a recurring series that deliberately conflicts on one week, confirm the
conflict is shown clearly and nothing partial was booked.

- [ ] Done

## Phase 12 — Full containerization & final pass

**Learn:** multi-stage Docker builds, non-interactive migrations, the acceptance bar.

```
Finish per .claude/rules/docker-and-env.md:
- Multi-stage Dockerfile (deps/builder/runner, node:22-alpine, output: 'standalone')
- Add the `web` service to docker-compose.yml, waiting on db's healthcheck
- Entrypoint script running `prisma migrate deploy` then the seed then next start
- .dockerignore
- README: prerequisites, .env vars, docker compose up, seeded login credentials,
  yarn verify:concurrency instructions, and confirm the "Documented decisions" section
  is complete, linking to docs/adr/0001
Then run yarn lint --fix && yarn format && yarn typecheck and fix anything that surfaces.
```

**Verify:** on a clean checkout, `docker compose up` with only `.env` filled in gets you a
working app — no manual steps.

- [ ] Done

## Notes

- Commit after each phase so there's a checkpoint to diff against.
- If a phase feels too big once you're in it, stop and ask Claude to split it further —
  `.claude/rules/**` will still load correctly on the narrower scope.
- Ask Claude to explain concepts (sessions, exclusion constraints, App Router conventions) as
  it goes — this is a learning exercise, not just a build.
