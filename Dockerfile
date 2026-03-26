# ProteaAI Web — multi-stage Docker build
#
# Stage 1 (builder): installs all deps and compiles both the React SPA and
#                    the Express server.
# Stage 2 (runtime): copies only the compiled output and production deps to
#                    keep the final image lean.
#
# Usage:
#   docker build -t proteaai-web .
#   docker run -p 3001:3001 --env-file .env proteaai-web

# ── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder

# Native deps required by better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (including devDependencies needed for the build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and config files
COPY . .

# Build the React SPA (outputs to dist/web/)
RUN npm run build:web-client

# Build the Express server (outputs to dist/server/)
RUN npm run build:web-server

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Migrations and shared assets needed at runtime
COPY --from=builder /app/drizzle ./drizzle

# Create default data directory (can be overridden with a bind mount)
RUN mkdir -p /data/proteaai-apps
ENV PROTEAAI_DATA_DIR=/data

EXPOSE 3001

CMD ["node", "dist/server/server/index.js"]
