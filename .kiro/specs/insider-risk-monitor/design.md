# Design Document: Insider Risk Monitor

## Overview

Insider Risk Monitor is a web application that ingests security telemetry, normalizes events, computes explainable risk scores using rule-based behavioral anomaly detection, and surfaces alerts in a triage-focused dashboard. The system prioritizes explainability, privacy controls, and data minimization.

### Key Design Principles
- **Explainability over ML**: All scoring is rule-based with visible contributions
- **Privacy by design**: Data minimization, configurable retention, optional redaction
- **Separation of concerns**: Ingestion → Normalization → Scoring → Alerting → UI
- **Single-command deployment**: Docker Compose with auto-migrations and seed data

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Next.js App                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  Dashboard   │  │  API Routes  │  │   Auth       │  │  Admin UI   │ │
│  │  (React)     │  │  /api/*      │  │  (NextAuth)  │  │  (shadcn)   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│                           Business Logic Layer                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  Ingestion   │  │ Normalization│  │   Scoring    │  │  Alerting   │ │
│  │  Service     │  │   Engine     │  │   Engine     │  │   System    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └─────────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│                              Data Layer                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     Prisma ORM + PostgreSQL                       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                           Background Worker                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │  Baseline    │  │   Scoring    │  │  Retention   │                  │
│  │  Computation │  │   Scheduler  │  │   Cleanup    │                  │
│  └──────────────┘  └──────────────┘  └──────────────┘                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Ingestion Service

**Purpose**: Receive, authenticate, validate, and rate-limit incoming events.

```typescript
interface IngestionService {
  ingest(sourceKey: string, apiKey: string, payload: RawEvent): Promise<IngestResult>;
  validateApiKey(sourceKey: string, apiKey: string): Promise<boolean>;
  checkRateLimit(sourceKey: string): Promise<RateLimitResult>;
}

interface IngestResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}
```

**API Contract**:
```
POST /api/ingest/{sourceKey}
Headers:
  x-api-key: string (required)
  Content-Type: application/json
Body: RawEvent (JSON)
Responses:
  202 Accepted: { eventId: string }
  400 Bad Request: { error: string, details: ValidationError[] }
  401 Unauthorized: { error: "Invalid API key" }
  429 Too Many Requests: { error: string, retryAfter: number }
```

### 2. Normalization Engine

**Purpose**: Transform raw events into the common Event schema.

```typescript
interface NormalizationEngine {
  normalize(raw: RawEvent, source: Source): NormalizedEvent;
  applyRedaction(event: NormalizedEvent, settings: RedactionSettings): NormalizedEvent;
}

interface RawEvent {
  timestamp?: string;
  user?: string;
  userId?: string;
  actor?: string;
  action?: string;
  type?: string;
  resource?: string;
  resourceId?: string;
  ip?: string;
  userAgent?: string;
  bytes?: number;
  success?: boolean;
  outcome?: string;
  [key: string]: unknown; // Additional fields preserved in metadata
}


interface NormalizedEvent {
  id: string;           // UUID
  occurredAt: Date;     // When the event happened
  ingestedAt: Date;     // When we received it
  actorId: string;      // User/service identifier
  actorType: 'employee' | 'service';
  source: string;       // vpn, app, iam, file, api
  actionType: string;   // login, read, download, query, admin_change
  resourceType?: string;
  resourceId?: string;  // Optionally hashed
  outcome: 'success' | 'failure';
  ip?: string;
  userAgent?: string;
  bytes?: number;
  metadata: Record<string, unknown>; // Raw fields retained
}
```

### 3. Baseline Engine

**Purpose**: Compute rolling behavioral baselines per actor.

```typescript
interface BaselineEngine {
  computeBaseline(actorId: string, windowDays: number): Promise<ActorBaseline>;
  computeAllBaselines(windowDays: number): Promise<void>;
  getSystemDefaults(): ActorBaseline;
}

interface ActorBaseline {
  actorId: string;
  computedAt: Date;
  windowDays: number;
  
  // Behavioral patterns
  typicalActiveHours: number[];      // Array of hours (0-23) when typically active
  knownIpAddresses: string[];        // IPs seen in baseline period
  knownUserAgents: string[];         // User agents seen
  avgBytesPerDay: number;            // Average bytes transferred
  avgEventsPerDay: number;           // Average event count
  typicalResourceScope: number;      // Count of distinct resources accessed
  normalFailureRate: number;         // Percentage of failed actions (0-1)
  
  // Metadata
  eventCount: number;                // Events in baseline period
  firstSeen: Date;
  lastSeen: Date;
}
```

### 4. Scoring Engine

**Purpose**: Evaluate rules and compute explainable risk scores.

```typescript
interface ScoringEngine {
  scoreActor(actorId: string, baseline: ActorBaseline, recentEvents: NormalizedEvent[]): RiskScore;
  evaluateRule(rule: ScoringRule, baseline: ActorBaseline, events: NormalizedEvent[]): RuleContribution;
}

interface RiskScore {
  actorId: string;
  totalScore: number;           // 0-100
  computedAt: Date;
  ruleContributions: RuleContribution[];
  baselineUsed: ActorBaseline;
  triggeringEvents: string[];   // Event IDs that contributed
}

interface RuleContribution {
  ruleId: string;
  ruleName: string;
  points: number;               // Points added to score
  reason: string;               // Human-readable explanation
  currentValue: number | string;
  baselineValue: number | string;
}

interface ScoringRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  weight: number;               // Max points this rule can contribute
  threshold: number;            // Trigger threshold
  windowMinutes: number;        // Time window for evaluation
}
```

**Default Rules**:

| Rule ID | Name | Description | Default Weight | Default Threshold |
|---------|------|-------------|----------------|-------------------|
| off_hours | Off-Hours Activity | Activity outside typical hours | 15 | 2+ events |
| new_ip | New IP Address | First-seen IP in last 14 days | 15 | 1+ new IPs |
| volume_spike | Volume Spike | Bytes transferred > 3x baseline | 25 | 3x multiplier |
| scope_expansion | Resource Scope Expansion | Accessing 2x more resources than normal | 20 | 2x multiplier |
| failure_burst | Failure Burst | Many failures in short window | 25 | 5+ failures in 10 min |

### 5. Alerting System

**Purpose**: Generate, deduplicate, and manage alerts.

```typescript
interface AlertingSystem {
  evaluateAndAlert(score: RiskScore, threshold: number): Promise<Alert | null>;
  deduplicateAlert(actorId: string, windowMinutes: number): Promise<boolean>;
  updateAlertStatus(alertId: string, status: AlertStatus, userId: string): Promise<Alert>;
}

interface Alert {
  id: string;
  actorId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: AlertStatus;
  score: number;
  ruleContributions: RuleContribution[];
  baselineComparison: BaselineComparison;
  triggeringEventIds: string[];
  createdAt: Date;
  updatedAt: Date;
  acknowledgedBy?: string;
  resolvedBy?: string;
}

type AlertStatus = 'open' | 'acknowledged' | 'resolved' | 'false_positive';

interface BaselineComparison {
  typicalHours: string;
  currentHours: string;
  avgBytes: number;
  currentBytes: number;
  normalScope: number;
  currentScope: number;
  normalFailureRate: number;
  currentFailureRate: number;
}
```

**Severity Mapping**:
- Score 60-69: low
- Score 70-79: medium
- Score 80-89: high
- Score 90-100: critical

## Data Models

### Database Schema (Prisma + Neon PostgreSQL)

The database is hosted on Neon serverless PostgreSQL. Connection via `@neondatabase/serverless` driver for edge compatibility.

```prisma
// Sources - Event origins with API keys
model Source {
  id              String    @id @default(uuid())
  key             String    @unique  // e.g., "vpn", "iam", "app"
  name            String
  description     String?
  apiKeyHash      String               // Hashed API key
  enabled         Boolean   @default(true)
  redactResourceId Boolean  @default(false)
  retentionDays   Int       @default(90)
  rateLimit       Int       @default(1000)  // requests per minute
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  events          Event[]
}

// Events - Normalized security telemetry
model Event {
  id              String    @id @default(uuid())
  occurredAt      DateTime
  ingestedAt      DateTime  @default(now())
  actorId         String
  actorType       ActorType @default(employee)
  sourceId        String
  source          Source    @relation(fields: [sourceId], references: [id])
  actionType      String
  resourceType    String?
  resourceId      String?
  outcome         Outcome   @default(success)
  ip              String?
  userAgent       String?
  bytes           Int?
  metadata        Json      @default("{}")
  
  @@index([actorId])
  @@index([occurredAt])
  @@index([sourceId])
  @@index([actorId, occurredAt])
}

enum ActorType {
  employee
  service
}

enum Outcome {
  success
  failure
}

// Actors - Cached actor information
model Actor {
  id              String    @id @default(uuid())
  actorId         String    @unique  // External identifier
  displayName     String?
  actorType       ActorType @default(employee)
  firstSeen       DateTime
  lastSeen        DateTime
  currentRiskScore Int      @default(0)
  
  baselines       Baseline[]
  alerts          Alert[]
  riskScores      RiskScore[]
}

// Baselines - Rolling behavioral profiles
model Baseline {
  id                  String    @id @default(uuid())
  actorId             String
  actor               Actor     @relation(fields: [actorId], references: [actorId])
  computedAt          DateTime  @default(now())
  windowDays          Int       @default(14)
  
  typicalActiveHours  Json      // number[]
  knownIpAddresses    Json      // string[]
  knownUserAgents     Json      // string[]
  avgBytesPerDay      Float     @default(0)
  avgEventsPerDay     Float     @default(0)
  typicalResourceScope Int      @default(0)
  normalFailureRate   Float     @default(0)
  eventCount          Int       @default(0)
  
  @@index([actorId])
  @@index([computedAt])
}

// Risk Scores - Historical scoring records
model RiskScore {
  id                  String    @id @default(uuid())
  actorId             String
  actor               Actor     @relation(fields: [actorId], references: [actorId])
  totalScore          Int
  computedAt          DateTime  @default(now())
  ruleContributions   Json      // RuleContribution[]
  baselineId          String?
  triggeringEventIds  Json      // string[]
  
  @@index([actorId])
  @@index([computedAt])
}

// Alerts - Generated risk alerts
model Alert {
  id                  String      @id @default(uuid())
  actorId             String
  actor               Actor       @relation(fields: [actorId], references: [actorId])
  severity            Severity
  status              AlertStatus @default(open)
  score               Int
  ruleContributions   Json        // RuleContribution[]
  baselineComparison  Json        // BaselineComparison
  triggeringEventIds  Json        // string[]
  createdAt           DateTime    @default(now())
  updatedAt           DateTime    @updatedAt
  acknowledgedBy      String?
  acknowledgedAt      DateTime?
  resolvedBy          String?
  resolvedAt          DateTime?
  
  @@index([actorId])
  @@index([status])
  @@index([severity])
  @@index([createdAt])
}

enum Severity {
  low
  medium
  high
  critical
}

enum AlertStatus {
  open
  acknowledged
  resolved
  false_positive
}

// Scoring Rules - Configurable detection rules
model ScoringRule {
  id              String    @id @default(uuid())
  ruleKey         String    @unique  // off_hours, new_ip, etc.
  name            String
  description     String
  enabled         Boolean   @default(true)
  weight          Int       @default(10)
  threshold       Float     @default(1)
  windowMinutes   Int       @default(60)
  config          Json      @default("{}")  // Rule-specific config
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}

// System Settings - Global configuration
model SystemSetting {
  id              String    @id @default(uuid())
  key             String    @unique
  value           Json
  updatedAt       DateTime  @updatedAt
}

// Audit Log - Track admin changes
model AuditLog {
  id              String    @id @default(uuid())
  userId          String
  action          String    // rule_updated, source_created, etc.
  entityType      String    // ScoringRule, Source, etc.
  entityId        String
  beforeValue     Json?
  afterValue      Json?
  createdAt       DateTime  @default(now())
  
  @@index([entityType, entityId])
  @@index([createdAt])
}

// Admin Users
model User {
  id              String    @id @default(uuid())
  email           String    @unique
  passwordHash    String
  name            String?
  role            String    @default("admin")
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}
```

## UI Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | Overview | Dashboard home with alerts today, high-risk actors, trends |
| `/alerts` | Alerts List | Paginated, filterable list of alerts |
| `/alerts/[id]` | Alert Detail | Score breakdown, evidence, baseline comparison |
| `/actors` | Actors List | All actors with current risk levels |
| `/actors/[id]` | Actor Detail | Timeline, risk history, baseline values |
| `/rules` | Rules Config | Enable/disable rules, set thresholds/weights |
| `/sources` | Sources | Manage sources, API keys, redaction settings |
| `/audit` | Audit Log | View configuration change history |
| `/login` | Login | Credentials authentication |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Valid Ingestion Produces Stored Event

*For any* valid raw event payload and authenticated source, ingesting the event SHALL result in a normalized event being stored in the database with all required fields populated.

**Validates: Requirements 1.1, 1.4, 2.1**

### Property 2: Invalid Authentication Rejects Request

*For any* request without a valid API key or with an invalid API key, the ingestion endpoint SHALL return 401 Unauthorized and NOT store any event.

**Validates: Requirements 1.2**

### Property 3: Invalid Payload Returns Validation Error

*For any* malformed or invalid JSON payload, the ingestion endpoint SHALL return 400 Bad Request with validation details and NOT store any event.

**Validates: Requirements 1.5**

### Property 4: Normalization Round-Trip

*For any* valid raw event, normalizing it to the Event schema and then serializing back to JSON SHALL produce a valid, complete Event record with all required fields.

**Validates: Requirements 2.1, 2.3, 2.4, 2.5**

### Property 5: Redaction Hashes ResourceId

*For any* event from a source with redaction enabled, the stored resourceId SHALL be a hash of the original value, not the plaintext.

**Validates: Requirements 2.2**

### Property 6: Baseline Computation Produces Valid Record

*For any* actor with at least one event in the baseline window, computing their baseline SHALL produce a valid Baseline record with all behavioral metrics populated.

**Validates: Requirements 3.1, 3.2, 3.5**

### Property 7: Risk Score Range Invariant

*For any* actor and any combination of rule evaluations, the computed risk score SHALL be in the range 0-100 inclusive.

**Validates: Requirements 4.1**

### Property 8: Score Includes Rule Contributions

*For any* computed risk score, the score SHALL include a non-empty list of rule contributions that sum to the total score, with each contribution including rule name, points, reason, and baseline comparison.

**Validates: Requirements 4.3, 4.4**

### Property 9: Scoring Determinism

*For any* actor, baseline, and set of events, computing the risk score multiple times with the same inputs SHALL produce identical results.

**Validates: Requirements 4.6**

### Property 10: Alert Generation Threshold

*For any* risk score >= alert threshold, an Alert SHALL be created. *For any* risk score < threshold, no Alert SHALL be created.

**Validates: Requirements 5.1**

### Property 11: Alert Completeness

*For any* generated Alert, it SHALL contain: actorId, score, severity, non-empty ruleContributions, baselineComparison, and triggeringEventIds.

**Validates: Requirements 5.2**

### Property 12: Alert Severity Mapping

*For any* Alert, the severity SHALL match the score range: 60-69=low, 70-79=medium, 80-89=high, 90-100=critical.

**Validates: Requirements 5.4**

### Property 13: Alert Deduplication

*For any* actor with an existing open alert within the deduplication window, a new high score SHALL NOT create a duplicate alert.

**Validates: Requirements 5.3**

### Property 14: Retention Cleanup Preserves Baselines

*For any* retention cleanup run, events older than the retention period SHALL be deleted, but baseline records SHALL be preserved.

**Validates: Requirements 12.2, 12.3**

### Property 15: Audit Log Completeness

*For any* admin change to rules, sources, or thresholds, an audit log entry SHALL be created with timestamp, user, action, and before/after values.

**Validates: Requirements 15.1, 15.2**

## Error Handling

### Ingestion Errors
- **Invalid API Key**: Return 401, log attempt (rate-limited)
- **Rate Limit Exceeded**: Return 429 with Retry-After header
- **Validation Error**: Return 400 with detailed field errors
- **Database Error**: Return 500, retry with exponential backoff

### Scoring Errors
- **Missing Baseline**: Use system defaults, log warning
- **Rule Evaluation Error**: Skip rule, log error, continue with other rules
- **Database Error**: Retry, alert on persistent failure

### Worker Errors
- **Job Failure**: Retry up to 3 times with exponential backoff
- **Persistent Failure**: Log error, continue with next job

## Testing Strategy

### Unit Tests
- **Normalization**: Test field mapping for each source type
- **Scoring Rules**: Test each rule with edge cases
- **Baseline Computation**: Test aggregation logic
- **Alert Generation**: Test threshold and severity logic

### Property-Based Tests (using fast-check)
- **Property 1**: Valid ingestion produces stored event
- **Property 4**: Normalization round-trip
- **Property 7**: Risk score range invariant
- **Property 9**: Scoring determinism
- **Property 12**: Alert severity mapping

### Integration Tests
- **Ingest → Alert Flow**: Send events via API, verify alert generated
- **Rule Configuration**: Change rule, verify scoring changes
- **Retention Cleanup**: Create old events, run cleanup, verify deletion

### Test Configuration
- Property tests: minimum 100 iterations
- Each property test tagged with: **Feature: insider-risk-monitor, Property N: {description}**
