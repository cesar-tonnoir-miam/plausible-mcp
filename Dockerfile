# Multi-stage build for the Cloud Run HTTP entry point (src/http-server.ts).
# The STDIO entry point (src/index.ts) is for local/single-user use and is not deployed here.

FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM node:22-slim AS prod-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# node:22-slim ships a non-root "node" user (uid 1000) — no server-side secret to protect,
# but least-privilege costs nothing here. See spec §2.1: the only thing worth protecting is
# the process itself, since it never holds a Plausible API key.
USER node

# Cloud Run injects PORT at runtime; src/config.ts reads it (default 8080 for local use).
EXPOSE 8080

CMD ["node", "dist/http-server.js"]
