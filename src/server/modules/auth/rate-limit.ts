// Fixed-window counter per security-and-audit.md ("Rate-limit the login
// route even in the POC; a fixed-window counter is enough"). In-memory and
// per-process is sufficient for a single-instance POC; a real deployment
// behind multiple instances would need a shared store (e.g. Redis) instead.
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

interface Window {
  count: number;
  windowStart: number;
}

const attemptsByKey = new Map<string, Window>();

export function checkLoginRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = attemptsByKey.get(key);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    attemptsByKey.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= MAX_ATTEMPTS) return false;

  entry.count += 1;
  return true;
}
