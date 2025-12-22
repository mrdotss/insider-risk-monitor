// Baseline Engine - Compute rolling behavioral baselines per actor
// Requirements: 3.1, 3.2, 3.3, 3.5

import { prisma } from "@/lib/db";
import { Event, Baseline } from "@/types";

// ============================================
// Types
// ============================================

/**
 * Actor baseline representing behavioral patterns
 * Used for anomaly detection in scoring engine
 */
export interface ActorBaseline {
  actorId: string;
  computedAt: Date;
  windowDays: number;

  // Behavioral patterns
  typicalActiveHours: number[]; // Array of hours (0-23) when typically active
  knownIpAddresses: string[]; // IPs seen in baseline period
  knownUserAgents: string[]; // User agents seen
  avgBytesPerDay: number; // Average bytes transferred per day
  avgEventsPerDay: number; // Average event count per day
  typicalResourceScope: number; // Count of distinct resources accessed
  normalFailureRate: number; // Percentage of failed actions (0-1)

  // Metadata
  eventCount: number; // Events in baseline period
  firstSeen: Date | null;
  lastSeen: Date | null;
}

/**
 * Result of baseline computation
 */
export interface BaselineComputationResult {
  success: boolean;
  baseline?: ActorBaseline;
  error?: string;
}

// ============================================
// Constants
// ============================================

/** Default baseline window in days (Requirement 3.1: 14-day rolling baseline) */
export const DEFAULT_WINDOW_DAYS = 14;

/** Minimum events required before using actor-specific baseline */
export const MIN_EVENTS_FOR_BASELINE = 5;

// ============================================
// System Defaults (Requirement 3.3)
// ============================================

/**
 * Get system-wide default baseline for new actors
 * Used when an actor has insufficient data for their own baseline
 * Requirement 3.3: Use system-wide defaults until sufficient data exists
 */
