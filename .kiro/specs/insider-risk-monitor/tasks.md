# Implementation Plan: Insider Risk Monitor

## Overview

This plan implements the Insider Risk Monitor MVP in incremental steps, building from project setup through to a fully functional system with seed data and Docker deployment. Each task builds on previous work, ensuring no orphaned code.

## Tasks

- [x] 1. Project Setup and Infrastructure
  - [x] 1.1 Initialize Next.js project with TypeScript and App Router
    - Run `npx create-next-app@latest` with TypeScript, Tailwind, App Router
    - Configure tsconfig.json for strict mode
    - _Requirements: 14.1_

  - [x] 1.2 Set up Prisma with Neon PostgreSQL
    - Install prisma and @prisma/client
    - Configure prisma/schema.prisma with Neon connection
    - Create all database models (Source, Event, Actor, Baseline, RiskScore, Alert, ScoringRule, SystemSetting, AuditLog, User)
    - Run initial migration
    - _Requirements: 2.1, 14.2_

  - [x] 1.3 Set up shadcn/ui and Tailwind
    - Initialize shadcn/ui with default config
    - Add core components: Button, Card, Table, Input, Select, Badge, Dialog, Tabs
    - _Requirements: 6.1_

  - [x] 1.4 Set up authentication with NextAuth
    - Install next-auth
    - Configure credentials provider
    - Create login page and auth middleware
    - Seed default admin user
    - _Requirements: 13.1, 13.2, 13.3_

- [x] 2. Core Business Logic - Ingestion
  - [x] 2.1 Implement Source management
    - Create Source service with CRUD operations
    - Implement API key generation and hashing (bcrypt)
    - Create rate limiting logic (in-memory for MVP)
    - _Requirements: 1.6, 11.2, 11.3_

  - [x] 2.2 Implement Normalization Engine
    - Create normalizeEvent function mapping raw → Event schema
    - Handle optional fields (ip, userAgent, bytes)
    - Implement resourceId hashing for redaction
    - Preserve raw fields in metadata JSONB
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 2.3 Write property test for Normalization round-trip
    - **Property 4: Normalization Round-Trip**
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.5**

  - [x] 2.4 Implement Ingestion API endpoint
    - Create POST /api/ingest/[sourceKey]/route.ts
    - Validate API key from x-api-key header
    - Check rate limit
    - Validate payload with Zod
    - Normalize and persist event
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 2.5 Write property tests for Ingestion
    - **Property 1: Valid Ingestion Produces Stored Event**
    - **Property 2: Invalid Authentication Rejects Request**
    - **Property 3: Invalid Payload Returns Validation Error**
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.5**

- [x] 3. Checkpoint - Ingestion Working
  - Ensure ingestion API accepts events and stores them
  - Test with curl command
  - Ask the user if questions arise

- [ ] 4. Core Business Logic - Baselines and Scoring
  - [x] 4.1 Implement Baseline Engine
    - Create computeBaseline function for single actor
    - Compute: typical hours, known IPs, avg bytes, resource scope, failure rate
    - Create computeAllBaselines for batch processing
    - Implement system defaults for new actors
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

  - [x] 4.2 Write property test for Baseline computation
    - **Property 6: Baseline Computation Produces Valid Record**
    - **Validates: Requirements 3.1, 3.2, 3.5**

  - [x] 4.3 Implement Scoring Rules
    - Create rule evaluators for each rule:
      - off_hours: Compare event hours to baseline typical hours
      - new_ip: Check if IP is in known IPs list
      - volume_spike: Compare bytes to avgBytesPerDay * threshold
      - scope_expansion: Compare distinct resources to baseline scope
      - failure_burst: Count failures in time window
    - Each rule returns RuleContribution with points and reason
    - _Requirements: 4.2_

  - [x] 4.4 Implement Scoring Engine
    - Create scoreActor function combining all rules
    - Sum rule contributions, cap at 100
    - Include baseline values in output
    - Track triggering event IDs
    - _Requirements: 4.1, 4.3, 4.4_

  - [x] 4.5 Write property tests for Scoring
    - **Property 7: Risk Score Range Invariant**
    - **Property 8: Score Includes Rule Contributions**
    - **Property 9: Scoring Determinism**
    - **Validates: Requirements 4.1, 4.3, 4.4, 4.6**

- [ ] 5. Core Business Logic - Alerting
  - [ ] 5.1 Implement Alert Generation
    - Create evaluateAndAlert function
    - Check score against threshold
    - Assign severity based on score ranges
    - Create Alert with all required fields
    - _Requirements: 5.1, 5.2, 5.4_

  - [ ] 5.2 Implement Alert Deduplication
    - Check for existing open alert for actor within window
    - Skip creation if duplicate found
    - _Requirements: 5.3_

  - [ ] 5.3 Write property tests for Alerting
    - **Property 10: Alert Generation Threshold**
    - **Property 11: Alert Completeness**
    - **Property 12: Alert Severity Mapping**
    - **Property 13: Alert Deduplication**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [ ] 6. Checkpoint - Scoring Pipeline Working
  - Ensure baseline → scoring → alerting flow works
  - Manually test with sample data
  - Ask the user if questions arise

