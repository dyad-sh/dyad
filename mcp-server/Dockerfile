# Multi-stage build for Dyad MCP Server
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Switch to non-root user
USER nodejs

# Environment variables
ENV NODE_ENV=production \
    DYAD_API_URL="" \
    MCP_HTTP_PORT=3008 \
    MCP_HTTP_HOST=0.0.0.0

# Expose HTTP port
EXPOSE 3008

# Health check for HTTP server
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3008/health || exit 1

# Start the HTTP proxy server instead of stdio MCP server
CMD ["node", "dist/http-proxy.js"]
