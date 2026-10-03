# syntax=docker/dockerfile:1
#
# Multi-stage build producing one small runtime image shared by all three
# server processes (api / paper-trading / real-trading) — they're the same
# compiled dist/ output, just started with a different entrypoint and PORT,
# exactly matching the existing npm start:* scripts. docker-compose.yml
# selects which one each service runs via `command:`.
#
# A `lambda` stage (for the backtest worker, built from this same dist/
# output) lands here in a follow-up once the EC2 side is proven out —
# deliberately not started yet, see the AWS deployment plan.
#
# Node version: pin to whatever is current LTS at deploy time — 22 as of
# this writing, but confirm before shipping since this file will outlive
# that being current.

FROM node:22-alpine AS deps
WORKDIR /app
# package-lock.json copied separately so this layer only rebuilds when
# dependencies actually change, not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

# Second, production-only install — the runtime image ships neither
# devDependencies (typescript, ts-node, jest, eslint, ...) nor source .ts
# files, only the compiled dist/ output and what it needs at runtime.
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS server
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER app

# Every server process (api/paper/real) mounts the same Express app and
# therefore the same /health route (app/index.ts) — see runtime/bootstrap.ts.
# PORT is set per-service in docker-compose.yml.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||8080)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Default: API-only mode. docker-compose.yml overrides `command:` for the
# paper-trading and real-trading services to run their own dist/ entrypoint.
CMD ["node", "dist/index.js"]
