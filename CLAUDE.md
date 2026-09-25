# Meeting Room & Resource Booking — POC

Next.js 16 (App Router) · TypeScript · PostgreSQL 16 · Prisma 7 · Yarn · Docker Compose.

Two-week solo proof of concept. The centre of gravity is **correctness under concurrency**:
two overlapping booking requests for the same room must never both succeed. Everything else
(catalogue, search, cancel/shorten, recurring series, utilisation) is supporting cast.

<!-- Paths below assume a `src/` directory. If this project was scaffolded without `src/`,
     drop the `src/` prefix everywhere. Never mix both layouts. -->

## Commands

```bash
yarn dev                      # next dev (Turbopack is the default in 16)
yarn build                    # next build
yarn lint                     # eslint .        (`next lint` was removed in Next.js 16)
yarn format                   # prettier --write .
yarn typecheck                # tsc --noEmit
yarn db:migrate               # prisma migrate dev
yarn db:studio                # prisma studio
yarn db:seed                  # tsx prisma/seed.ts
yarn verify:concurrency       # tsx scripts/verify-concurrency.ts  (see "No tests" below)
yarn verify:ownership         # tsx scripts/verify-ownership.ts    (see "No tests" below)
docker compose up             # full stack; nothing manual beyond a filled-in .env
```

## Layout

```
src/
  app/
    api/                      # route handlers only — parse, authenticate, delegate, respond
    (app)/                    # UI routes
  server/
    modules/<domain>/         # booking/ room/ auth/ utilisation/
      *.schema.ts             # zod schemas — the single source of truth for I/O types
      *.service.ts            # business rules, transactions, authorisation
      *.repository.ts         # every Prisma / SQL call for this domain
      *.errors.ts             # domain error classes
    db/prisma.ts              # PrismaClient singleton
    http/                     # withRoute wrapper, error envelope, status mapping
    auth/                     # session issue/verify, requireUser()
    audit/                    # audit event writer
    logger.ts                 # pino
  generated/prisma/           # Prisma 7 client output — gitignored, never edited
prisma/
  schema.prisma
  migrations/                 # includes hand-written SQL for the exclusion constraint
docs/adr/                     # architecture decision records
```

A route handler never touches Prisma directly. A service never touches `NextRequest`
or `NextResponse`. Cross-domain calls go service → service, never repository → repository.

## Non-negotiables

- **No `any`, ever** — including `as any`, `any[]`, and untyped catch bindings. Model the
  shape with an interface, a type alias, a discriminated union, or `unknown` + a narrowing
  guard. If a third-party type is genuinely wrong, write a local declaration and comment why.
- **No test files.** The owner has opted out of a test suite for this POC. Do not add Jest,
  Vitest, Playwright, `*.test.ts`, or `__tests__/`. Correctness evidence lives in runnable
  scripts under `scripts/` instead — most importantly `scripts/verify-concurrency.ts`, which
  fires two genuinely simultaneous overlapping bookings and asserts exactly one wins. Keep
  that script working; it is the headline demo. `scripts/verify-ownership.ts` is the same idea
  for authorisation: guessing someone else's booking id must come back 403, never a successful
  read, cancel or shorten.
- **Validate at the boundary.** Every request body, query string and route param is parsed
  with zod inside the route handler. Invalid input is rejected before any service call.
- **Every mutating route is authenticated**, and ownership is re-checked in the service using
  the session user id. Never trust an id from the client.
- Booking created, cancelled, shortened, and every _rejected_ double-booking attempt writes a
  row to `audit_events`.

## The concurrency decision

Overlap prevention is enforced by a **PostgreSQL exclusion constraint** on the bookings table
(`btree_gist`, `room_id WITH =` and `tstzrange(starts_at, ends_at, '[)') WITH &&`, partial on
`status = 'CONFIRMED'`). The database refuses the second writer; the application catches
SQLSTATE `23P01` and returns `409 ROOM_ALREADY_BOOKED`.

Rationale, and why not the alternatives, lives in `docs/adr/0001-double-booking-prevention.md`.
Keep that ADR current — being able to defend this choice is an explicit review criterion.
Never add an application-level "check then insert" as a substitute; a pre-check is only ever a
fast path for a friendlier error message, and the constraint stays authoritative.

## Conventions

- `async`/`await` only. No `.then()` chains, no floating promises.
- Named exports everywhere except Next.js files that require a default export
  (`page.tsx`, `layout.tsx`, `route.ts` handlers are named `GET`/`POST`/etc.).
- All timestamps are `timestamptz`, stored and compared in UTC. Formatting for display is a
  presentation concern and stays in the UI layer.
- Money-free, but treat durations the same way: minutes as integers, never floats.
- Filenames are kebab-case; types and components are PascalCase; everything else camelCase.
- Comments explain _why_. Do not narrate what the next line does.

## Working agreement

- Before adding a dependency, say what it replaces and why the standard library or an existing
  dependency will not do.
- When a requirement is ambiguous (what happens when someone shortens a booking that has
  already started, what counts as "available hours" for utilisation), pick a defensible rule,
  implement it, and write it down in `README.md` under "Documented decisions".
- Prefer one well-shaped query over loading rows and filtering in TypeScript. If a query needs
  an index to be defensible, add the index in the same migration.
- **Claude never runs `git commit` (or anything that creates a commit) in this repo, full
  stop — no exceptions, even at a phase boundary that `docs/roadmap.md` marks "commit after
  each phase."** Also never run `git add` / stage changes after making an edit. Leave the
  working tree exactly as the edits left it — unstaged — and let the owner review, stage, and
  commit personally.

Topic-specific rules live in `.claude/rules/` and load when the matching files are opened.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