- [ ] 7. Background Worker
  - [ ] 7.1 Implement Worker Process
    - Create worker/index.ts with interval-based scheduler
    - Schedule baseline computation (every 5 minutes)
    - Schedule scoring run (every 5 minutes)
    - Schedule retention cleanup (daily)
    - _Requirements: 3.4, 12.2_

  - [ ] 7.2 Implement Retention Cleanup
    - Delete events older than retention period
    - Respect per-source retention overrides
    - Preserve baseline records
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [ ] 7.3 Write property test for Retention
    - **Property 14: Retention Cleanup Preserves Baselines**
    - **Validates: Requirements 12.2, 12.3**

- [ ] 8. Dashboard - Layout and Overview
  - [ ] 8.1 Create Dashboard Layout
    - Create app/(dashboard)/layout.tsx with sidebar navigation
    - Add navigation links: Overview, Alerts, Actors, Rules, Sources, Audit
    - Add user menu with logout
    - _Requirements: 6.1_

  - [ ] 8.2 Implement Overview Page
    - Create app/(dashboard)/page.tsx
    - Display alerts count today
    - Display high-risk actors list
    - Display simple trend chart (alerts per day, last 7 days)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 9. Dashboard - Alerts Pages
  - [ ] 9.1 Implement Alerts List Page
    - Create app/(dashboard)/alerts/page.tsx
    - Paginated table with: actor, score, severity, timestamp, status
    - Filters: severity, source, date range, status
    - Click to navigate to detail
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ] 9.2 Implement Alert Detail Page
    - Create app/(dashboard)/alerts/[id]/page.tsx
    - Display score breakdown with rule contributions
    - Display baseline comparison table
    - Display triggering events list
    - Status change buttons (acknowledge, resolve, false positive)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 10. Dashboard - Actors Pages
  - [ ] 10.1 Implement Actors List Page
    - Create app/(dashboard)/actors/page.tsx
    - Table with: actorId, type, current risk score, last seen
    - Sort by risk score
    - _Requirements: 9.1_

  - [ ] 10.2 Implement Actor Detail Page
    - Create app/(dashboard)/actors/[id]/page.tsx
    - Event timeline (recent events)
    - Risk score history chart
    - Current baseline values display
    - _Requirements: 9.2, 9.3, 9.4_

- [ ] 11. Dashboard - Admin Pages
  - [ ] 11.1 Implement Rules Configuration Page
    - Create app/(dashboard)/rules/page.tsx
    - List all rules with enable/disable toggle
    - Edit threshold and weight for each rule
    - Save changes and log to audit
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ] 11.2 Implement Sources Management Page
    - Create app/(dashboard)/sources/page.tsx
    - List sources with status
    - Create new source with API key generation
    - Rotate API key button
    - Configure redaction and retention per source
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ] 11.3 Implement Audit Log Page
    - Create app/(dashboard)/audit/page.tsx
    - Display audit log entries with filters
    - Show: timestamp, user, action, entity, changes
    - _Requirements: 15.3_

  - [ ] 11.4 Write property test for Audit Logging
    - **Property 15: Audit Log Completeness**
    - **Validates: Requirements 15.1, 15.2**

- [ ] 12. Checkpoint - Dashboard Complete
  - Ensure all pages render correctly
  - Test navigation and data display
  - Ask the user if questions arise

- [ ] 13. Seed Data and Demo
  - [ ] 13.1 Create Seed Script
    - Create prisma/seed.ts
    - Seed default scoring rules with weights
    - Seed 3 sources (vpn, iam, app)
    - Seed admin user
    - _Requirements: 14.3_

  - [ ] 13.2 Create Demo Data Generator
    - Create scripts/generate-demo-data.ts
    - Generate 3 actors with normal behavior patterns
    - Generate 1 anomalous actor triggering multiple rules
    - Ensure at least 2 alerts are generated
    - _Requirements: 14.3, 14.4_

- [ ] 14. Docker and Deployment
  - [ ] 14.1 Create Dockerfile
    - Multi-stage build for Next.js
    - Include Prisma client generation
    - _Requirements: 14.1_

  - [ ] 14.2 Create docker-compose.yml
    - Web service (Next.js app)
    - Worker service (background jobs)
    - Redis service (for rate limiting cache)
    - Configure environment variables
    - Auto-run migrations on startup
    - _Requirements: 14.1, 14.2_

  - [ ] 14.3 Create README with documentation
    - Setup instructions
    - Ingestion examples (curl commands)
    - Demo workflow steps
    - _Requirements: 14.5_

- [ ] 15. Integration Test
  - [ ] 15.1 Write integration test for ingest → alert flow
    - Send events via API
    - Trigger scoring run
    - Verify alert created
    - Verify alert visible in API response
    - _Requirements: 14.4_

- [ ] 16. Final Checkpoint
  - Run `docker compose up` and verify system starts
  - Run demo data generator
  - Verify at least 2 alerts visible in dashboard
  - Ensure all tests pass
  - Ask the user if questions arise

## Notes

- All tasks including property-based tests are required
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use fast-check library with minimum 100 iterations
- The worker uses simple interval-based scheduling (no Redis queue for MVP simplicity)
