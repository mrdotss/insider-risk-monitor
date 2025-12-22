# ============================================
# Insider Risk Monitor - Multi-stage Dockerfile
# ============================================
# Stage 1: Dependencies
# Stage 2: Builder
# Stage 3: Runner (production)
# ============================================

# ============================================
# Stage 1: Install dependencies
# ============================================
FROM node:20-alpine AS deps

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# ============================================
# Stage 2: Build the application
# ============================================
FROM node:20-alpine AS builder

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source files
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js application
# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Build the application
RUN npm run build

# ============================================
# Stage 3: Production runner
# ============================================
FROM node:20-alpine AS runner

# Install OpenSSL for Prisma runtime
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

# Copy Next.js standalone build
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Prisma schema and generated client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated ./src/generated

# Copy worker files for background jobs
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/src/types ./src/types

# Copy scripts for seeding and demo data
COPY --from=builder /app/scripts ./scripts

# Copy node_modules for worker (tsx and dependencies)
COPY --from=builder /app/node_modules ./node_modules

# Set correct permissions
USER nextjs

# Expose port
EXPOSE 3000

# Set hostname for Next.js
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

# Default command: start the Next.js server
CMD ["node", "server.js"]
