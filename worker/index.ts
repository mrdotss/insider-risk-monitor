/**
 * Background Worker Process
 * 
 * Interval-based scheduler for background jobs:
 * - Baseline computation (every 5 minutes)
 * - Scoring run (every 5 minutes)
 * - Retention cleanup (daily)
 * 
 * Requirements: 3.4, 12.2
 * 
 * Run with: npx tsx worker/index.ts
 */

// Load environment variables from .env file
import "dotenv/config";

import { prisma } from "@/lib/db";
import { computeAllBaselines, getOrComputeBaseline, DEFAULT_WINDOW_DAYS } from "@/lib/baseline";
import { scoreActor, getDefaultRules, RiskScoreResult } from "@/lib/scoring";
import { evaluateAndAlert, DEFAULT_ALERT_THRESHOLD } from "@/lib/alerting";
import { runRetentionCleanup as executeRetentionCleanup, DEFAULT_RETENTION_DAYS } from "@/lib/retention";
import { Event } from "@/types";

// ============================================
// Configuration
// ============================================

/** Baseline computation interval in milliseconds (default: 5 minutes) */
const BASELINE_INTERVAL_MS = parseInt(process.env.BASELINE_INTERVAL_MS || "300000", 10);

/** Scoring run interval in milliseconds (default: 5 minutes) */
const SCORING_INTERVAL_MS = parseInt(process.env.SCORING_INTERVAL_MS || "300000", 10);

/** Retention cleanup interval in milliseconds (default: 24 hours) */
const RETENTION_INTERVAL_MS = parseInt(process.env.RETENTION_INTERVAL_MS || "86400000", 10);

/** Default retention period in days (from env or use module default) */
const CONFIGURED_RETENTION_DAYS = parseInt(
  process.env.DEFAULT_RETENTION_DAYS || String(DEFAULT_RETENTION_DAYS), 
  10
);

/** Alert threshold for scoring */
const ALERT_THRESHOLD = parseInt(process.env.ALERT_THRESHOLD || String(DEFAULT_ALERT_THRESHOLD), 10);

/** Scoring window in minutes (how far back to look for recent events) */
const SCORING_WINDOW_MINUTES = parseInt(process.env.SCORING_WINDOW_MINUTES || "60", 10);

// ============================================
// Job State
// ============================================

interface JobState {
  isRunning: boolean;
  lastRun: Date | null;
  lastError: string | null;
  runCount: number;
}

const jobStates: Record<string, JobState> = {
  baseline: { isRunning: false, lastRun: null, lastError: null, runCount: 0 },
  scoring: { isRunning: false, lastRun: null, lastError: null, runCount: 0 },
  retention: { isRunning: false, lastRun: null, lastError: null, runCount: 0 },
};

// ============================================
// Logging
// ============================================

