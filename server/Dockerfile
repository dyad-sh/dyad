# Dyad Web Application
FROM node:20-slim

WORKDIR /app

# Install dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY server/package*.json ./server/
COPY package*.json ./

# Install server dependencies
WORKDIR /app/server
RUN npm ci --only=production

# Copy source files
WORKDIR /app
COPY src/db ./src/db
COPY drizzle ./drizzle
COPY server ./server

# Build TypeScript
WORKDIR /app/server
RUN npm run build

# Create data directory
RUN mkdir -p /app/data

# Set environment
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=3007
ENV HOST=0.0.0.0

EXPOSE 3007

# Copy entrypoint script
COPY server/entrypoint.sh /app/server/entrypoint.sh
RUN chmod +x /app/server/entrypoint.sh

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3007/api/health || exit 1

ENTRYPOINT ["/app/server/entrypoint.sh"]
