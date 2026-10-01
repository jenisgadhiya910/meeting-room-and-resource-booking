import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@/generated/prisma/client';

import {
  BASE_URL,
  E2E_PORT,
  TEST_DATABASE_NAME,
  TEST_DATABASE_URL,
  TEST_SESSION_SECRET,
} from './e2e-env';

import type { ChildProcess } from 'node:child_process';

const execFileAsync = promisify(execFile);

const SERVER_READY_TIMEOUT_MS = 120_000;

// Everything a child process (prisma CLI, seed, next dev) needs to talk to
// the test database instead of the dev one. Explicit values win over .env —
// neither dotenv nor Next's env loader overwrites a variable already set.
const testProcessEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: TEST_DATABASE_URL,
  DATABASE_AUTH: 'password',
  SESSION_SECRET: TEST_SESSION_SECRET,
  APPLICATIONINSIGHTS_CONNECTION_STRING: '',
};

async function ensureDatabaseExists(): Promise<void> {
  // CREATE DATABASE takes an identifier, not a bind parameter, so the name is
  // interpolated — only after checking it can't carry anything but a name.
  if (!/^[a-z0-9_]+$/.test(TEST_DATABASE_NAME)) {
    throw new Error(`Unsafe test database name: ${TEST_DATABASE_NAME}`);
  }

  const maintenanceUrl = new URL(TEST_DATABASE_URL);
  maintenanceUrl.pathname = '/postgres';
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: maintenanceUrl.toString() }),
  });

  try {
    const existing = await admin.$queryRaw<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname = ${TEST_DATABASE_NAME}
    `;
    if (existing.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
    }
  } finally {
    await admin.$disconnect();
  }
}

async function migrateAndSeed(): Promise<void> {
  await execFileAsync('yarn', ['prisma', 'migrate', 'deploy'], {
    env: testProcessEnv,
  });

  // Truncate before seeding so every run starts from exactly the seed data —
  // the seed only upserts, it never removes rows a previous run left behind.
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
  });
  try {
    await db.$executeRawUnsafe(
      'TRUNCATE "audit_events", "bookings", "booking_series", "room_equipment", "rooms", "equipment", "users" CASCADE',
    );
  } finally {
    await db.$disconnect();
  }

  await execFileAsync('yarn', ['tsx', 'prisma/seed.ts'], {
    env: testProcessEnv,
  });
}

async function isServerResponding(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function startServer(): Promise<ChildProcess> {
  // Without this check a dev server already on the port would answer the
  // health probe below, and the suite would run against the dev database.
  if (await isServerResponding()) {
    throw new Error(
      `Something is already listening on ${BASE_URL}. Stop it or set E2E_PORT to a free port.`,
    );
  }

  // `detached` gives next dev its own process group, so teardown can stop
  // the workers it forks along with it.
  // NODE_ENV is reset because Vitest sets it to `test`, and next dev then
  // rewrites tsconfig.json's include list for the wrong mode.
  const server = spawn('yarn', ['next', 'dev', '--port', String(E2E_PORT)], {
    env: { ...testProcessEnv, NODE_ENV: 'development' },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  server.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  server.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      // Most often Next's per-directory lock: `yarn dev` is already running.
      throw new Error(`The e2e server exited before it was ready:\n${output}`);
    }
    if (await isServerResponding()) return server;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  stopServer(server);
  throw new Error(`The e2e server did not become ready in time:\n${output}`);
}

function stopServer(server: ChildProcess): void {
  if (server.pid === undefined || server.exitCode !== null) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    // The group is already gone.
  }
}

export default async function setup(): Promise<() => void> {
  await ensureDatabaseExists();
  await migrateAndSeed();
  const server = await startServer();
  return () => {
    stopServer(server);
  };
}
