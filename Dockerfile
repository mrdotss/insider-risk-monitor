# ============================================
# Insider Risk Monitor - Optimized Multi-stage Dockerfile
# ============================================
# Targets:
#   - runner (default): Next.js web server (~150MB)
#   - worker: Background job processor (~200MB)
# ============================================

# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:20-alpine AS deps

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copy package files and Prisma schema (needed for postinstall)
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Install all dependencies (including dev for build)
RUN npm ci

# ============================================
# Stage 2: Builder
# ============================================
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js (standalone output configured in next.config.ts)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Prune dev dependencies for smaller production image
RUN npm prune --production

# ============================================
# Stage 3: Web Runner (default target)
# Minimal image for Next.js standalone server
# ============================================
FROM node:20-alpine AS runner

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build (includes minimal node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER nextjs

EXPOSE 3000

ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

CMD ["node", "server.js"]

# ============================================
# Stage 4: Worker Runner
# Includes tsx and libs for background jobs
# ============================================
FROM node:20-alpine AS worker

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

# Copy production node_modules (pruned)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Copy Prisma schema and generated client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated ./src/generated

# Copy worker and lib files
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/src/types ./src/types
COPY --from=builder /app/scripts ./scripts

# Install tsx globally for running TypeScript
RUN npm install -g tsx

# Change ownership of app directory to worker user
RUN chown -R worker:nodejs /app

USER worker

CMD ["tsx", "worker/index.ts"]

# ============================================
# Stage 5: Migrate Runner
# For database migrations and seeding
# ============================================
FROM node:20-alpine AS migrate

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

ENV NODE_ENV=production

# Copy production node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Copy Prisma files
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src/generated ./src/generated

# Copy seed script dependencies
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/src/types ./src/types

# Install tsx globally for seed script
RUN npm install -g tsx

CMD ["sh", "-c", "npx prisma db push && tsx prisma/seed.ts"]
