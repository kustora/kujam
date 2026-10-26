FROM node:26-bookworm-slim AS builder

WORKDIR /app

# Install python3, make, and g++ for native SQLite compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Enable and configure pnpm
RUN corepack enable && corepack prepare pnpm@10.6.5 --activate

# Copy monorepo configs and package dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/sync-yjs ./packages/sync-yjs
COPY examples/hocuspocus-server ./examples/hocuspocus-server

# Install dependencies and build
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @kujam/core build
RUN pnpm --filter @kujam/sync-yjs build
RUN pnpm --filter @kujam/example-hocuspocus-server build

# Production runtime stage
FROM node:26-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=1234
ENV DATABASE_PATH=/app/data/kujam.sqlite

COPY --from=builder /app /app

VOLUME ["/app/data"]

EXPOSE 1234

CMD ["node", "examples/hocuspocus-server/dist/index.js"]
