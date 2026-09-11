# Formatting, linting and tooling

Loaded on every session — these apply to all files.

## Toolchain

- **Prettier** is the only formatter. No hand-alignment, no manual line breaking to "look
  nicer". If Prettier reflows it, that is the correct shape.
- **ESLint 9 flat config** in `eslint.config.mjs`, extending `next/core-web-vitals`,
  `next/typescript`, and `typescript-eslint`'s `recommendedTypeChecked` +
  `stylisticTypeChecked`. `next lint` was removed in Next.js 16 — the script is plain `eslint .`.
- Run `yarn lint --fix && yarn format && yarn typecheck` before declaring a change finished.
  Do not disable a rule to make that pass.

## Rules that must stay enabled

```js
'@typescript-eslint/no-explicit-any': 'error',
'@typescript-eslint/no-unsafe-assignment': 'error',
'@typescript-eslint/no-unsafe-member-access': 'error',
'@typescript-eslint/no-unsafe-call': 'error',
'@typescript-eslint/no-unsafe-return': 'error',
'@typescript-eslint/no-unsafe-argument': 'error',
'@typescript-eslint/no-floating-promises': 'error',
'@typescript-eslint/no-misused-promises': 'error',
'@typescript-eslint/await-thenable': 'error',
'@typescript-eslint/switch-exhaustiveness-check': 'error',
'@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
'@typescript-eslint/no-non-null-assertion': 'error',
'@typescript-eslint/require-await': 'error',
'no-console': ['error', { allow: [] }],
```

`no-console` is deliberate: application code logs through the pino logger, not `console`.
`scripts/**` and `prisma/seed.ts` are the only places where console output is allowed — put
that exception in the flat config as a scoped override, not as an inline `eslint-disable`.

## Suppressions

`eslint-disable` and `@ts-expect-error` need a same-line reason and are limited to genuine
third-party type defects. `@ts-ignore` is never acceptable — `@ts-expect-error` at least fails
when the underlying problem is fixed.

## Files

- Kebab-case filenames: `booking-service.ts`, `availability-schema.ts`. The Next.js reserved
  names (`page.tsx`, `layout.tsx`, `route.ts`, `error.tsx`, `not-found.tsx`, `proxy.ts`) keep
  their required spelling.
- One exported concept per file. A 400-line service file is a signal to split by use case, not
  a reason to add section-header comments.
- Import order: node builtins → external → `@/server/**` → `@/app/**` → relative → types.
  Let the ESLint import plugin enforce it rather than sorting by hand.

## Git

- Conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`).
- One migration per logical schema change, with a descriptive name.
- `.env` is gitignored; `.env.example` is committed and stays in sync with every new variable.