function log(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logData = data ? ` ${JSON.stringify(data)}` : "";
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}${logData}`);
}

// ============================================
// Baseline Computation Job
// ============================================

/**
 * Run baseline computation for all actors with recent events
 * Requirement 3.4: Run on a configurable schedule (default: every 5 minutes)
 */
export async function runBaselineComputation(): Promise<void> {
  const jobName = "baseline";
  
  if (jobStates[jobName].isRunning) {
    log("warn", "Baseline computation already running, skipping");
    return;
  }

  jobStates[jobName].isRunning = true;
  const startTime = Date.now();

  try {
    log("info", "Starting baseline computation");

    const result = await computeAllBaselines(DEFAULT_WINDOW_DAYS);

    const duration = Date.now() - startTime;
    log("info", "Baseline computation completed", {
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      durationMs: duration,
    });

    if (result.errors.length > 0) {
      log("warn", "Baseline computation had errors", { errors: result.errors.slice(0, 5) });
    }

    jobStates[jobName].lastRun = new Date();
    jobStates[jobName].lastError = null;
    jobStates[jobName].runCount++;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    log("error", "Baseline computation failed", { error: errorMessage });
    jobStates[jobName].lastError = errorMessage;
  } finally {
    jobStates[jobName].isRunning = false;
  }
}

// ============================================
// Scoring Job
// ============================================

/**
 * Get recent events for an actor within the scoring window
 */
async function getRecentEvents(actorId: string, windowMinutes: number): Promise<Event[]> {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
  
  return prisma.event.findMany({
    where: {
      actorId,
      occurredAt: {
        gte: cutoff,
      },
    },
    orderBy: {
      occurredAt: "desc",
    },
  });
}

/**
 * Score a single actor and generate alert if needed
 */
async function scoreAndAlertActor(actorId: string): Promise<{
  scored: boolean;
  alertCreated: boolean;
  score?: number;
  error?: string;
}> {
  try {
    // Get baseline for actor
    const baseline = await getOrComputeBaseline(actorId, DEFAULT_WINDOW_DAYS);

    // Get recent events
    const recentEvents = await getRecentEvents(actorId, SCORING_WINDOW_MINUTES);

    if (recentEvents.length === 0) {
      return { scored: false, alertCreated: false };
    }

    // Score the actor
    const rules = getDefaultRules();
    const riskScore: RiskScoreResult = scoreActor(actorId, baseline, recentEvents, { rules });

    // Save the risk score to the database
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
      threshold: ALERT_THRESHOLD,
    });

    return {
      scored: true,
      alertCreated: alertResult.alertCreated,
      score: riskScore.totalScore,
    };
  } catch (error) {
    return {
      scored: false,
      alertCreated: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Run scoring for all actors with recent events
 * Requirement 3.4: Run on a configurable schedule (default: every 5 minutes)
 */
export async function runScoringJob(): Promise<void> {
  const jobName = "scoring";

  if (jobStates[jobName].isRunning) {
    log("warn", "Scoring job already running, skipping");
    return;
  }

  jobStates[jobName].isRunning = true;
  const startTime = Date.now();

  try {
    log("info", "Starting scoring job");

    // Get all actors with recent events
    const cutoff = new Date(Date.now() - SCORING_WINDOW_MINUTES * 60 * 1000);
    const actorIds = await prisma.event.findMany({
      where: {
        occurredAt: {
          gte: cutoff,
        },
      },
      select: {
        actorId: true,
      },
      distinct: ["actorId"],
    });

    let scored = 0;
    let alertsCreated = 0;
    let errors = 0;

    for (const { actorId } of actorIds) {
      const result = await scoreAndAlertActor(actorId);
      
      if (result.scored) {
        scored++;
      }
      if (result.alertCreated) {
        alertsCreated++;
      }
      if (result.error) {
        errors++;
        log("warn", `Error scoring actor ${actorId}`, { error: result.error });
      }
    }

    const duration = Date.now() - startTime;
    log("info", "Scoring job completed", {
      actorsProcessed: actorIds.length,
      scored,
      alertsCreated,
      errors,
      durationMs: duration,
    });

    jobStates[jobName].lastRun = new Date();
    jobStates[jobName].lastError = null;
    jobStates[jobName].runCount++;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    log("error", "Scoring job failed", { error: errorMessage });
    jobStates[jobName].lastError = errorMessage;
  } finally {
    jobStates[jobName].isRunning = false;
  }
}

// ============================================
// Retention Cleanup Job
// ============================================

/**
 * Delete events older than the retention period
 * Requirement 12.2: Run a daily cleanup job to delete expired events
 * Requirement 12.3: Preserve aggregated baseline data
 * Requirement 12.4: Respect per-source retention overrides
 */
export async function runRetentionCleanup(): Promise<void> {
  const jobName = "retention";

  if (jobStates[jobName].isRunning) {
    log("warn", "Retention cleanup already running, skipping");
    return;
  }

  jobStates[jobName].isRunning = true;
  const startTime = Date.now();

  try {
    log("info", "Starting retention cleanup");

    // Use the retention module to perform cleanup
    const result = await executeRetentionCleanup({
      defaultRetentionDays: CONFIGURED_RETENTION_DAYS,
    });

    if (!result.success) {
      throw new Error(result.error || "Retention cleanup failed");
    }

    // Log per-source deletions
    for (const [sourceKey, count] of Object.entries(result.deletionsBySource)) {
      log("info", `Deleted ${count} events for source ${sourceKey}`);
    }

    if (result.orphanedEventsDeleted > 0) {
      log("info", `Deleted ${result.orphanedEventsDeleted} orphaned events`);
    }

    // Note: Baselines are NOT deleted (Requirement 12.3)
    // They are preserved for historical analysis
    log("info", `Preserved ${result.baselinesPreserved} baseline records`);

    const duration = Date.now() - startTime;
    log("info", "Retention cleanup completed", {
      totalDeleted: result.totalEventsDeleted,
      sourcesProcessed: result.sourcesProcessed,
      baselinesPreserved: result.baselinesPreserved,
      durationMs: duration,
    });

    jobStates[jobName].lastRun = new Date();
    jobStates[jobName].lastError = null;
    jobStates[jobName].runCount++;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    log("error", "Retention cleanup failed", { error: errorMessage });
    jobStates[jobName].lastError = errorMessage;
  } finally {
    jobStates[jobName].isRunning = false;
  }
}

// ============================================
// Scheduler
// ============================================

let baselineInterval: NodeJS.Timeout | null = null;
let scoringInterval: NodeJS.Timeout | null = null;
let retentionInterval: NodeJS.Timeout | null = null;
let isShuttingDown = false;

/**
 * Start the worker scheduler
 */
export function startWorker(): void {
  log("info", "Starting worker process", {
    baselineIntervalMs: BASELINE_INTERVAL_MS,
    scoringIntervalMs: SCORING_INTERVAL_MS,
    retentionIntervalMs: RETENTION_INTERVAL_MS,
    alertThreshold: ALERT_THRESHOLD,
    scoringWindowMinutes: SCORING_WINDOW_MINUTES,
    defaultRetentionDays: DEFAULT_RETENTION_DAYS,
  });

  // Run jobs immediately on startup
  runBaselineComputation();
  runScoringJob();
  // Don't run retention cleanup immediately - wait for the scheduled time

  // Schedule recurring jobs
  baselineInterval = setInterval(() => {
    if (!isShuttingDown) {
      runBaselineComputation();
    }
  }, BASELINE_INTERVAL_MS);

  scoringInterval = setInterval(() => {
    if (!isShuttingDown) {
      runScoringJob();
    }
  }, SCORING_INTERVAL_MS);

  retentionInterval = setInterval(() => {
    if (!isShuttingDown) {
      runRetentionCleanup();
    }
  }, RETENTION_INTERVAL_MS);

  log("info", "Worker scheduler started");
}

/**
 * Stop the worker scheduler gracefully
 */
export async function stopWorker(): Promise<void> {
  log("info", "Stopping worker process");
  isShuttingDown = true;

  // Clear intervals
  if (baselineInterval) {
    clearInterval(baselineInterval);
    baselineInterval = null;
  }
  if (scoringInterval) {
    clearInterval(scoringInterval);
    scoringInterval = null;
  }
  if (retentionInterval) {
    clearInterval(retentionInterval);
    retentionInterval = null;
  }

  // Wait for any running jobs to complete
  const maxWaitTime = 30000; // 30 seconds
  const startWait = Date.now();

  while (
    (jobStates.baseline.isRunning || 
     jobStates.scoring.isRunning || 
     jobStates.retention.isRunning) &&
    Date.now() - startWait < maxWaitTime
  ) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Disconnect from database
  await prisma.$disconnect();

  log("info", "Worker process stopped", {
    baselineRuns: jobStates.baseline.runCount,
    scoringRuns: jobStates.scoring.runCount,
    retentionRuns: jobStates.retention.runCount,
  });
}

/**
 * Get current job states (for monitoring)
 */
export function getJobStates(): Record<string, JobState> {
  return { ...jobStates };
}

// ============================================
// Main Entry Point
// ============================================

// Handle graceful shutdown
process.on("SIGINT", async () => {
  log("info", "Received SIGINT signal");
  await stopWorker();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  log("info", "Received SIGTERM signal");
  await stopWorker();
  process.exit(0);
});

// Start the worker if this is the main module
if (require.main === module) {
  startWorker();
}
