---
paths:
  - 'prisma/**'
  - 'src/server/db/**'
  - 'src/server/modules/**/*.repository.ts'
  - 'prisma.config.ts'
---

# Prisma 7 + PostgreSQL

## Setup that must not drift

Prisma 7 changed several defaults. Getting these wrong produces confusing module-resolution
and "DATABASE_URL not found" failures.

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client"          // not prisma-client-js
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"             // no `url` here in v7 — it lives in prisma.config.ts
}
```

```ts
// prisma.config.ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

```ts
// src/server/db/prisma.ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client'; // the /client suffix is required

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter, log: ['warn', 'error'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

The singleton matters: Next.js dev hot-reload will otherwise open a new pool on every edit and
exhaust Postgres connections. Import `prisma` only from this module — never construct a client
elsewhere. `src/generated/prisma/` is gitignored and never edited by hand; regenerate with
`yarn prisma generate` after any schema change.

`DATABASE_URL` is a plain TCP `postgres://` URL pointing at the Compose service.

## Migrations

- Schema changes go through `prisma migrate dev --name <description>`. Never `db push` against
  anything but a throwaway database.
- Constructs Prisma cannot express — the `btree_gist` extension, the exclusion constraint,
  partial and expression indexes — are written as raw SQL inside a migration created with
  `prisma migrate dev --create-only`, then applied. Do not try to fake them with
  `@@unique`; a unique index cannot express range overlap.
- Migrations are forward-only and never edited after being applied anywhere but your own
  machine.

## Query rules

- Filtering, aggregation and grouping happen in the database. Loading rows to count or filter
  them in TypeScript is a defect, not a style preference, and the utilisation view and
  availability search are both explicitly checked for this.
- **Prefer Prisma's query builder over raw SQL.** This project is also a Prisma-learning
  exercise, so reach for `findMany`/`where`/relation filters first, even where raw SQL would be
  more direct. Two techniques worth knowing because they don't look Prisma-shaped at first:
  - AND-filtering a many-to-many relation by several values (e.g. "has every one of these
    equipment keys") is one `some` condition per value, combined with `AND: [...]` — not a
    `HAVING count(DISTINCT ...)` clause. An empty `AND` array is a no-op, so there's no need to
    special-case "no filter requested".
  - A half-open range-overlap check (no confirmed booking overlapping `[from, to)`) is
    `bookings: { none: { status: 'CONFIRMED', startsAt: { lt: to }, endsAt: { gt: from } } }` —
    the standard `a < d AND b > c` equivalence for `[a,b) && [c,d)`, since Prisma has no
    equivalent of Postgres's `tstzrange`/`&&`.
  - Known trade-off, measured on the availability search: the two-comparison form above does
    not get the same GiST range-search benefit a raw `tstzrange(...) && tstzrange(...)` query
    gets from the `bookings_no_overlap` index — Postgres restructures the Prisma-generated
    query into a join across all matching rows rather than a per-room indexed probe. At the
    data volumes this POC runs at, it's not worth the raw SQL; if booking history ever grows
    into the tens of thousands of rows and this query shows up in slow-query logs, that's the
    point to revisit it with `$queryRaw` for just the overlap condition — not preemptively now.
  - `$queryRaw` is still the right call for anything the query builder genuinely cannot express
    at all — grouping by a computed expression like `date_trunc('week', "startsAt")` (the
    utilisation aggregate) has no query-builder equivalent, for instance.
- Prefer `select` over `include`, and list the fields. Returning whole rows leaks columns and
  makes the response shape accidental.
- Avoid N+1: one query with a join/nested `select`, never a `findUnique` inside a loop.
- When `$queryRaw` is genuinely warranted, use tagged-template parameters (never string
  concatenation). Type the result with an explicit interface and validate it with zod if it
  crosses into the service layer.
- Every foreign key and every column used in a `WHERE`, `ORDER BY` or `JOIN` on a hot path
  needs an index, added in the same migration. Say in the migration comment which query it
  serves — and don't add one speculatively; confirm with `EXPLAIN ANALYZE` that a query
  actually benefits from it before keeping it.

## Transactions

- Use `prisma.$transaction(async (tx) => { ... })` for anything that writes more than one row —
  creating a recurring series, cancelling and auditing together.
- Pass `tx` down into repository functions; never mix `tx` and the global `prisma` inside the
  same transaction.
- Keep transactions short. No HTTP calls, no `await` on anything that is not the database.
- Do not raise the isolation level to `Serializable` as a substitute for the exclusion
  constraint; that trade-off is already decided in `docs/adr/0001`.

## Error handling

Catch `PrismaClientKnownRequestError` and map by code rather than string-matching messages:
`P2002` unique violation, `P2003` foreign key violation, `P2025` record not found. Exclusion
constraint violations arrive from the pg driver as SQLSTATE `23P01` — see the booking-domain
rule for how those are detected and surfaced.
