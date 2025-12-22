# Insider Risk Monitor

An internal security MVP that ingests security-relevant logs, normalizes events into a common schema, computes explainable risk scores using rule-based behavioral anomaly detection, and surfaces alerts in a triage-focused dashboard.

## Features

- **Event Ingestion API** - Receive security logs from multiple sources via HTTP API
- **Event Normalization** - Transform raw events into a common schema
- **Behavioral Baselines** - Compute rolling 14-day behavioral profiles per actor
- **Rule-Based Scoring** - Explainable risk scores with visible rule contributions
- **Alert Generation** - Automatic alerts when risk thresholds are exceeded
- **Triage Dashboard** - Overview, alerts list, actor profiles, and admin configuration

## Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- Neon PostgreSQL account (or any PostgreSQL database)

### 1. Clone and Install

```bash
git clone <repository-url>
cd insider-risk-monitor
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Database (Neon PostgreSQL)
DATABASE_URL="postgresql://user:password@host/database?sslmode=require"

# Auth
AUTH_SECRET="generate-a-secure-random-string"
AUTH_URL="http://localhost:3000"

# Admin credentials
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="your-secure-password"
ADMIN_NAME="Admin User"
```

### 3. Start with Docker Compose

```bash
# Start all services (web, worker, redis)
docker compose up

# Or run in detached mode
docker compose up -d
```

This will:
- Run database migrations automatically
- Seed default scoring rules and admin user
- Start the Next.js web application on port 3000
- Start the background worker for scoring and cleanup
- Start Redis for rate limiting

### 4. Access the Dashboard

Open [http://localhost:3000](http://localhost:3000) and log in with your admin credentials.

## Development Setup

For local development without Docker:

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# Seed the database
npm run seed

# Start development server
npm run dev

# In another terminal, start the worker
npm run worker
```

## Event Ingestion

### API Endpoint

```
POST /api/ingest/{sourceKey}
```

### Authentication

Include the API key in the `x-api-key` header:

```bash
curl -X POST http://localhost:3000/api/ingest/vpn \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "timestamp": "2024-01-15T10:30:00Z",
    "userId": "john.doe@company.com",
    "action": "login",
    "ip": "192.168.1.100",
    "success": true
  }'
```

### Event Payload Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| timestamp | string (ISO 8601) | Yes | When the event occurred |
| userId / user / actor | string | Yes | Actor identifier |
| action / type | string | Yes | Action type (login, read, download, etc.) |
| resource | string | No | Resource being accessed |
| resourceId | string | No | Resource identifier |
| ip | string | No | Source IP address |
| userAgent | string | No | User agent string |
| bytes | number | No | Bytes transferred |
| success / outcome | boolean/string | No | Whether action succeeded |

### Example Events

**VPN Login:**
```bash
curl -X POST http://localhost:3000/api/ingest/vpn \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_VPN_API_KEY" \
  -d '{
    "timestamp": "2024-01-15T10:30:00Z",
    "userId": "john.doe@company.com",
    "action": "login",
    "ip": "203.0.113.50",
    "userAgent": "OpenVPN/2.5.0",
    "success": true
  }'
```

**File Download:**
```bash
curl -X POST http://localhost:3000/api/ingest/app \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_APP_API_KEY" \
  -d '{
    "timestamp": "2024-01-15T11:45:00Z",
    "userId": "jane.smith@company.com",
    "action": "download",
    "resource": "document",
    "resourceId": "doc-12345",
    "bytes": 5242880,
    "success": true
  }'
```

**Failed IAM Action:**
```bash
curl -X POST http://localhost:3000/api/ingest/iam \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_IAM_API_KEY" \
  -d '{
    "timestamp": "2024-01-15T14:20:00Z",
    "userId": "service-account@company.com",
    "action": "admin_change",
    "resource": "user",
    "resourceId": "user-67890",
    "success": false
  }'
```

## Demo Workflow

### 1. Generate Demo Data

After starting the services, generate sample data:

```bash
# Using npm script
npm run generate-demo

