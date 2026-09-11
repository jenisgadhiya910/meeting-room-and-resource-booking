---
paths:
  - 'Dockerfile*'
  - 'docker-compose*.y*ml'
  - '.env.example'
  - 'src/server/env.ts'
  - 'README.md'
---

# Docker and environment

The acceptance bar is: clone, fill in `.env`, run `docker compose up`, and the app works. No
manual migration step, no seeding instructions buried in a wiki.

## Compose

Two services: `db` (`postgres:16-alpine`) and `web`. The database gets a named volume and a
healthcheck; `web` waits on `condition: service_healthy` so it never races the database on
first boot.

Migrations and seed run on container start, before `next start` — an entrypoint script that
runs `prisma migrate deploy` then the seed (idempotent, safe to re-run) then hands off. Do not
run `migrate dev` in a container; `deploy` is the non-interactive form.

Expose Postgres on the host only for `prisma studio` convenience, and say so in the README.

## Dockerfile

Multi-stage, `node:22-alpine`:

1. `deps` — copy `package.json` + `yarn.lock`, `yarn install --frozen-lockfile`
2. `builder` — copy source, `yarn prisma generate`, `yarn build`
3. `runner` — `output: 'standalone'` in `next.config.ts`, copy `.next/standalone`,
   `.next/static`, `public`, the Prisma schema and migrations, run as a non-root user

`yarn prisma generate` must run in the build stage. The generated client lives in
`src/generated/prisma/`, which is gitignored, so a fresh clone has nothing until it is
generated — a missing generate step is the classic broken-Docker-build cause here.

`.dockerignore` excludes `node_modules`, `.next`, `.git`, `.env`.

## Environment

`.env.example` is committed, lists every variable with a comment, and stays in sync. Every new
variable is added to three places in the same change: `.env.example`, the compose file, and
`src/server/env.ts`.

```ts
// src/server/env.ts — parsed once, at startup, and imported everywhere else
const envSchema = z.object({
  DATABASE_URL: z.url(),
  SESSION_SECRET: z.string().min(32),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

export const env = envSchema.parse(process.env);
```

A missing or malformed variable must fail loudly at boot with the variable name, not surface
as an undefined-property error three requests later. No `process.env.X` reads outside this
module.

## README

Keep it short and true. It needs: prerequisites, the `.env` variables and where to get values,
`docker compose up`, the seeded login credentials, how to run
`yarn verify:concurrency` against the running stack, and a **Documented decisions** section
covering the shorten-after-start rule, the all-or-nothing series rule, and the bookable-window
definition used by the utilisation view. Link to `docs/adr/0001-double-booking-prevention.md`
rather than repeating it.
