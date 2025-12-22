# Requirements Document

## Introduction

Insider Risk Monitor is an internal security MVP that ingests security-relevant logs, normalizes events into a common schema, computes explainable risk scores using rule-based behavioral anomaly detection, and surfaces alerts in a triage-focused dashboard. This is NOT employee surveillance - it uses only existing security telemetry with full explainability and privacy controls.

## Glossary

- **Event**: A normalized security log entry representing an action by an actor
- **Actor**: An entity (employee or service) that performs actions in the system
- **Source**: An origin system that sends security telemetry (VPN, IAM, app logs, etc.)
- **Baseline**: Rolling statistical profile of an actor's normal behavior patterns
- **Risk_Score**: A 0-100 numeric value indicating anomaly severity with rule contributions
- **Alert**: A notification generated when an actor's risk score exceeds a threshold
- **Rule**: A configurable scoring component that evaluates specific behavioral patterns
- **Ingestion_API**: HTTP endpoint that receives and normalizes raw security events
- **Source_Key**: API key authenticating a specific event source

## Requirements

### Requirement 1: Event Ingestion API

**User Story:** As a security engineer, I want to send security logs from various sources via HTTP API, so that events are captured and normalized for analysis.

#### Acceptance Criteria

1. WHEN a POST request is sent to `/api/ingest/{sourceKey}` with valid `x-api-key` header, THE Ingestion_API SHALL accept the JSON payload and return 202 Accepted
2. WHEN a request lacks a valid `x-api-key` header, THE Ingestion_API SHALL return 401 Unauthorized
3. WHEN a request exceeds the rate limit for a source, THE Ingestion_API SHALL return 429 Too Many Requests
4. WHEN a valid event payload is received, THE Ingestion_API SHALL normalize it to the common Event schema and persist it
5. WHEN an invalid JSON payload is received, THE Ingestion_API SHALL return 400 Bad Request with validation errors
6. THE Ingestion_API SHALL store API keys in hashed form

### Requirement 2: Event Normalization

**User Story:** As a security analyst, I want all events normalized to a common schema, so that I can analyze behavior consistently across sources.

#### Acceptance Criteria

1. WHEN a raw event is ingested, THE Normalization_Engine SHALL map it to the common Event schema with: id, occurredAt, ingestedAt, actorId, actorType, source, actionType, resourceType, resourceId, outcome, ip, userAgent, bytes, metadata
2. WHEN resourceId redaction is enabled for a source, THE Normalization_Engine SHALL hash the resourceId before storage
3. WHEN optional fields (ip, userAgent, bytes) are missing, THE Normalization_Engine SHALL store null values
4. THE Normalization_Engine SHALL preserve raw fields in metadata JSONB with minimal retention
5. FOR ALL valid raw events, normalizing then serializing SHALL produce a valid Event record (round-trip property)

### Requirement 3: Baseline Computation

**User Story:** As a security analyst, I want the system to compute behavioral baselines per actor, so that anomalies can be detected relative to normal patterns.

#### Acceptance Criteria

1. THE Baseline_Engine SHALL compute rolling 14-day (configurable) baselines per actor
2. THE Baseline_Engine SHALL track: typical active hours, normal IP addresses, normal devices, average bytes transferred, typical resource scope, normal failure rate
3. WHEN a new actor is seen, THE Baseline_Engine SHALL use system-wide defaults until sufficient data exists
4. THE Baseline_Engine SHALL run on a configurable schedule (default: every 5 minutes)
5. FOR ALL actors with events, THE Baseline_Engine SHALL produce a valid Baseline record

### Requirement 4: Risk Scoring Engine

**User Story:** As a security analyst, I want explainable risk scores with rule contributions, so that I understand why an actor was flagged.

#### Acceptance Criteria

1. THE Scoring_Engine SHALL compute a risk score 0-100 for each actor based on recent events
2. THE Scoring_Engine SHALL evaluate these rules: off-hours activity, new IP/device, volume spike, resource scope expansion, failure burst
3. WHEN computing a score, THE Scoring_Engine SHALL include rule contributions (e.g., "New IP +15, Off-hours +10")
4. WHEN computing a score, THE Scoring_Engine SHALL include baseline values used for comparison
5. THE Scoring_Engine SHALL allow rules to be enabled/disabled and thresholds/weights configured
6. FOR ALL scoring runs, THE Scoring_Engine SHALL produce deterministic results given the same inputs

### Requirement 5: Alert Generation

**User Story:** As a security analyst, I want alerts generated when risk scores exceed thresholds, so that I can triage potential incidents.

#### Acceptance Criteria

1. WHEN an actor's risk score exceeds the threshold (default: 60), THE Alerting_System SHALL create an Alert
2. THE Alert SHALL include: actor, score, rule contributions, baseline comparisons, triggering events
3. THE Alerting_System SHALL deduplicate alerts for the same actor within a configurable window
4. WHEN an alert is created, THE Alerting_System SHALL assign severity based on score ranges
5. THE Alerting_System SHALL support alert status: open, acknowledged, resolved, false_positive

