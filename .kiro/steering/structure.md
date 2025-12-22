# Project Structure

## Overview

Next.js App Router project with clear separation of concerns for security event processing.

```
.
├── .kiro/
│   └── steering/           # AI assistant guidance
├── src/
│   ├── app/                # Next.js App Router pages
│   │   ├── api/            # API routes (ingestion, etc.)
│   │   ├── dashboard/      # Dashboard pages
│   │   └── ...
│   ├── components/         # React components (shadcn/ui)
│   ├── lib/                # Core business logic
│   │   ├── ingestion/      # Auth, validation, rate limiting
│   │   ├── normalization/  # Raw payload → event schema mapping
│   │   ├── scoring/        # Rules + baselines engine
│   │   ├── alerting/       # Thresholds, dedup, state
│   │   └── db/             # Prisma client, queries
│   └── types/              # TypeScript types/interfaces
├── prisma/
│   ├── schema.prisma       # Database schema
│   └── seed.ts             # Demo data generator
├── worker/                 # Background scoring process (if separate)
├── docker-compose.yml      # Web + DB + Worker + Redis
├── .env.example            # Required env template
└── README.md               # Setup, ingestion examples, demo workflow
```

## Architecture Layers

Separate concerns strictly:

1. **Ingestion** (`lib/ingestion/`) - API key auth, validation, rate limiting
2. **Normalization** (`lib/normalization/`) - Map raw payloads to common event schema
3. **Scoring** (`lib/scoring/`) - Rule-based scoring with rolling window baselines
4. **Alerting** (`lib/alerting/`) - Threshold evaluation, deduplication, state management
5. **UI** (`app/`) - Triage-focused views (alerts, reasons, actor context)

## File Naming Conventions

- Components: PascalCase (`AlertCard.tsx`)
- Utilities/lib: camelCase (`scoreEvent.ts`)
- Types: PascalCase (`Event.ts`)
- Tests: `*.test.ts` or `*.spec.ts`

## Data Model Principles

Store only what's needed:
- Actor identifier (email/username/id)
- Timestamp
- Source
- Action type
- Resource identifiers (hashed optional)
- IP (optional), user agent (optional)
- Bytes transferred (optional)

## Privacy & Retention

- Configurable retention (30/90/180 days) with cleanup job
- Support redaction toggles per source (e.g., hash resourceId)
