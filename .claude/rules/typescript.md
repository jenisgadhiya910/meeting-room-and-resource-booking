---
paths:
  - 'src/**/*.{ts,tsx}'
  - 'scripts/**/*.ts'
  - 'prisma/**/*.ts'
  - '*.config.{ts,mts}'
---

# TypeScript

Target TypeScript 5.9+. These compiler options stay on in `tsconfig.json`:

```json
"strict": true,
"noUncheckedIndexedAccess": true,
"exactOptionalPropertyTypes": true,
"noImplicitOverride": true,
"noFallthroughCasesInSwitch": true,
"verbatimModuleSyntax": true,
"isolatedModules": true
```

## No `any`

`any` is banned in this codebase — no `as any`, no `any[]`, no implicit `any` from an untyped
parameter, no `catch (e: any)`. When the shape is genuinely unknown at compile time, use
`unknown` and narrow it:

```ts
try {
  await bookingService.create(input);
} catch (error: unknown) {
  if (isPrismaExclusionViolation(error)) return conflict('ROOM_ALREADY_BOOKED');
  throw error;
}
```

Type guards live next to the type they narrow and are named `isX`. A guard returns
`value is X` and actually checks the fields — never `return true`.

## Interface or type alias

- `interface` for object shapes that describe an entity, a service contract, or a set of
  props, and for anything a consumer might extend.
- `type` for unions, intersections, mapped/conditional types, function signatures, and
  anything derived (`type CreateBookingInput = z.infer<typeof createBookingSchema>`).
- Do not hand-write a type that zod or Prisma already generates. Derive it.

## Modelling

- Reach for discriminated unions instead of optional-field soup. A booking result is
  `{ status: 'created'; booking: Booking } | { status: 'conflict'; conflicts: Occurrence[] }`,
  not one object where half the fields are `undefined`.
- Model outcomes that callers are expected to handle as return values; use thrown domain
  errors for the exceptional path. Do not use exceptions for ordinary control flow.
- Use `readonly` on arrays and fields the code never mutates. Prefer `as const` over enums for
  small closed string sets; keep Prisma enums for values the database also knows about.
- Branded ids (`type RoomId = string & { readonly __brand: 'RoomId' }`) are welcome where they
  prevent mixing up `roomId` and `bookingId`, but only if applied consistently.

## Boundaries

Anything crossing a process boundary — HTTP body, query string, `process.env`, JSON from the
database — is `unknown` until a zod schema has parsed it. `as SomeType` on unvalidated input is
a bug, not a shortcut.

Environment variables are read once through a parsed `env` module, never as bare
`process.env.FOO!` scattered through the code. The non-null assertion is banned anyway.

## Async

- Every promise is awaited or explicitly handled. No fire-and-forget without a `void` operator
  and a comment saying why the result is discarded.
- Use `Promise.all` for independent work, sequential `await` when order matters. Do not
  `Promise.all` over writes that must share a transaction.
- Never mark a function `async` if it has no `await` in it.
