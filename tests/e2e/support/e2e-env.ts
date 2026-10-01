import 'dotenv/config';

// Shared by global-setup.ts (main Vitest process) and every test file
// (worker processes) — both derive the same values from the same env, so
// nothing has to be passed between them at runtime.

const TEST_DB_SUFFIX = '_test';

function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit !== undefined && explicit !== '') return explicit;

  // Same server and credentials as the dev database, its own database name —
  // no extra .env line needed for the common local case.
  const devUrl = process.env.DATABASE_URL;
  if (devUrl === undefined || devUrl === '') {
    throw new Error(
      'Set TEST_DATABASE_URL (or DATABASE_URL, to derive it from) before running the e2e suite',
    );
  }
  const url = new URL(devUrl);
  url.pathname = `${url.pathname}${TEST_DB_SUFFIX}`;
  return url.toString();
}

export const TEST_DATABASE_URL = resolveTestDatabaseUrl();
export const TEST_DATABASE_NAME = new URL(TEST_DATABASE_URL).pathname.slice(1);

// The suite truncates every table on startup. Refusing anything not named
// *_test is what stops a mistyped TEST_DATABASE_URL from wiping the dev data.
if (!TEST_DATABASE_NAME.endsWith(TEST_DB_SUFFIX)) {
  throw new Error(
    `Refusing to run e2e tests against "${TEST_DATABASE_NAME}" — the test database name must end in "${TEST_DB_SUFFIX}"`,
  );
}

export const E2E_PORT = Number(process.env.E2E_PORT ?? '3100');
export const BASE_URL = `http://localhost:${E2E_PORT}`;

// Fixed rather than read from .env: sessions minted by the test server are
// only ever verified by the test server, and CI has no .env to read from.
export const TEST_SESSION_SECRET = 'e2e-session-secret-not-used-anywhere-else';
