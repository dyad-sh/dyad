FROM node:20-alpine

WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml* package-lock.json* ./

# Install dependencies
RUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci; \
    else pnpm install; fi

# Copy application files
COPY . .

# Expose Next.js dev server port
EXPOSE 3000

# Start development server
CMD ["pnpm", "run", "dev", "--", "-H", "0.0.0.0"]
