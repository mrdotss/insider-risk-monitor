# Technology Stack

## Overview

Next.js full-stack application with Neon PostgreSQL (serverless), optional Redis/BullMQ for background processing.

## Build System

- npm (Node.js package manager)
- Docker Compose for local development (web + worker + redis)

## Languages & Frameworks

- **Frontend/Backend**: Next.js (App Router) + TypeScript
- **UI**: shadcn/ui + Tailwind CSS
- **Database**: Neon PostgreSQL (serverless, JSONB for metadata)
- **ORM**: Prisma
- **Background Jobs**: BullMQ + Redis (recommended) OR simple in-app scheduler for single node
- **Auth**: Simple Credentials auth (admin user) for MVP

## Database (Neon)

- **Provider**: Neon serverless Postgres
- **Features**: Database branching, autoscaling, scale-to-zero
- **Connection**: Use `@neondatabase/serverless` driver for edge/serverless
- **Branching**: Create dev/staging branches for safe testing
- **Connection string**: Store in `.env` as `DATABASE_URL`

## Key Dependencies

- next, react, typescript
- @prisma/client, prisma
- @neondatabase/serverless (Neon driver)
- tailwindcss, shadcn/ui components
- bullmq, ioredis (if using Redis worker)
- zod (schema validation)

## Common Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Database migrations
npx prisma migrate dev
npx prisma generate

# Push schema to Neon (no migration files)
npx prisma db push

# Start local services (Redis, worker)
docker compose up

# Seed demo data
npm run seed
```

## Environment Setup

1. Copy `.env.example` to `.env`
2. Set `DATABASE_URL` to your Neon connection string
3. Configure other secrets (API keys, etc.)
4. Run `npm install` and `npx prisma generate`
5. Access dashboard at http://localhost:3000

## Security Requirements

- API keys stored hashed (or encrypted at rest)
- Ingestion endpoint must enforce: authentication, schema validation, rate limiting
- Audit log for admin changes to rules, thresholds, sources
- No secrets committed; `.env.example` required
