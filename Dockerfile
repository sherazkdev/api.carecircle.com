# Care Circle Reminders API + Scheduler worker
# Secrets (Firebase SA, HMAC keys) must be injected at runtime — never COPY into the image.

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
# Install devDependencies for the build stage (base sets NODE_ENV=production).
ENV NODE_ENV=development
COPY package.json package-lock.json ./
# Lockfile is authored with npm 11+; bookworm-slim ships npm 10.
RUN npm install -g npm@11 \
  && npm ci

FROM deps AS development
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM deps AS build
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM base AS production
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3000
USER node
# Default: API-only. Compose sets PROCESS_MODE=worker for the scheduler service.
# API readiness is checked via Compose healthcheck (/health/ready). Workers have no HTTP listener.
ENV PROCESS_MODE=api
CMD ["node", "dist/server.js"]