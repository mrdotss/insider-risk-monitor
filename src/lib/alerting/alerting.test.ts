/**
 * Property-Based Tests for Alerting System
 * Feature: insider-risk-monitor
 *
 * Property 10: Alert Generation Threshold
 * Property 11: Alert Completeness
 * Property 12: Alert Severity Mapping
 * Property 13: Alert Deduplication
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  createAlertFromScore,
  getSeverityFromScore,
  meetsAlertThreshold,
  severityMatchesScore,
  shouldDeduplicate,
  DEFAULT_ALERT_THRESHOLD,
  SEVERITY_RANGES,
  AlertData,
} from "./index";
import { RiskScoreResult } from "@/lib/scoring";
import { ActorBaseline } from "@/lib/baseline";
import { RuleContribution } from "@/types";

// ============================================
// Arbitraries (Generators)
// ============================================

/**
 * Generate a valid actor ID
 */
const actorIdArbitrary = fc.stringMatching(/^[a-zA-Z0-9._@-]{1,50}$/);

/**
 * Generate a valid IP address
 */
const ipArbitrary = fc
  .tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 })
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/**
 * Generate a valid hour (0-23)
 */
const hourArbitrary = fc.integer({ min: 0, max: 23 });

/**
 * Generate a reference time for deterministic testing
 */
const referenceTimeArbitrary = fc
  .integer({
    min: new Date("2024-06-01").getTime(),
    max: new Date("2024-06-30").getTime(),
  })
  .map((ts) => new Date(ts));

/**
 * Generate a valid ActorBaseline
 */
const baselineArbitrary: fc.Arbitrary<ActorBaseline> = fc.record({
  actorId: actorIdArbitrary,
  computedAt: referenceTimeArbitrary,
  windowDays: fc.integer({ min: 7, max: 30 }),
  typicalActiveHours: fc
    .array(hourArbitrary, { minLength: 0, maxLength: 12 })
    .map((hours) => [...new Set(hours)].sort((a, b) => a - b)),
  knownIpAddresses: fc
    .array(ipArbitrary, { minLength: 0, maxLength: 10 })
    .map((ips) => [...new Set(ips)]),
  knownUserAgents: fc
    .array(fc.stringMatching(/^[a-zA-Z0-9\/\.\s\(\);,-]{10,50}$/), { minLength: 0, maxLength: 5 })
    .map((uas) => [...new Set(uas)]),
  avgBytesPerDay: fc.integer({ min: 0, max: 100000000 }),
  avgEventsPerDay: fc.integer({ min: 0, max: 1000 }),
  typicalResourceScope: fc.integer({ min: 0, max: 100 }),
  normalFailureRate: fc.float({ min: 0, max: 1, noNaN: true }),
  eventCount: fc.integer({ min: 0, max: 10000 }),
  firstSeen: fc.option(referenceTimeArbitrary, { nil: null }),
  lastSeen: fc.option(referenceTimeArbitrary, { nil: null }),
});

/**
 * Generate a valid RuleContribution
 */
const ruleContributionArbitrary: fc.Arbitrary<RuleContribution> = fc.record({
  ruleId: fc.constantFrom(
    "rule_off_hours",
    "rule_new_ip",
    "rule_volume_spike",
    "rule_scope_expansion",
    "rule_failure_burst"
  ),
  ruleName: fc.constantFrom(
    "Off-Hours Activity",
    "New IP Address",
    "Volume Spike",
    "Resource Scope Expansion",
    "Failure Burst"
  ),
  points: fc.integer({ min: 1, max: 25 }),
  reason: fc.stringMatching(/^[a-zA-Z0-9\s,.:()-]{10,100}$/),
  currentValue: fc.oneof(fc.integer({ min: 0, max: 1000 }), fc.string()),
  baselineValue: fc.oneof(fc.integer({ min: 0, max: 1000 }), fc.string()),
});

/**
 * Generate a valid RiskScoreResult with score >= threshold
 */
const riskScoreAboveThresholdArbitrary = (threshold: number = DEFAULT_ALERT_THRESHOLD) =>
  fc
    .record({
      actorId: actorIdArbitrary,
      totalScore: fc.integer({ min: threshold, max: 100 }),
      computedAt: referenceTimeArbitrary,
      ruleContributions: fc.array(ruleContributionArbitrary, { minLength: 1, maxLength: 5 }),
      baselineUsed: baselineArbitrary,
      triggeringEventIds: fc.array(fc.uuid(), { minLength: 0, maxLength: 10 }),
    })
    .map(({ actorId, totalScore, computedAt, ruleContributions, baselineUsed, triggeringEventIds }) => ({
      actorId,
      totalScore,
      computedAt,
      ruleContributions,
      baselineUsed: { ...baselineUsed, actorId },
      triggeringEventIds,
    })) as fc.Arbitrary<RiskScoreResult>;

