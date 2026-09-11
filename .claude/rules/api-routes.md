---
paths:
  - 'src/app/api/**/*.ts'
  - 'src/server/http/**/*.ts'
  - 'src/server/modules/**/*.schema.ts'
  - 'src/proxy.ts'
---

# API layer (App Router route handlers)

## Shape of a handler

A handler does exactly four things: resolve the session, parse input, call one service, map
the result to a response. No Prisma, no business rules, no date arithmetic.

```ts
export const runtime = 'nodejs';

export const POST = withRoute(async ({ request, user }) => {
  const body = createBookingSchema.parse(await request.json());
  const booking = await bookingService.create({ ...body, actorId: user.id });
  return created(booking);
});
```

`withRoute` (in `src/server/http/`) is the single wrapper that attaches a request id, enforces
authentication, catches domain errors, maps them to the envelope below, and logs the outcome.
Every route uses it. Auth is not enforced in `proxy.ts` — that file is for redirects and
headers only. A proxy-layer check is bypassable and is not the authorisation boundary.

In Next.js 16 `params` and `searchParams` are promises:

```ts
export const PATCH = withRoute(async ({ params, user }) => {
  const { bookingId } = bookingIdSchema.parse(await params);
  ...
});
```

## Response envelope

Success returns the resource or `{ data, meta }` for collections. Failure always returns:

```json
{ "error": { "code": "ROOM_ALREADY_BOOKED", "message": "...", "details": {} } }
```

`code` is a stable SCREAMING_SNAKE string the frontend switches on. `message` is for humans and
may change. `details` carries structured context — for a conflict, the occurrences that
clashed; for validation, the flattened zod issues.

| Situation                                             | Status | Code                     |
| ----------------------------------------------------- | ------ | ------------------------ |
| zod parse failure, end ≤ start, unknown room id       | 400    | `VALIDATION_FAILED`      |
| no session                                            | 401    | `UNAUTHENTICATED`        |
| session exists, resource belongs to someone else      | 403    | `FORBIDDEN`              |
| id not found (and the caller is allowed to know that) | 404    | `NOT_FOUND`              |
| overlapping booking rejected by the database          | 409    | `ROOM_ALREADY_BOOKED`    |
| shorten/cancel refused by a time rule                 | 409    | `BOOKING_NOT_MODIFIABLE` |
| anything unhandled                                    | 500    | `INTERNAL_ERROR`         |

Never return 200 with an error body, and never collapse a conflict into a generic 500 — the
frontend has to be able to tell "someone beat you to it" from "the server broke".

## Validation

zod schemas live in `<domain>.schema.ts` and are the source of truth for both runtime checks
and the TypeScript input types. Enforce the cross-field rules there, not in the service:

```ts
export const createBookingSchema = z
  .object({
    roomId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });
```

Room existence is a foreign key in the database and a `NOT_FOUND` from the repository — do not
issue an extra `findUnique` purely to pre-validate it.

## Routes

Design them REST-shaped and resource-first; the spec prescribes no particular set.

```
GET    /api/rooms                       filter by capacity + equipment
GET    /api/rooms/availability          date, from, to, minCapacity, equipment[] → free rooms
POST   /api/bookings                    single or recurring
GET    /api/bookings                    caller's own bookings
GET    /api/bookings/:id
PATCH  /api/bookings/:id                shorten (endsAt)
DELETE /api/bookings/:id                cancel one occurrence
DELETE /api/booking-series/:id          cancel the remaining series
GET    /api/admin/utilisation           roomId?, from, to → hours booked vs available
```

- Filtering, sorting and pagination are query parameters parsed by zod, then pushed into SQL.
  Never fetch everything and filter in JavaScript.
- Collections are paginated with `limit`/`cursor`; default `limit` 50, hard cap 200.
- All handlers that touch Prisma declare `export const runtime = 'nodejs'`. The Prisma client
  does not run on the edge runtime.
- Route handlers are dynamic by default in Next.js 16, so no cache opt-out is needed. Do not
  add `'use cache'` to anything that reads booking state.
