/**
 * Alerting System - Generate, deduplicate, and manage alerts
 * Requirements: 5.1, 5.2, 5.4
 *
 * - 5.1: Create Alert when actor's risk score exceeds threshold (default: 60)
 * - 5.2: Alert includes actor, score, rule contributions, baseline comparisons, triggering events
 * - 5.4: Assign severity based on score ranges
 */

import { Alert, Severity, AlertStatus, BaselineComparison } from "@/types";
import { RuleContribution } from "@/types";
import { RiskScoreResult } from "@/lib/scoring";
import { ActorBaseline } from "@/lib/baseline";
import { prisma } from "@/lib/db";

// ============================================
// Types
// ============================================

/**
 * Result of alert evaluation
 */
export interface AlertEvaluationResult {
  alertCreated: boolean;
  alert?: Alert;
  reason: string;
}

/**
 * Options for alert generation
 */
export interface AlertOptions {
  /** Score threshold for alert generation (default: 60) */
  threshold?: number;
  /** Deduplication window in minutes (default: 60) */
  deduplicationWindowMinutes?: number;
  /** Skip deduplication check (default: false) */
  skipDeduplication?: boolean;
}

/**
 * Alert data before database insertion
 */
export interface AlertData {
  actorId: string;
  severity: Severity;
  status: AlertStatus;
  score: number;
  ruleContributions: RuleContribution[];
  baselineComparison: BaselineComparison;
  triggeringEventIds: string[];
}

// ============================================
// Constants
// ============================================

/** Default alert threshold (Requirement 5.1) */
export const DEFAULT_ALERT_THRESHOLD = 60;

/** Default deduplication window in minutes (Requirement 5.3) */
export const DEFAULT_DEDUPLICATION_WINDOW_MINUTES = 60;

/** Severity score ranges (Requirement 5.4) */
export const SEVERITY_RANGES = {
  low: { min: 60, max: 69 },
  medium: { min: 70, max: 79 },
  high: { min: 80, max: 89 },
  critical: { min: 90, max: 100 },
} as const;

// ============================================
// Helper Functions
// ============================================

/**
 * Determine severity based on score (Requirement 5.4)
 * - Score 60-69: low
 * - Score 70-79: medium
 * - Score 80-89: high
 * - Score 90-100: critical
 *
 * @param score - Risk score (0-100)
 * @returns Severity level
 */
export function getSeverityFromScore(score: number): Severity {
  if (score >= SEVERITY_RANGES.critical.min) {
    return "critical";
  }
  if (score >= SEVERITY_RANGES.high.min) {
    return "high";
  }
  if (score >= SEVERITY_RANGES.medium.min) {
    return "medium";
  }
  return "low";
}

/**
 * Build baseline comparison object from baseline and recent events
 * Shows current behavior vs baseline for context
 *
 * @param baseline - Actor's baseline
 * @param riskScore - Computed risk score with contributions
 * @returns BaselineComparison object
 */
export function buildBaselineComparison(
  baseline: ActorBaseline,
  riskScore: RiskScoreResult
): BaselineComparison {
  // Extract current values from rule contributions where available
  let currentBytes = 0;
  let currentScope = 0;
  let currentFailureRate = 0;
  let currentHours = "";

  for (const contribution of riskScore.ruleContributions) {
    if (contribution.ruleId.includes("volume") && typeof contribution.currentValue === "number") {
      currentBytes = contribution.currentValue;
    }
    if (contribution.ruleId.includes("scope") && typeof contribution.currentValue === "number") {
      currentScope = contribution.currentValue;
    }
    if (contribution.ruleId.includes("failure") && typeof contribution.currentValue === "number") {
      currentFailureRate = contribution.currentValue;
    }
    if (contribution.ruleId.includes("off_hours") && typeof contribution.currentValue === "string") {
      currentHours = contribution.currentValue;
    }
  }

  return {
    typicalHours: baseline.typicalActiveHours.join(", ") || "9-17",
    currentHours: currentHours || "N/A",
    avgBytes: baseline.avgBytesPerDay,
    currentBytes,
    normalScope: baseline.typicalResourceScope,
    currentScope,
    normalFailureRate: baseline.normalFailureRate,
    currentFailureRate,
  };
}

/**
 * Check if score meets alert threshold
 *
 * @param score - Risk score
 * @param threshold - Alert threshold
 * @returns true if score >= threshold
 */
export function meetsAlertThreshold(score: number, threshold: number): boolean {
  return score >= threshold;
}

// ============================================
// Deduplication Functions (Requirement 5.3)
// ============================================

/**
 * Check for existing open alert for an actor within the deduplication window
 * Returns true if a duplicate exists (should skip creating new alert)
 *
 * @param actorId - The actor identifier
 * @param windowMinutes - Deduplication window in minutes
 * @returns true if duplicate alert exists within window
 *
 * Requirement 5.3: Deduplicate alerts for the same actor within a configurable window
 */
export async function hasExistingOpenAlert(
  actorId: string,
  windowMinutes: number = DEFAULT_DEDUPLICATION_WINDOW_MINUTES
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

  const existingAlert = await prisma.alert.findFirst({
    where: {
      actorId,
      status: "open",
      createdAt: {
        gte: windowStart,
      },
    },
    select: { id: true },
  });

  return existingAlert !== null;
}

/**
 * Check if an alert should be deduplicated (pure function for testing)
 * This is a helper that determines if deduplication should occur
 *
 * @param existingAlertExists - Whether an existing open alert was found
 * @returns true if the new alert should be skipped (deduplicated)
 */
export function shouldDeduplicate(existingAlertExists: boolean): boolean {
  return existingAlertExists;
}

