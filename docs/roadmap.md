# Build roadmap

This POC is being built as a full-stack learning exercise, in small phases. Each phase is
worked on in its own session, with a scoped prompt so the previous phase's context doesn't need
to be re-explained. `CLAUDE.md` and `.claude/rules/**` stay loaded throughout and are the source
of truth for how each phase should be implemented — this file only tracks sequencing and
progress.

Backend and frontend phases are interleaved on purpose: each backend phase is followed by a
smaller frontend phase that puts it in front of a browser, rather than leaving all UI work until
the end. That way every backend feature gets tested two ways — via curl/scripts right after it's
built, and again in the browser one phase later.

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

## Phase 3 — Auth (backend)

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

- [x] Done

## Phase 4 — Frontend: auth

**Learn:** App Router client components, a typed fetch wrapper, cookie-based sessions on the
client.

```
Build the auth UI in src/app/(app)/ using Tailwind (already set up):
- A login page: email/password form, calls POST /api/auth/login, shows a clear error for
  invalid credentials and for a 429 rate-limit response
- A small typed fetch helper (e.g. src/lib/api-client.ts) that unwraps the { data } / { error }
  envelope from api-routes.md into something the UI can branch on — later frontend phases
  reuse this rather than each hand-rolling fetch + envelope parsing
- A logout action calling POST /api/auth/logout, redirecting back to the login page
- A minimal authenticated shell page (e.g. "/") that calls GET /api/auth/me to show the
  logged-in user's email — a placeholder until Phase 6 gives it real content
Use the seeded accounts from README.md. No signup UI — matches the backend.
```

**Verify:** log in through the browser with a seeded account, refresh the page and confirm the
session persists, log out, confirm you're redirected away from the authenticated shell.

- [x] Done

## Phase 5 — Room catalogue & availability search (backend)

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

## Phase 6 — Frontend: room search

**Learn:** forms driving query params, rendering search results, empty states.

```
Build the room search page in src/app/(app)/ (this becomes the authenticated shell's real
content from Phase 4):
- A search form: date, start/end time, minimum capacity, equipment checkboxes
- Calls GET /api/rooms/availability with the form values as query params, using the fetch
  helper from Phase 4
- Renders matching rooms (name, location, capacity, equipment) as a results list, with a
  clear empty state when nothing matches
No booking action yet — that's the next phase.
```

**Verify:** search with a few different filter combinations in the browser and confirm the
results match what curl showed in Phase 5.

- [ ] Done

## Phase 7 — Booking creation (backend, the core feature)

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

## Phase 8 — Frontend: booking

**Learn:** optimistic vs. confirmed UI, surfacing a specific 409 instead of a generic error.

```
Add booking to the search results from Phase 6:
- A "Book" action per result opening a confirm step (or inline form) for the exact slot
- Calls POST /api/bookings; on success show a clear confirmation
- On 409 ROOM_ALREADY_BOOKED, show "someone beat you to it" — not a generic error — and let
  the user search again
- On other errors (VALIDATION_FAILED, UNAUTHENTICATED), show a sensible message too
```

**Verify:** book a room end to end in the browser.

- [ ] Done

## Phase 9 — Concurrency verification script (the headline demo)

**Learn:** what "genuinely simultaneous" means, `Promise.all` races.

```
Write scripts/verify-concurrency.ts per CLAUDE.md and docs/adr/0001: fire two overlapping
POST /api/bookings requests with Promise.all against the running dev server, assert exactly
one 201 and one 409 ROOM_ALREADY_BOOKED. Wire it as `yarn verify:concurrency`. Run it several
times in a row and explain why a single passing run isn't sufficient evidence.
```

**Verify:** `yarn verify:concurrency` passes repeatedly, including back-to-back runs. As a bonus
now that the booking UI exists (Phase 8), open two browser tabs and try to book the same slot
from both to see the 409 surface in the UI — but the script, not the tabs, is the real evidence.

- [ ] Done

## Phase 10 — Cancel, shorten & ownership (backend)

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

## Phase 11 — Frontend: cancel & shorten (My bookings)

**Learn:** rendering owned resources, PATCH/DELETE from the client, keeping the list in sync
after a mutation.

```
Build "My bookings" in src/app/(app)/:
- Lists the caller's own bookings (GET /api/bookings)
- Cancel action per booking (DELETE /api/bookings/:id), confirm before cancelling
- Shorten action (PATCH /api/bookings/:id, endsAt earlier) with a simple time picker
- Surface BOOKING_NOT_MODIFIABLE clearly (e.g. "this booking can no longer be changed")
- After cancel/shorten, the list reflects the change immediately (refetch or optimistic update)
```

**Verify:** cancel a booking and confirm the slot is immediately bookable again in the search
page from Phase 6; try to shorten an already-ended booking and see the clear error.

- [ ] Done

## Phase 12 — Recurring bookings (backend)

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

## Phase 13 — Frontend: recurring booking

**Learn:** presenting an all-or-nothing conflict result in a form.

```
Add a "recurring" option to the booking flow from Phase 8:
- Weekday, time, and week-count fields on the booking form
- Calls POST /api/bookings with the recurring payload
- On rejection, show details.conflicts clearly (which dates/times clashed) and make it obvious
  nothing partial was booked
- The series shows up in "My bookings" (Phase 11) as its individual occurrences
```

**Verify:** create a recurring series that deliberately conflicts on one week, confirm the
conflict is shown clearly and nothing partial was booked; cancel one occurrence from "My
bookings" and confirm the rest of the series is untouched.

- [ ] Done

## Phase 14 — Utilisation view (backend)

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

## Phase 15 — Frontend: admin utilisation

**Learn:** a simple aggregate dashboard, gating a page behind a role on both server and client.

```
Build the admin utilisation page in src/app/(app)/:
- Room selector, date range
- Calls GET /api/admin/utilisation and renders hours booked vs. available per week as a table
  or simple chart
- Gate the page behind the admin role, checked against the session (not just a hidden nav
  link) — a non-admin hitting the URL directly should not see the data
```

**Verify:** log in as the seeded admin account and view utilisation across a date range; log in
as the regular seeded user and confirm the page is inaccessible.

- [ ] Done

## Phase 16 — Full containerization & final pass

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

- Commit after each phase yourself so there's a checkpoint to diff against — Claude doesn't
  stage or commit in this repo (see CLAUDE.md's Working agreement).
- If a phase feels too big once you're in it, stop and ask Claude to split it further —
  `.claude/rules/**` will still load correctly on the narrower scope.
- Ask Claude to explain concepts (sessions, exclusion constraints, App Router conventions) as
  it goes — this is a learning exercise, not just a build.