# Or with Docker
docker compose exec web npx tsx scripts/generate-demo-data.ts
```

This creates:
- 3 actors with normal behavior patterns
- 1 anomalous actor triggering multiple rules
- At least 2 alerts

### 2. Explore the Dashboard

1. **Overview** (`/`) - See alerts today and high-risk actors
2. **Alerts** (`/alerts`) - Browse and filter alerts by severity/status
3. **Alert Detail** (`/alerts/[id]`) - View score breakdown and evidence
4. **Actors** (`/actors`) - See all actors with risk levels
5. **Actor Detail** (`/actors/[id]`) - View timeline and baseline values
6. **Rules** (`/rules`) - Configure scoring rules and thresholds
7. **Sources** (`/sources`) - Manage event sources and API keys
8. **Audit** (`/audit`) - View configuration change history

### 3. Test Alert Generation

Send events that trigger scoring rules:

```bash
# Off-hours activity (if current time is outside 9-17)
curl -X POST http://localhost:3000/api/ingest/vpn \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "timestamp": "'$(date -u +%Y-%m-%dT03:00:00Z)'",
    "userId": "test.user@company.com",
    "action": "login",
    "ip": "10.0.0.1"
  }'

# Volume spike (large download)
curl -X POST http://localhost:3000/api/ingest/app \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "userId": "test.user@company.com",
    "action": "download",
    "bytes": 104857600
  }'
```

## Scoring Rules

| Rule | Description | Default Weight | Default Threshold |
|------|-------------|----------------|-------------------|
| off_hours | Activity outside typical hours | 15 | 2+ events |
| new_ip | First-seen IP in last 14 days | 15 | 1+ new IPs |
| volume_spike | Bytes transferred > 3x baseline | 25 | 3x multiplier |
| scope_expansion | Accessing 2x more resources than normal | 20 | 2x multiplier |
| failure_burst | Many failures in short window | 25 | 5+ failures in 10 min |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Next.js App                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │Dashboard │  │API Routes│  │  Auth    │  │  Admin UI   │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                    Business Logic                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │Ingestion │  │Normalize │  │ Scoring  │  │  Alerting   │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                    Data Layer                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Prisma + Neon PostgreSQL                │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Background Worker                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Baseline │  │ Scoring  │  │Retention │                  │
│  │  (5 min) │  │  (5 min) │  │ (daily)  │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

## Commands Reference

```bash
# Development
npm run dev              # Start Next.js dev server
npm run worker           # Start background worker
npm run build            # Build for production
npm run start            # Start production server

# Database
npm run db:generate      # Generate Prisma client
npm run db:push          # Push schema to database
npm run db:migrate       # Run migrations
npm run db:studio        # Open Prisma Studio

# Data
npm run seed             # Seed default data
npm run generate-demo    # Generate demo data

# Testing
npm test                 # Run tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage

# Docker
docker compose up        # Start all services
docker compose up -d     # Start in detached mode
docker compose down      # Stop all services
docker compose logs -f   # Follow logs
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| DATABASE_URL | PostgreSQL connection string | Required |
| AUTH_SECRET | NextAuth secret key | Required |
| AUTH_URL | Application URL | http://localhost:3000 |
| ADMIN_EMAIL | Default admin email | admin@example.com |
| ADMIN_PASSWORD | Default admin password | Required |
| ADMIN_NAME | Default admin name | Admin User |
| REDIS_URL | Redis connection string | redis://localhost:6379 |
| DATA_RETENTION_DAYS | Event retention period | 90 |
| BASELINE_INTERVAL_MS | Baseline computation interval | 300000 (5 min) |
| SCORING_INTERVAL_MS | Scoring run interval | 300000 (5 min) |
| ALERT_THRESHOLD | Risk score threshold for alerts | 60 |

## Privacy & Security

- **No spyware**: No keylogging, screenshots, or invasive monitoring
- **Existing telemetry only**: Uses security data companies already generate
- **Explainability**: All scores include visible rule contributions
- **Data minimization**: Configurable retention and optional redaction
- **API key security**: Keys stored hashed (bcrypt)
- **Audit logging**: All admin changes are logged

## License

MIT