### Requirement 6: Dashboard - Overview

**User Story:** As a security analyst, I want an overview dashboard, so that I can quickly assess the current risk landscape.

#### Acceptance Criteria

1. WHEN visiting the overview page, THE Dashboard SHALL display count of alerts today
2. WHEN visiting the overview page, THE Dashboard SHALL display list of high-risk actors
3. WHEN visiting the overview page, THE Dashboard SHALL display a simple trend visualization
4. THE Dashboard SHALL update data on page load without requiring manual refresh

### Requirement 7: Dashboard - Alerts List

**User Story:** As a security analyst, I want to browse and filter alerts, so that I can prioritize my triage work.

#### Acceptance Criteria

1. THE Alerts_Page SHALL display a paginated list of alerts
2. THE Alerts_Page SHALL support filtering by: severity, source, date range, status
3. THE Alerts_Page SHALL display: actor, score, severity, timestamp, status for each alert
4. WHEN clicking an alert, THE Dashboard SHALL navigate to the alert detail page

### Requirement 8: Dashboard - Alert Detail

**User Story:** As a security analyst, I want to see full alert context, so that I can make informed triage decisions.

#### Acceptance Criteria

1. THE Alert_Detail_Page SHALL display the risk score breakdown with rule contributions
2. THE Alert_Detail_Page SHALL display baseline values compared to current behavior
3. THE Alert_Detail_Page SHALL display the triggering events as evidence
4. THE Alert_Detail_Page SHALL allow changing alert status (acknowledge, resolve, mark false positive)

### Requirement 9: Dashboard - Actors

**User Story:** As a security analyst, I want to view actor profiles and history, so that I can understand behavioral patterns over time.

#### Acceptance Criteria

1. THE Actors_Page SHALL display a list of actors with their current risk level
2. THE Actor_Detail_Page SHALL display a timeline of events for the actor
3. THE Actor_Detail_Page SHALL display risk score history
4. THE Actor_Detail_Page SHALL display current baseline values

### Requirement 10: Dashboard - Rules Configuration

**User Story:** As a security admin, I want to configure scoring rules, so that I can tune detection to my environment.

#### Acceptance Criteria

1. THE Rules_Page SHALL display all available scoring rules
2. THE Rules_Page SHALL allow enabling/disabling individual rules
3. THE Rules_Page SHALL allow setting thresholds and weights for each rule
4. THE Rules_Page SHALL allow configuring time windows (e.g., baseline period)
5. WHEN rules are modified, THE System SHALL log the change in an audit log
6. WHEN rules are modified, THE Scoring_Engine SHALL use new settings on next run

### Requirement 11: Dashboard - Sources Management

**User Story:** As a security admin, I want to manage event sources, so that I can control what data enters the system.

#### Acceptance Criteria

1. THE Sources_Page SHALL display all configured sources with status
2. THE Sources_Page SHALL allow creating new sources with API key generation
3. THE Sources_Page SHALL allow rotating API keys for existing sources
4. THE Sources_Page SHALL allow configuring redaction settings per source
5. THE Sources_Page SHALL allow configuring retention period per source
6. WHEN a source is created or modified, THE System SHALL log the change in an audit log

### Requirement 12: Data Retention

**User Story:** As a security admin, I want configurable data retention, so that I can comply with data minimization requirements.

#### Acceptance Criteria

1. THE Retention_System SHALL support configurable retention periods (30/90/180 days)
2. THE Retention_System SHALL run a daily cleanup job to delete expired events
3. WHEN events are deleted, THE Retention_System SHALL preserve aggregated baseline data
4. THE Retention_System SHALL respect per-source retention overrides

### Requirement 13: Authentication

**User Story:** As a security admin, I want secure access to the dashboard, so that only authorized users can view sensitive data.

#### Acceptance Criteria

1. THE Auth_System SHALL require login to access all dashboard pages
2. THE Auth_System SHALL support credentials-based authentication for MVP
3. THE Auth_System SHALL provide a default admin account configurable via environment
4. WHEN login fails, THE Auth_System SHALL return appropriate error without leaking information

### Requirement 14: Deployment

**User Story:** As a developer, I want single-command deployment, so that I can quickly run the system locally.

#### Acceptance Criteria

1. WHEN running `docker compose up`, THE System SHALL start all required services
2. THE System SHALL automatically run database migrations on startup
3. THE System SHALL include seed data demonstrating normal and anomalous behavior
4. THE System SHALL generate at least 2 alerts from seed data
5. THE README SHALL document setup, ingestion examples, and demo workflow

### Requirement 15: Audit Logging

**User Story:** As a security admin, I want audit logs of configuration changes, so that I can track who changed what.

#### Acceptance Criteria

1. WHEN admin changes rules, thresholds, or sources, THE Audit_System SHALL record the change
2. THE Audit_Log SHALL include: timestamp, user, action, before/after values
3. THE Audit_Log SHALL be viewable in the dashboard