// ============================================
// Main Alert Functions
// ============================================

/**
 * Evaluate a risk score and create an alert if threshold is exceeded
 * This is a pure function that determines if an alert should be created
 *
 * @param riskScore - Computed risk score result
 * @param options - Alert options (threshold)
 * @returns Alert data if threshold exceeded, null otherwise
 *
 * Requirements:
 * - 5.1: Create Alert when score >= threshold (default: 60)
 * - 5.2: Include actor, score, rule contributions, baseline comparisons, triggering events
 * - 5.4: Assign severity based on score ranges
 */
export function createAlertFromScore(
  riskScore: RiskScoreResult,
  options: AlertOptions = {}
): AlertData | null {
  const { threshold = DEFAULT_ALERT_THRESHOLD } = options;

  // Check if score meets threshold (Requirement 5.1)
  if (!meetsAlertThreshold(riskScore.totalScore, threshold)) {
    return null;
  }

  // Determine severity (Requirement 5.4)
  const severity = getSeverityFromScore(riskScore.totalScore);

  // Build baseline comparison (Requirement 5.2)
  const baselineComparison = buildBaselineComparison(
    riskScore.baselineUsed,
    riskScore
  );

  // Create alert data (Requirement 5.2)
  return {
    actorId: riskScore.actorId,
    severity,
    status: "open" as AlertStatus,
    score: riskScore.totalScore,
    ruleContributions: riskScore.ruleContributions,
    baselineComparison,
    triggeringEventIds: riskScore.triggeringEventIds,
  };
}

/**
 * Evaluate a risk score and create an alert in the database if threshold is exceeded
 *
 * @param riskScore - Computed risk score result
 * @param options - Alert options (threshold, deduplication)
 * @returns AlertEvaluationResult with created alert or reason for not creating
 *
 * Requirements:
 * - 5.1: Create Alert when score >= threshold
 * - 5.2: Include all required fields
 * - 5.3: Deduplicate alerts for the same actor within a configurable window
 * - 5.4: Assign severity based on score ranges
 */
export async function evaluateAndAlert(
  riskScore: RiskScoreResult,
  options: AlertOptions = {}
): Promise<AlertEvaluationResult> {
  const {
    threshold = DEFAULT_ALERT_THRESHOLD,
    deduplicationWindowMinutes = DEFAULT_DEDUPLICATION_WINDOW_MINUTES,
    skipDeduplication = false,
  } = options;

  // Check if score meets threshold
  if (!meetsAlertThreshold(riskScore.totalScore, threshold)) {
    return {
      alertCreated: false,
      reason: `Score ${riskScore.totalScore} is below threshold ${threshold}`,
    };
  }

  // Check for deduplication (Requirement 5.3)
  if (!skipDeduplication) {
    const isDuplicate = await hasExistingOpenAlert(
      riskScore.actorId,
      deduplicationWindowMinutes
    );

    if (isDuplicate) {
      return {
        alertCreated: false,
        reason: `Duplicate alert: existing open alert for actor ${riskScore.actorId} within ${deduplicationWindowMinutes} minute window`,
      };
    }
  }

  // Create alert data
  const alertData = createAlertFromScore(riskScore, options);

  if (!alertData) {
    return {
      alertCreated: false,
      reason: "Failed to create alert data",
    };
  }

  try {
    // Ensure actor exists in the database
    await prisma.actor.upsert({
      where: { actorId: riskScore.actorId },
      update: {
        lastSeen: new Date(),
        currentRiskScore: riskScore.totalScore,
      },
      create: {
        actorId: riskScore.actorId,
        firstSeen: new Date(),
        lastSeen: new Date(),
        currentRiskScore: riskScore.totalScore,
      },
    });

    // Create the alert in the database
    const alert = await prisma.alert.create({
      data: {
        actorId: alertData.actorId,
        severity: alertData.severity,
        status: alertData.status,
        score: alertData.score,
        ruleContributions: JSON.parse(JSON.stringify(alertData.ruleContributions)),
        baselineComparison: JSON.parse(JSON.stringify(alertData.baselineComparison)),
        triggeringEventIds: alertData.triggeringEventIds,
      },
    });

    return {
      alertCreated: true,
      alert,
      reason: `Alert created with severity ${alert.severity}`,
    };
  } catch (error) {
    return {
      alertCreated: false,
      reason: `Database error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// ============================================
// Validation Functions (for testing)
// ============================================

/**
 * Validate that an alert has all required fields (Property 11)
 *
 * @param alert - Alert to validate
 * @returns true if alert is complete
 */
export function isValidAlert(alert: Partial<Alert>): boolean {
  // Check required fields
  if (!alert.actorId || alert.actorId.length === 0) {
    return false;
  }

  if (typeof alert.score !== "number" || alert.score < 0 || alert.score > 100) {
    return false;
  }

  if (!alert.severity || !["low", "medium", "high", "critical"].includes(alert.severity)) {
    return false;
  }

  // Check ruleContributions is non-empty array
  if (!Array.isArray(alert.ruleContributions) || alert.ruleContributions.length === 0) {
    return false;
  }

  // Check baselineComparison exists
  if (!alert.baselineComparison || typeof alert.baselineComparison !== "object") {
    return false;
  }

  // Check triggeringEventIds is array
  if (!Array.isArray(alert.triggeringEventIds)) {
    return false;
  }

  return true;
}

/**
 * Validate severity matches score range (Property 12)
 *
 * @param score - Risk score
 * @param severity - Assigned severity
 * @returns true if severity matches expected range
 */
export function severityMatchesScore(score: number, severity: Severity): boolean {
  const expected = getSeverityFromScore(score);
  return severity === expected;
}