export function getSystemDefaults(): ActorBaseline {
  return {
    actorId: "system_default",
    computedAt: new Date(),
    windowDays: DEFAULT_WINDOW_DAYS,

    // Conservative defaults - assume typical business hours activity
    typicalActiveHours: [9, 10, 11, 12, 13, 14, 15, 16, 17], // 9 AM - 5 PM
    knownIpAddresses: [], // No known IPs for new actors
    knownUserAgents: [], // No known user agents
    avgBytesPerDay: 10_000_000, // 10 MB per day default
    avgEventsPerDay: 50, // 50 events per day default
    typicalResourceScope: 20, // 20 distinct resources default
    normalFailureRate: 0.05, // 5% failure rate default

    eventCount: 0,
    firstSeen: null,
    lastSeen: null,
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Extract hour (0-23) from a Date object in UTC
 */
function getHourFromDate(date: Date): number {
  return date.getUTCHours();
}

/**
 * Calculate the most common hours from a list of events
 * Returns hours that appear in at least 10% of events
 */
function computeTypicalHours(events: Event[]): number[] {
  if (events.length === 0) return [];

  const hourCounts = new Map<number, number>();

  for (const event of events) {
    const hour = getHourFromDate(event.occurredAt);
    hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
  }

  // Include hours that appear in at least 10% of events
  const threshold = Math.max(1, Math.floor(events.length * 0.1));
  const typicalHours: number[] = [];

  for (const [hour, count] of hourCounts) {
    if (count >= threshold) {
      typicalHours.push(hour);
    }
  }

  return typicalHours.sort((a, b) => a - b);
}

/**
 * Extract unique IP addresses from events
 */
function extractKnownIps(events: Event[]): string[] {
  const ips = new Set<string>();

  for (const event of events) {
    if (event.ip) {
      ips.add(event.ip);
    }
  }

  return Array.from(ips);
}

/**
 * Extract unique user agents from events
 */
function extractKnownUserAgents(events: Event[]): string[] {
  const userAgents = new Set<string>();

  for (const event of events) {
    if (event.userAgent) {
      userAgents.add(event.userAgent);
    }
  }

  return Array.from(userAgents);
}

/**
 * Calculate average bytes transferred per day
 */
function computeAvgBytesPerDay(events: Event[], windowDays: number): number {
  if (events.length === 0 || windowDays <= 0) return 0;

  let totalBytes = 0;
  for (const event of events) {
    if (event.bytes !== null && event.bytes > 0) {
      totalBytes += event.bytes;
    }
  }

  return totalBytes / windowDays;
}

/**
 * Calculate average events per day
 */
function computeAvgEventsPerDay(eventCount: number, windowDays: number): number {
  if (windowDays <= 0) return 0;
  return eventCount / windowDays;
}

/**
 * Count distinct resources accessed
 */
function computeResourceScope(events: Event[]): number {
  const resources = new Set<string>();

  for (const event of events) {
    if (event.resourceId) {
      resources.add(event.resourceId);
    }
  }

  return resources.size;
}

/**
 * Calculate failure rate (0-1)
 */
function computeFailureRate(events: Event[]): number {
  if (events.length === 0) return 0;

  let failureCount = 0;
  for (const event of events) {
    if (event.outcome === "failure") {
      failureCount++;
    }
  }

  return failureCount / events.length;
}

/**
 * Get the earliest and latest event timestamps
 */
function getEventTimeRange(events: Event[]): { firstSeen: Date | null; lastSeen: Date | null } {
  if (events.length === 0) {
    return { firstSeen: null, lastSeen: null };
  }

  let firstSeen = events[0].occurredAt;
  let lastSeen = events[0].occurredAt;

  for (const event of events) {
    if (event.occurredAt < firstSeen) {
      firstSeen = event.occurredAt;
    }
    if (event.occurredAt > lastSeen) {
      lastSeen = event.occurredAt;
    }
  }

  return { firstSeen, lastSeen };
}

// ============================================
// Main Baseline Functions
// ============================================

/**
 * Compute baseline for a single actor from their events
 * This is a pure function that computes baseline from provided events
 *
 * @param actorId - The actor identifier
 * @param events - Events for this actor within the baseline window
 * @param windowDays - Number of days in the baseline window
 * @returns ActorBaseline with computed behavioral metrics
 *
 * Requirements:
 * - 3.1: Compute rolling baselines per actor
 * - 3.2: Track typical hours, IPs, devices, bytes, scope, failure rate
 * - 3.5: Produce valid Baseline record for actors with events
 */
export function computeBaselineFromEvents(
  actorId: string,
  events: Event[],
  windowDays: number = DEFAULT_WINDOW_DAYS
): ActorBaseline {
  const { firstSeen, lastSeen } = getEventTimeRange(events);

  return {
    actorId,
    computedAt: new Date(),
    windowDays,

    typicalActiveHours: computeTypicalHours(events),
    knownIpAddresses: extractKnownIps(events),
    knownUserAgents: extractKnownUserAgents(events),
    avgBytesPerDay: computeAvgBytesPerDay(events, windowDays),
    avgEventsPerDay: computeAvgEventsPerDay(events.length, windowDays),
    typicalResourceScope: computeResourceScope(events),
    normalFailureRate: computeFailureRate(events),

    eventCount: events.length,
    firstSeen,
    lastSeen,
  };
}


/**
 * Compute baseline for a single actor by fetching their events from the database
 *
 * @param actorId - The actor identifier
 * @param windowDays - Number of days in the baseline window (default: 14)
 * @returns BaselineComputationResult with computed baseline or error
 *
 * Requirements:
 * - 3.1: Compute rolling 14-day (configurable) baselines per actor
 * - 3.3: Use system-wide defaults until sufficient data exists
 */
export async function computeBaseline(
  actorId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS
): Promise<BaselineComputationResult> {
  try {
    // Calculate the start of the baseline window
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - windowDays);

    // Fetch events for this actor within the window
    const events = await prisma.event.findMany({
      where: {
        actorId,
        occurredAt: {
          gte: windowStart,
        },
      },
      orderBy: {
        occurredAt: "asc",
      },
    });

    // If insufficient data, return system defaults (Requirement 3.3)
    if (events.length < MIN_EVENTS_FOR_BASELINE) {
      const defaults = getSystemDefaults();
      return {
        success: true,
        baseline: {
          ...defaults,
          actorId,
          eventCount: events.length,
        },
      };
    }

    // Compute baseline from events
    const baseline = computeBaselineFromEvents(actorId, events, windowDays);

    return {
      success: true,
      baseline,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error computing baseline",
    };
  }
}

/**
 * Save a computed baseline to the database
 *
 * @param baseline - The computed baseline to save
 * @returns The saved Baseline record
 */
export async function saveBaseline(baseline: ActorBaseline): Promise<Baseline> {
  // Ensure the actor exists in the Actor table
  await prisma.actor.upsert({
    where: { actorId: baseline.actorId },
    update: {
      lastSeen: baseline.lastSeen || new Date(),
    },
    create: {
      actorId: baseline.actorId,
      firstSeen: baseline.firstSeen || new Date(),
      lastSeen: baseline.lastSeen || new Date(),
    },
  });

  // Create the baseline record
  return prisma.baseline.create({
    data: {
      actorId: baseline.actorId,
      computedAt: baseline.computedAt,
      windowDays: baseline.windowDays,
      typicalActiveHours: baseline.typicalActiveHours,
      knownIpAddresses: baseline.knownIpAddresses,
      knownUserAgents: baseline.knownUserAgents,
      avgBytesPerDay: baseline.avgBytesPerDay,
      avgEventsPerDay: baseline.avgEventsPerDay,
      typicalResourceScope: baseline.typicalResourceScope,
      normalFailureRate: baseline.normalFailureRate,
      eventCount: baseline.eventCount,
    },
  });
}

/**
 * Compute and save baselines for all actors with events in the window
 * This is the batch processing function for the background worker
 *
 * @param windowDays - Number of days in the baseline window (default: 14)
 * @returns Summary of the batch computation
 *
 * Requirement 3.4: Run on a configurable schedule (handled by worker)
 */
export async function computeAllBaselines(
  windowDays: number = DEFAULT_WINDOW_DAYS
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}> {
  const result = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [] as string[],
  };

  try {
    // Calculate the start of the baseline window
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - windowDays);

    // Get all distinct actor IDs with events in the window
    const actorIds = await prisma.event.findMany({
      where: {
        occurredAt: {
          gte: windowStart,
        },
      },
      select: {
        actorId: true,
      },
      distinct: ["actorId"],
    });

    result.processed = actorIds.length;

    // Compute and save baseline for each actor
    for (const { actorId } of actorIds) {
      try {
        const computeResult = await computeBaseline(actorId, windowDays);

        if (computeResult.success && computeResult.baseline) {
          await saveBaseline(computeResult.baseline);
          result.succeeded++;
        } else {
          result.failed++;
          result.errors.push(`${actorId}: ${computeResult.error}`);
        }
      } catch (error) {
        result.failed++;
        result.errors.push(
          `${actorId}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }
  } catch (error) {
    result.errors.push(
      `Batch processing error: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  return result;
}

/**
 * Get the most recent baseline for an actor
 *
 * @param actorId - The actor identifier
 * @returns The most recent baseline or null if none exists
 */
export async function getLatestBaseline(actorId: string): Promise<Baseline | null> {
  return prisma.baseline.findFirst({
    where: { actorId },
    orderBy: { computedAt: "desc" },
  });
}

/**
 * Get baseline for an actor, computing if necessary
 * Returns system defaults if no baseline exists and computation fails
 *
 * @param actorId - The actor identifier
 * @param windowDays - Number of days in the baseline window
 * @returns ActorBaseline (either from DB, computed, or system defaults)
 */
export async function getOrComputeBaseline(
  actorId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS
): Promise<ActorBaseline> {
  // Try to get existing baseline
  const existing = await getLatestBaseline(actorId);

  if (existing) {
    // Convert DB record to ActorBaseline
    return {
      actorId: existing.actorId,
      computedAt: existing.computedAt,
      windowDays: existing.windowDays,
      typicalActiveHours: existing.typicalActiveHours as number[],
      knownIpAddresses: existing.knownIpAddresses as string[],
      knownUserAgents: existing.knownUserAgents as string[],
      avgBytesPerDay: existing.avgBytesPerDay,
      avgEventsPerDay: existing.avgEventsPerDay,
      typicalResourceScope: existing.typicalResourceScope,
      normalFailureRate: existing.normalFailureRate,
      eventCount: existing.eventCount,
      firstSeen: null, // Not stored in DB record
      lastSeen: null, // Not stored in DB record
    };
  }

  // Compute new baseline
  const result = await computeBaseline(actorId, windowDays);

  if (result.success && result.baseline) {
    return result.baseline;
  }

  // Fall back to system defaults
  const defaults = getSystemDefaults();
  return {
    ...defaults,
    actorId,
  };
}

/**
 * Validate that a baseline has all required fields populated
 * Used for testing Property 6
 */
export function isValidBaseline(baseline: ActorBaseline): boolean {
  return (
    typeof baseline.actorId === "string" &&
    baseline.actorId.length > 0 &&
    baseline.computedAt instanceof Date &&
    !isNaN(baseline.computedAt.getTime()) &&
    typeof baseline.windowDays === "number" &&
    baseline.windowDays > 0 &&
    Array.isArray(baseline.typicalActiveHours) &&
    baseline.typicalActiveHours.every((h) => typeof h === "number" && h >= 0 && h <= 23) &&
    Array.isArray(baseline.knownIpAddresses) &&
    baseline.knownIpAddresses.every((ip) => typeof ip === "string") &&
    Array.isArray(baseline.knownUserAgents) &&
    baseline.knownUserAgents.every((ua) => typeof ua === "string") &&
    typeof baseline.avgBytesPerDay === "number" &&
    baseline.avgBytesPerDay >= 0 &&
    typeof baseline.avgEventsPerDay === "number" &&
    baseline.avgEventsPerDay >= 0 &&
    typeof baseline.typicalResourceScope === "number" &&
    baseline.typicalResourceScope >= 0 &&
    typeof baseline.normalFailureRate === "number" &&
    baseline.normalFailureRate >= 0 &&
    baseline.normalFailureRate <= 1 &&
    typeof baseline.eventCount === "number" &&
    baseline.eventCount >= 0
  );
}
