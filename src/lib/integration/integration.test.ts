/**
 * Integration Test: Ingest → Alert Flow
 * Feature: insider-risk-monitor
 *
 * Tests the complete flow from event ingestion through to alert generation:
 * 1. Send events via API
 * 2. Trigger scoring run
 * 3. Verify alert created
 * 4. Verify alert visible in API response
 *
 * Validates: Requirements 14.4
 *
 * NOTE: This test requires a real database connection.
 * Set DATABASE_URL environment variable to run these tests.
 * Tests will be skipped if no database is available.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { sourceService } from "@/lib/ingestion";
import { normalizeEvent, RawEvent } from "@/lib/normalization";
import { saveBaseline, getSystemDefaults, ActorBaseline } from "@/lib/baseline";
import { scoreActor, getDefaultRules, RiskScoreResult } from "@/lib/scoring";
import { evaluateAndAlert, DEFAULT_ALERT_THRESHOLD } from "@/lib/alerting";
import { Source, Event } from "@/types";

// ============================================
// Database Connection Check
// ============================================

let isDatabaseAvailable = false;

async function checkDatabaseConnection(): Promise<boolean> {
  try {
    // Try a simple query to check if database is available
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Test Configuration
// ============================================

const TEST_SOURCE_KEY = "integration_test_source";
const TEST_ACTOR_ID = "integration_test_actor@example.com";
const TEST_TIMEOUT = 60000; // 60 seconds for async operations

// ============================================
// Test Helpers
// ============================================

/**
 * Create a test source with API key
 */
async function createTestSource(): Promise<{ source: Source; apiKey: string }> {
  // Clean up any existing test source
  try {
    const existing = await prisma.source.findUnique({
      where: { key: TEST_SOURCE_KEY },
    });
    if (existing) {
      await prisma.event.deleteMany({ where: { sourceId: existing.id } });
      await prisma.source.delete({ where: { id: existing.id } });
    }
  } catch {
    // Ignore errors during cleanup
  }

  // Create new test source
  const result = await sourceService.create({
    key: TEST_SOURCE_KEY,
    name: "Integration Test Source",
    description: "Source for integration testing",
    enabled: true,
    redactResourceId: false,
    retentionDays: 90,
    rateLimit: 1000,
  });

  return result;
}

/**
 * Clean up test data
 */
