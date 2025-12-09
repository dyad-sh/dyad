# =============================================================================
# Dyad Web Application - Production Dockerfile
# Multi-stage build: Frontend + Backend
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build Frontend
# -----------------------------------------------------------------------------
FROM node:20-slim AS frontend-builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY vite.web.config.mts ./
COPY tsconfig*.json ./
COPY tailwind.config.* ./
COPY index.html ./

# Install dependencies
RUN npm ci

# Copy source files
COPY src ./src
COPY assets ./assets
COPY shared ./shared

# Build frontend for production
RUN npm run web:build

# -----------------------------------------------------------------------------
# Stage 2: Build Backend
# -----------------------------------------------------------------------------
FROM node:20-slim AS backend-builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy server package files
COPY server/package*.json ./server/

# Install server dependencies
WORKDIR /app/server
RUN npm install --include=dev
RUN npm install -g typescript

# Create symlink for shared node_modules access
WORKDIR /app
RUN ln -s server/node_modules node_modules

# Copy server source
WORKDIR /app/server
COPY server/src ./src
COPY server/tsconfig.json ./
COPY server/drizzle.config.ts ./

# Copy shared schema
COPY src/db ../src/db
COPY server/drizzle ./drizzle
COPY shared ../shared

# Build server
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3: Production Runtime
# -----------------------------------------------------------------------------
FROM node:20-slim AS production

WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy server production dependencies
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm install --omit=dev

# Copy built server
COPY --from=backend-builder /app/server/dist ./dist
# Copy migrations from server/drizzle to /app/server/drizzle
COPY --from=backend-builder /app/server/drizzle ./drizzle

# Copy built frontend to serve as static files
COPY --from=frontend-builder /app/dist-web ./public

# Create data directory
RUN mkdir -p /app/data

# Environment variables
ENV NODE_ENV=production
ENV PORT=3007
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data
ENV STATIC_DIR=/app/server/public

EXPOSE 3007

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3007/api/health || exit 1

# Start server
CMD ["node", "dist/server/src/index.js"]
