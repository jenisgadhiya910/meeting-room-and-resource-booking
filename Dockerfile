# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------------------
# deps — the full install (dev dependencies included: the build needs the
# Prisma CLI, TypeScript and esbuild). Copying only the manifest + lockfile
# first keeps this layer cached until a dependency actually changes.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --non-interactive

# ---------------------------------------------------------------------------
# db-tools — just enough to run `prisma migrate deploy` and the bundled seed
# in the runner, which otherwise only has the standalone server's traced
# node_modules. Versions are read from what yarn.lock resolved in `deps`, so
# the runner's CLI can never drift from the one migrations were written with.
# ---------------------------------------------------------------------------
FROM deps AS db-tools
WORKDIR /db
RUN npm init -y >/dev/null \
  && npm install --omit=dev --no-audit --no-fund \
    "prisma@$(node -p "require('/app/node_modules/prisma/package.json').version")" \
    "dotenv@$(node -p "require('/app/node_modules/dotenv/package.json').version")" \
    "argon2@$(node -p "require('/app/node_modules/argon2/package.json').version")"

# ---------------------------------------------------------------------------
# builder — `prisma generate` must run here: src/generated/ is gitignored, so
# a fresh clone has no client until this step creates it.
# ---------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# src/server/env.ts validates on import, and `next build` imports every route
# while collecting page data. These placeholders only satisfy that parse; they
# are scoped to this RUN, never baked into an image layer's environment, and
# the real values come from compose at runtime.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    SESSION_SECRET=build-time-placeholder-never-used-at-runtime \
    sh -c 'yarn prisma generate && yarn build && yarn db:seed:bundle'

# ---------------------------------------------------------------------------
# runner — standalone server + migration/seed tooling, as the non-root `node`
# user that ships with the official image.
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Kept apart from the standalone tree in /app/db so its node_modules can't
# shadow or be shadowed by the server's traced copy.
COPY --from=db-tools --chown=node:node /db/node_modules ./db/node_modules
COPY --from=builder --chown=node:node /app/prisma.config.ts ./db/
COPY --from=builder --chown=node:node /app/prisma/schema.prisma ./db/prisma/
COPY --from=builder --chown=node:node /app/prisma/migrations ./db/prisma/migrations
COPY --from=builder --chown=node:node /app/build/seed.mjs ./db/seed.mjs
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh

USER node
EXPOSE 3000

# start-period covers migrations + seed on first boot, before server.js listens.
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

ENTRYPOINT ["entrypoint.sh"]