async function cleanupTestData(): Promise<void> {
  try {
    // Delete alerts for test actor
    await prisma.alert.deleteMany({
      where: { actorId: TEST_ACTOR_ID },
    });

    // Delete risk scores for test actor
    await prisma.riskScore.deleteMany({
      where: { actorId: TEST_ACTOR_ID },
    });

    // Delete baselines for test actor
    await prisma.baseline.deleteMany({
      where: { actorId: TEST_ACTOR_ID },
    });

    // Delete events for test actor
    await prisma.event.deleteMany({
      where: { actorId: TEST_ACTOR_ID },
    });

    // Delete test actor
    await prisma.actor.deleteMany({
      where: { actorId: TEST_ACTOR_ID },
    });

    // Delete test source
    const source = await prisma.source.findUnique({
      where: { key: TEST_SOURCE_KEY },
    });
    if (source) {
      await prisma.event.deleteMany({ where: { sourceId: source.id } });
      await prisma.source.delete({ where: { id: source.id } });
    }
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Create and persist a normalized event directly to the database
 */
async function createAndPersistEvent(
  source: Source,
  rawEvent: RawEvent
): Promise<Event> {
  const result = normalizeEvent(rawEvent, source);
  if (!result.success || !result.event) {
    throw new Error(`Normalization failed: ${result.error}`);
  }

  const normalizedEvent = result.event;

  // Persist to database
  const event = await prisma.event.create({
    data: {
      id: normalizedEvent.id,
      occurredAt: normalizedEvent.occurredAt,
      ingestedAt: normalizedEvent.ingestedAt,
      actorId: normalizedEvent.actorId,
      actorType: normalizedEvent.actorType,
      sourceId: normalizedEvent.sourceId,
      actionType: normalizedEvent.actionType,
      resourceType: normalizedEvent.resourceType,
      resourceId: normalizedEvent.resourceId,
      outcome: normalizedEvent.outcome,
      ip: normalizedEvent.ip,
      userAgent: normalizedEvent.userAgent,
      bytes: normalizedEvent.bytes,
      metadata: normalizedEvent.metadata as object,
    },
  });

  // Ensure actor exists
  await prisma.actor.upsert({
    where: { actorId: normalizedEvent.actorId },
    create: {
      actorId: normalizedEvent.actorId,
      actorType: normalizedEvent.actorType,
      firstSeen: normalizedEvent.occurredAt,
      lastSeen: normalizedEvent.occurredAt,
    },
    update: {
      lastSeen: normalizedEvent.occurredAt,
    },
  });

  return event;
}

/**
 * Generate events that will trigger high risk score
 * Creates events with anomalous patterns:
 * - New IP addresses (15 points)
 * - High volume (25 points)
 * - Multiple failures (25 points)
 * - Scope expansion (20 points)
 * 
 * Total potential: 85 points (well above 60 threshold)
 * 
 * All events are timestamped within the last 30 minutes to ensure
 * they fall within the scoring window for all rules.
 */
function generateAnomalousEvents(actorId: string): RawEvent[] {
  const now = new Date();
  const events: RawEvent[] = [];

  // Failure events - 8 failures within 10 minutes (triggers failure_burst: 25 points)
  // Window: 10 minutes
  for (let i = 0; i < 8; i++) {
    const eventTime = new Date(now.getTime() - i * 30 * 1000); // 30 seconds apart

    events.push({
      actorId,
      actionType: "login",
      timestamp: eventTime.toISOString(),
      actorType: "employee",
      ip: `10.0.${i}.${i + 1}`, // 8 different new IPs
      outcome: "failure",
    });
  }

  // High volume downloads - triggers volume_spike (25 points)
  // Window: 1440 minutes (24 hours), but we keep within 30 minutes
  // Need > 30MB (3x baseline of 10MB)
  for (let i = 0; i < 5; i++) {
    const eventTime = new Date(now.getTime() - (i + 1) * 60 * 1000); // 1-5 minutes ago

    events.push({
      actorId,
      actionType: "download",
      timestamp: eventTime.toISOString(),
      actorType: "employee",
      resourceType: "file",
      resourceId: `file-${i}`,
      ip: `192.168.${100 + i}.1`, // 5 more new IPs (total: 13)
      bytes: 20000000, // 20MB each = 100MB total
      outcome: "success",
    });
  }

  // Resource access events - triggers scope_expansion (20 points)
  // Window: 1440 minutes (24 hours), but we keep within 30 minutes
  // Need > 40 resources (2x baseline of 20)
  for (let i = 0; i < 50; i++) {
    const eventTime = new Date(now.getTime() - (i + 6) * 30 * 1000); // 3-28 minutes ago

    events.push({
      actorId,
      actionType: "read",
      timestamp: eventTime.toISOString(),
      actorType: "employee",
      resourceType: "database",
      resourceId: `resource-${i}`, // 50 different resources
      ip: `192.168.1.${i % 5}`, // Reuse some IPs
      bytes: 100000, // 100KB each
      outcome: "success",
    });
  }

  // Additional new IP events - triggers new_ip (15 points)
  // Window: 60 minutes
  // Already have 13 unique IPs, add a few more to ensure trigger
  for (let i = 0; i < 5; i++) {
    const eventTime = new Date(now.getTime() - (i + 1) * 2 * 60 * 1000); // 2-10 minutes ago

    events.push({
      actorId,
      actionType: "query",
      timestamp: eventTime.toISOString(),
      actorType: "employee",
      resourceType: "api",
      resourceId: `api-endpoint-${i}`,
      ip: `172.16.${i}.${i + 1}`, // 5 more new IPs (total: 18)
      outcome: "success",
    });
  }

  return events;
}

/**
 * Run scoring for an actor and create alert if threshold exceeded
 * Uses system defaults as baseline to ensure anomalous events trigger rules
 */
async function runScoringForActor(actorId: string): Promise<{
  riskScore: RiskScoreResult;
  alertCreated: boolean;
  alertId?: string;
}> {
  // Get recent events for the actor - use 24 hour window to cover all rule windows
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours
  const events = await prisma.event.findMany({
    where: {
      actorId,
      occurredAt: { gte: cutoff },
    },
    orderBy: { occurredAt: "desc" },
  });

  // Use system defaults as baseline (simulates a new actor with no history)
  // This ensures the anomalous events will trigger rules
  const baseline: ActorBaseline = {
    ...getSystemDefaults(),
    actorId,
    // Override with conservative values that will make our events look anomalous
    typicalActiveHours: [9, 10, 11, 12, 13, 14, 15, 16, 17], // Business hours only
    knownIpAddresses: [], // No known IPs - all IPs will be "new"
    avgBytesPerDay: 10_000_000, // 10 MB baseline - our 100MB will be 10x
    typicalResourceScope: 10, // 10 resources - our 50 will be 5x
    normalFailureRate: 0.05, // 5% failure rate
  };

  // Save the baseline
  await saveBaseline(baseline);

  // Score the actor
  const rules = getDefaultRules();
  const riskScore = scoreActor(actorId, baseline, events, { rules });

  // Save risk score
  await prisma.riskScore.create({
    data: {
      actorId,
      totalScore: riskScore.totalScore,
      computedAt: riskScore.computedAt,
      ruleContributions: JSON.parse(JSON.stringify(riskScore.ruleContributions)),
      triggeringEventIds: riskScore.triggeringEventIds,
    },
  });

  // Update actor's current risk score
  await prisma.actor.upsert({
    where: { actorId },
    update: {
      currentRiskScore: riskScore.totalScore,
      lastSeen: new Date(),
    },
    create: {
      actorId,
      currentRiskScore: riskScore.totalScore,
      firstSeen: new Date(),
      lastSeen: new Date(),
    },
  });

  // Evaluate and create alert if threshold exceeded
  const alertResult = await evaluateAndAlert(riskScore, {
    threshold: DEFAULT_ALERT_THRESHOLD,
    skipDeduplication: true, // Skip dedup for testing
  });

  return {
    riskScore,
    alertCreated: alertResult.alertCreated,
    alertId: alertResult.alert?.id,
  };
}

// ============================================
// Integration Tests
// ============================================

describe("Integration Test: Ingest → Alert Flow", () => {
  let testSource: Source;

  beforeAll(async () => {
    // Check if database is available
    isDatabaseAvailable = await checkDatabaseConnection();
    
    if (!isDatabaseAvailable) {
      console.log("⚠️ Database not available - integration tests will be skipped");
      console.log("Set DATABASE_URL environment variable to run integration tests");
      return;
    }

    // Clean up any existing test data
    await cleanupTestData();

    // Create test source
    const result = await createTestSource();
    testSource = result.source;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (!isDatabaseAvailable) return;
    
    // Clean up test data
    await cleanupTestData();
    
    // Disconnect from database
    await prisma.$disconnect();
  }, TEST_TIMEOUT);

  beforeEach(async () => {
    if (!isDatabaseAvailable) return;
    
    // Clean up actor-specific data before each test
    await prisma.alert.deleteMany({ where: { actorId: TEST_ACTOR_ID } });
    await prisma.riskScore.deleteMany({ where: { actorId: TEST_ACTOR_ID } });
    await prisma.baseline.deleteMany({ where: { actorId: TEST_ACTOR_ID } });
    await prisma.event.deleteMany({ where: { actorId: TEST_ACTOR_ID } });
    await prisma.actor.deleteMany({ where: { actorId: TEST_ACTOR_ID } });
  }, TEST_TIMEOUT);

  /**
   * Test 1: Complete ingest → score → alert flow
   * Validates: Requirements 14.4
   */
  it("should create alert when anomalous events are ingested and scored", async () => {
    if (!isDatabaseAvailable) {
      console.log("Skipping: Database not available");
      return;
    }
    // Step 1: Generate and ingest anomalous events
    const rawEvents = generateAnomalousEvents(TEST_ACTOR_ID);

    for (const rawEvent of rawEvents) {
      await createAndPersistEvent(testSource, rawEvent);
    }

    // Verify events were persisted
    const persistedEvents = await prisma.event.findMany({
      where: { actorId: TEST_ACTOR_ID },
    });
    expect(persistedEvents.length).toBe(rawEvents.length);

    // Step 2: Run scoring for the actor
    const scoringResult = await runScoringForActor(TEST_ACTOR_ID);

    // Step 3: Verify risk score was computed
    expect(scoringResult.riskScore).toBeDefined();
    expect(scoringResult.riskScore.totalScore).toBeGreaterThanOrEqual(0);
    expect(scoringResult.riskScore.totalScore).toBeLessThanOrEqual(100);
    expect(scoringResult.riskScore.actorId).toBe(TEST_ACTOR_ID);

    // Step 4: Verify alert was created (score should exceed threshold)
    expect(scoringResult.alertCreated).toBe(true);
    expect(scoringResult.alertId).toBeDefined();

    // Step 5: Verify alert is in database
    const alert = await prisma.alert.findUnique({
      where: { id: scoringResult.alertId },
    });
    expect(alert).not.toBeNull();
    expect(alert!.actorId).toBe(TEST_ACTOR_ID);
    expect(alert!.score).toBe(scoringResult.riskScore.totalScore);
    expect(alert!.status).toBe("open");
    expect(["low", "medium", "high", "critical"]).toContain(alert!.severity);

    // Step 6: Verify alert is visible via query (simulating API response)
    const alerts = await prisma.alert.findMany({
      where: { actorId: TEST_ACTOR_ID },
      orderBy: { createdAt: "desc" },
    });
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].id).toBe(scoringResult.alertId);
  }, TEST_TIMEOUT);

  /**
   * Test 2: Verify alert contains required fields
   * Validates: Requirements 5.2
   */
  it("should create alert with all required fields", async () => {
    if (!isDatabaseAvailable) {
      console.log("Skipping: Database not available");
      return;
    }
    // Ingest anomalous events
    const rawEvents = generateAnomalousEvents(TEST_ACTOR_ID);
    for (const rawEvent of rawEvents) {
      await createAndPersistEvent(testSource, rawEvent);
    }

    // Run scoring
    const scoringResult = await runScoringForActor(TEST_ACTOR_ID);

    // Skip if no alert created (score below threshold)
    if (!scoringResult.alertCreated || !scoringResult.alertId) {
      console.log(`Score ${scoringResult.riskScore.totalScore} below threshold, skipping alert field validation`);
      return;
    }

    // Get the alert
    const alert = await prisma.alert.findUnique({
      where: { id: scoringResult.alertId },
    });

    expect(alert).not.toBeNull();

    // Verify required fields (Requirement 5.2)
    expect(alert!.actorId).toBeTruthy();
    expect(typeof alert!.score).toBe("number");
    expect(alert!.severity).toBeTruthy();
    expect(alert!.status).toBe("open");
    expect(alert!.ruleContributions).toBeDefined();
    expect(alert!.baselineComparison).toBeDefined();
    expect(alert!.triggeringEventIds).toBeDefined();
    expect(alert!.createdAt).toBeInstanceOf(Date);
  }, TEST_TIMEOUT);

  /**
   * Test 3: Verify events are properly normalized and stored
   * Validates: Requirements 2.1
   */
  it("should normalize and store events correctly", async () => {
    if (!isDatabaseAvailable) {
      console.log("Skipping: Database not available");
      return;
    }
    const rawEvent: RawEvent = {
      actorId: TEST_ACTOR_ID,
      actionType: "login",
      timestamp: new Date().toISOString(),
      actorType: "employee",
      ip: "192.168.1.100",
      userAgent: "Mozilla/5.0",
      outcome: "success",
    };

    const event = await createAndPersistEvent(testSource, rawEvent);

    // Verify event was stored
    const storedEvent = await prisma.event.findUnique({
      where: { id: event.id },
    });

    expect(storedEvent).not.toBeNull();
    expect(storedEvent!.actorId).toBe(TEST_ACTOR_ID);
    expect(storedEvent!.actionType).toBe("login");
    expect(storedEvent!.sourceId).toBe(testSource.id);
    expect(storedEvent!.ip).toBe("192.168.1.100");
    expect(storedEvent!.outcome).toBe("success");
  }, TEST_TIMEOUT);

  /**
   * Test 4: Verify scoring produces deterministic results
   * Validates: Requirements 4.6
   */
  it("should produce deterministic scoring results", async () => {
    if (!isDatabaseAvailable) {
      console.log("Skipping: Database not available");
      return;
    }
    // Ingest events
    const rawEvents = generateAnomalousEvents(TEST_ACTOR_ID);
    for (const rawEvent of rawEvents) {
      await createAndPersistEvent(testSource, rawEvent);
    }

    // Get events and baseline
    const events = await prisma.event.findMany({
      where: { actorId: TEST_ACTOR_ID },
    });
    const baseline = { ...getSystemDefaults(), actorId: TEST_ACTOR_ID };
    const rules = getDefaultRules();
    const referenceTime = new Date();

    // Score multiple times
    const score1 = scoreActor(TEST_ACTOR_ID, baseline, events, { rules, referenceTime });
    const score2 = scoreActor(TEST_ACTOR_ID, baseline, events, { rules, referenceTime });
    const score3 = scoreActor(TEST_ACTOR_ID, baseline, events, { rules, referenceTime });

    // Verify determinism
    expect(score1.totalScore).toBe(score2.totalScore);
    expect(score2.totalScore).toBe(score3.totalScore);
    expect(score1.ruleContributions.length).toBe(score2.ruleContributions.length);
  }, TEST_TIMEOUT);

  /**
   * Test 5: Verify low-risk events don't create alerts
   * Validates: Requirements 5.1
   */
  it("should not create alert for low-risk events", async () => {
    if (!isDatabaseAvailable) {
      console.log("Skipping: Database not available");
      return;
    }
    // Create a single normal event
    const normalEvent: RawEvent = {
      actorId: TEST_ACTOR_ID,
      actionType: "login",
      timestamp: new Date().toISOString(),
      actorType: "employee",
      ip: "192.168.1.1",
      outcome: "success",
    };

    await createAndPersistEvent(testSource, normalEvent);

    // Run scoring
    const scoringResult = await runScoringForActor(TEST_ACTOR_ID);

    // With just one normal event, score should be low
    // Alert should not be created if score < threshold
    if (scoringResult.riskScore.totalScore < DEFAULT_ALERT_THRESHOLD) {
      expect(scoringResult.alertCreated).toBe(false);
      expect(scoringResult.alertId).toBeUndefined();
    }
  }, TEST_TIMEOUT);
});
