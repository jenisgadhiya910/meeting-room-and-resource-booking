#!/bin/sh
# Runs on every container start, so both steps must be safe to repeat:
# `migrate deploy` only applies migrations not yet recorded in
# `_prisma_migrations`, and the seed upserts by fixed ids/emails/keys.
set -eu

cd /app/db
./node_modules/.bin/prisma migrate deploy
node seed.mjs

cd /app
# exec so `node` becomes PID 1 and receives SIGTERM from `docker compose down`
# directly, instead of it stopping at this shell.
exec node server.js