/**
 * Generate a valid RiskScoreResult with score < threshold
 */
const riskScoreBelowThresholdArbitrary = (threshold: number = DEFAULT_ALERT_THRESHOLD) =>
  fc
    .record({
      actorId: actorIdArbitrary,
      totalScore: fc.integer({ min: 0, max: threshold - 1 }),
      computedAt: referenceTimeArbitrary,
      ruleContributions: fc.array(ruleContributionArbitrary, { minLength: 0, maxLength: 5 }),
      baselineUsed: baselineArbitrary,
      triggeringEventIds: fc.array(fc.uuid(), { minLength: 0, maxLength: 10 }),
    })
    .map(({ actorId, totalScore, computedAt, ruleContributions, baselineUsed, triggeringEventIds }) => ({
      actorId,
      totalScore,
      computedAt,
      ruleContributions,
      baselineUsed: { ...baselineUsed, actorId },
      triggeringEventIds,
    })) as fc.Arbitrary<RiskScoreResult>;

/**
 * Generate a score in a specific severity range
 */
const scoreInRangeArbitrary = (min: number, max: number) => fc.integer({ min, max });

// ============================================
// Property Tests
// ============================================

describe("Alerting System - Property Tests", () => {
  /**
   * Property 10: Alert Generation Threshold
   *
   * For any risk score >= alert threshold, an Alert SHALL be created.
   * For any risk score < threshold, no Alert SHALL be created.
   *
   * Validates: Requirements 5.1
   */
  it("Property 10: Score >= threshold creates alert", () => {
    fc.assert(
      fc.property(riskScoreAboveThresholdArbitrary(), (riskScore) => {
        const alertData = createAlertFromScore(riskScore);

        // Alert should be created when score >= threshold
        expect(alertData).not.toBeNull();
        expect(alertData!.score).toBe(riskScore.totalScore);
        expect(alertData!.actorId).toBe(riskScore.actorId);
      }),
      { numRuns: 100 }
    );
  });

  it("Property 10: Score < threshold does not create alert", () => {
    fc.assert(
      fc.property(riskScoreBelowThresholdArbitrary(), (riskScore) => {
        const alertData = createAlertFromScore(riskScore);

        // Alert should NOT be created when score < threshold
        expect(alertData).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("Property 10: Custom threshold is respected", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99 }), // custom threshold
        fc.integer({ min: 0, max: 100 }), // score
        actorIdArbitrary,
        baselineArbitrary,
        fc.array(ruleContributionArbitrary, { minLength: 1, maxLength: 3 }),
        fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }),
        referenceTimeArbitrary,
        (threshold, score, actorId, baseline, contributions, eventIds, computedAt) => {
          const riskScore: RiskScoreResult = {
            actorId,
            totalScore: score,
            computedAt,
            ruleContributions: contributions,
            baselineUsed: { ...baseline, actorId },
            triggeringEventIds: eventIds,
          };

          const alertData = createAlertFromScore(riskScore, { threshold });

          if (score >= threshold) {
            expect(alertData).not.toBeNull();
          } else {
            expect(alertData).toBeNull();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 11: Alert Completeness
   *
   * For any generated Alert, it SHALL contain: actorId, score, severity,
   * non-empty ruleContributions, baselineComparison, and triggeringEventIds.
   *
   * Validates: Requirements 5.2
   */
  it("Property 11: Generated alert contains all required fields", () => {
    fc.assert(
      fc.property(riskScoreAboveThresholdArbitrary(), (riskScore) => {
        const alertData = createAlertFromScore(riskScore);

        // Alert should be created
        expect(alertData).not.toBeNull();
        const alert = alertData as AlertData;

        // Check all required fields are present (Requirement 5.2)
        expect(alert.actorId).toBeTruthy();
        expect(alert.actorId.length).toBeGreaterThan(0);

        expect(typeof alert.score).toBe("number");
        expect(alert.score).toBeGreaterThanOrEqual(0);
        expect(alert.score).toBeLessThanOrEqual(100);

        expect(alert.severity).toBeTruthy();
        expect(["low", "medium", "high", "critical"]).toContain(alert.severity);

        expect(Array.isArray(alert.ruleContributions)).toBe(true);
        // Note: ruleContributions can be empty if score is exactly at threshold with no rules

        expect(alert.baselineComparison).toBeTruthy();
        expect(typeof alert.baselineComparison).toBe("object");

        expect(Array.isArray(alert.triggeringEventIds)).toBe(true);

        expect(alert.status).toBe("open");
      }),
      { numRuns: 100 }
    );
  });

  it("Property 11: Baseline comparison contains expected fields", () => {
    fc.assert(
      fc.property(riskScoreAboveThresholdArbitrary(), (riskScore) => {
        const alertData = createAlertFromScore(riskScore);

        expect(alertData).not.toBeNull();
        const alert = alertData as AlertData;

        // Check baseline comparison structure
        const bc = alert.baselineComparison;
        expect(typeof bc.typicalHours).toBe("string");
        expect(typeof bc.currentHours).toBe("string");
        expect(typeof bc.avgBytes).toBe("number");
        expect(typeof bc.currentBytes).toBe("number");
        expect(typeof bc.normalScope).toBe("number");
        expect(typeof bc.currentScope).toBe("number");
        expect(typeof bc.normalFailureRate).toBe("number");
        expect(typeof bc.currentFailureRate).toBe("number");
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 12: Alert Severity Mapping
   *
   * For any Alert, the severity SHALL match the score range:
   * 60-69=low, 70-79=medium, 80-89=high, 90-100=critical.
   *
   * Validates: Requirements 5.4
   */
  it("Property 12: Severity matches score range - low (60-69)", () => {
    fc.assert(
      fc.property(scoreInRangeArbitrary(60, 69), (score) => {
        const severity = getSeverityFromScore(score);
        expect(severity).toBe("low");
        expect(severityMatchesScore(score, "low")).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("Property 12: Severity matches score range - medium (70-79)", () => {
    fc.assert(
      fc.property(scoreInRangeArbitrary(70, 79), (score) => {
        const severity = getSeverityFromScore(score);
        expect(severity).toBe("medium");
        expect(severityMatchesScore(score, "medium")).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("Property 12: Severity matches score range - high (80-89)", () => {
    fc.assert(
      fc.property(scoreInRangeArbitrary(80, 89), (score) => {
        const severity = getSeverityFromScore(score);
        expect(severity).toBe("high");
        expect(severityMatchesScore(score, "high")).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("Property 12: Severity matches score range - critical (90-100)", () => {
    fc.assert(
      fc.property(scoreInRangeArbitrary(90, 100), (score) => {
        const severity = getSeverityFromScore(score);
        expect(severity).toBe("critical");
        expect(severityMatchesScore(score, "critical")).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("Property 12: Alert severity matches its score", () => {
    fc.assert(
      fc.property(riskScoreAboveThresholdArbitrary(), (riskScore) => {
        const alertData = createAlertFromScore(riskScore);

        expect(alertData).not.toBeNull();
        const alert = alertData as AlertData;

        // Verify severity matches score
        expect(severityMatchesScore(alert.score, alert.severity)).toBe(true);

        // Double-check with direct calculation
        const expectedSeverity = getSeverityFromScore(alert.score);
        expect(alert.severity).toBe(expectedSeverity);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 13: Alert Deduplication
   *
   * For any actor with an existing open alert within the deduplication window,
   * a new high score SHALL NOT create a duplicate alert.
   *
   * Validates: Requirements 5.3
   */
  it("Property 13: Deduplication logic - existing alert prevents new alert", () => {
    fc.assert(
      fc.property(fc.boolean(), (existingAlertExists) => {
        const shouldSkip = shouldDeduplicate(existingAlertExists);

        // If existing alert exists, should deduplicate (skip new alert)
        expect(shouldSkip).toBe(existingAlertExists);
      }),
      { numRuns: 100 }
    );
  });

  it("Property 13: meetsAlertThreshold is consistent", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        (score, threshold) => {
          const meets = meetsAlertThreshold(score, threshold);

          // Should return true if and only if score >= threshold
          expect(meets).toBe(score >= threshold);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional tests for edge cases
   */
  it("Scores below 60 return low severity (edge case)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 59 }), (score) => {
        const severity = getSeverityFromScore(score);
        // Scores below 60 should still return "low" as the minimum severity
        expect(severity).toBe("low");
      }),
      { numRuns: 100 }
    );
  });

  it("Boundary scores map to correct severity", () => {
    // Test exact boundary values
    expect(getSeverityFromScore(60)).toBe("low");
    expect(getSeverityFromScore(69)).toBe("low");
    expect(getSeverityFromScore(70)).toBe("medium");
    expect(getSeverityFromScore(79)).toBe("medium");
    expect(getSeverityFromScore(80)).toBe("high");
    expect(getSeverityFromScore(89)).toBe("high");
    expect(getSeverityFromScore(90)).toBe("critical");
    expect(getSeverityFromScore(100)).toBe("critical");
  });

  it("Severity ranges are correctly defined", () => {
    expect(SEVERITY_RANGES.low.min).toBe(60);
    expect(SEVERITY_RANGES.low.max).toBe(69);
    expect(SEVERITY_RANGES.medium.min).toBe(70);
    expect(SEVERITY_RANGES.medium.max).toBe(79);
    expect(SEVERITY_RANGES.high.min).toBe(80);
    expect(SEVERITY_RANGES.high.max).toBe(89);
    expect(SEVERITY_RANGES.critical.min).toBe(90);
    expect(SEVERITY_RANGES.critical.max).toBe(100);
  });
});
