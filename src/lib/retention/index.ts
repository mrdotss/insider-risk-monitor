/**
 * Retention System - Data retention and cleanup
 * 
 * Requirements:
 * - 12.1: Support configurable retention periods (30/90/180 days)
 * - 12.2: Run a daily cleanup job to delete expired events
 * - 12.3: Preserve aggregated baseline data when events are deleted
 * - 12.4: Respect per-source retention overrides
 */

import { prisma } from "@/lib/db";

// ============================================
// Types
// ============================================

/**
 * Result of a retention cleanup operation
 */
export interface RetentionCleanupResult {
  success: boolean;
  totalEventsDeleted: number;
  sourcesProcessed: number;
  deletionsBySource: Record<string, number>;
  orphanedEventsDeleted: number;
  baselinesPreserved: number;
  error?: string;
}

/**
 * Options for retention cleanup
 */
export interface RetentionCleanupOptions {
  /** Default retention period in days (used when source has no override) */
  defaultRetentionDays?: number;
  /** Dry run mode - don't actually delete, just report what would be deleted */
  dryRun?: boolean;
}

// ============================================
// Constants
// ============================================

/** Default retention period in days (Requirement 12.1) */
export const DEFAULT_RETENTION_DAYS = 90;

/** Supported retention periods (Requirement 12.1) */
export const SUPPORTED_RETENTION_PERIODS = [30, 90, 180] as const;

// ============================================
// Helper Functions
// ============================================

/**
 * Calculate the cutoff date for a given retention period
 * 
 * @param retentionDays - Number of days to retain
 * @param referenceDate - Reference date (default: now)
 * @returns Cutoff date - events before this should be deleted
 */
export function calculateCutoffDate(
  retentionDays: number,
  referenceDate: Date = new Date()
): Date {
  const cutoff = new Date(referenceDate);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

/**
 * Validate that a retention period is supported
 * 
 * @param days - Retention period in days
 * @returns true if the period is valid
 */
export function isValidRetentionPeriod(days: number): boolean {
  return days > 0 && Number.isInteger(days);
}

// ============================================
// Main Retention Functions
// ============================================

/**
 * Delete expired events for a specific source
 * 
 * @param sourceId - The source ID
 * @param retentionDays - Retention period in days
 * @param dryRun - If true, don't actually delete
 * @returns Number of events deleted (or would be deleted in dry run)
 */
export async function deleteExpiredEventsForSource(
  sourceId: string,
  retentionDays: number,
  dryRun: boolean = false
): Promise<number> {
  const cutoffDate = calculateCutoffDate(retentionDays);

  if (dryRun) {
    // Count events that would be deleted
    const count = await prisma.event.count({
      where: {
        sourceId,
        occurredAt: {
          lt: cutoffDate,
        },
      },
    });
    return count;
  }

  // Delete events older than retention period
  const result = await prisma.event.deleteMany({
    where: {
      sourceId,
      occurredAt: {
        lt: cutoffDate,
      },
    },
  });

  return result.count;
}

/**
 * Delete orphaned events (events from sources that no longer exist)
 * 
 * @param existingSourceIds - IDs of sources that still exist
 * @param retentionDays - Retention period in days
 * @param dryRun - If true, don't actually delete
 * @returns Number of events deleted (or would be deleted in dry run)
 */
export async function deleteOrphanedEvents(
  existingSourceIds: string[],
  retentionDays: number,
  dryRun: boolean = false
): Promise<number> {
  if (existingSourceIds.length === 0) {
    return 0;
  }

  const cutoffDate = calculateCutoffDate(retentionDays);

  if (dryRun) {
    const count = await prisma.event.count({
      where: {
        sourceId: {
          notIn: existingSourceIds,
        },
        occurredAt: {
          lt: cutoffDate,
        },
      },
    });
    return count;
  }

  const result = await prisma.event.deleteMany({
    where: {
      sourceId: {
        notIn: existingSourceIds,
      },
      occurredAt: {
        lt: cutoffDate,
      },
    },
  });

  return result.count;
}

/**
 * Run full retention cleanup across all sources
 * 
 * This function:
 * 1. Gets all sources with their retention settings
 * 2. Deletes expired events for each source (respecting per-source overrides)
 * 3. Deletes orphaned events from deleted sources
 * 4. Preserves all baseline records (never deletes them)
 * 
 * Requirements:
 * - 12.2: Run cleanup to delete expired events
 * - 12.3: Preserve aggregated baseline data
 * - 12.4: Respect per-source retention overrides
 * 
 * @param options - Cleanup options
 * @returns RetentionCleanupResult with details of the operation
 */
export async function runRetentionCleanup(
  options: RetentionCleanupOptions = {}
): Promise<RetentionCleanupResult> {
  const {
    defaultRetentionDays = DEFAULT_RETENTION_DAYS,
    dryRun = false,
  } = options;

  const result: RetentionCleanupResult = {
    success: false,
    totalEventsDeleted: 0,
    sourcesProcessed: 0,
    deletionsBySource: {},
    orphanedEventsDeleted: 0,
    baselinesPreserved: 0,
  };

  try {
    // Get all sources with their retention settings
    const sources = await prisma.source.findMany({
      select: {
        id: true,
        key: true,
        retentionDays: true,
      },
    });

    result.sourcesProcessed = sources.length;

    // Process each source with its specific retention period
    for (const source of sources) {
      const retentionDays = source.retentionDays || defaultRetentionDays;
      
      const deletedCount = await deleteExpiredEventsForSource(
        source.id,
        retentionDays,
        dryRun
      );

      if (deletedCount > 0) {
        result.deletionsBySource[source.key] = deletedCount;
        result.totalEventsDeleted += deletedCount;
      }
    }

    // Clean up orphaned events
    const sourceIds = sources.map(s => s.id);
    const orphanedCount = await deleteOrphanedEvents(
      sourceIds,
      defaultRetentionDays,
      dryRun
    );
    
    result.orphanedEventsDeleted = orphanedCount;
    result.totalEventsDeleted += orphanedCount;

    // Count baselines that are preserved (Requirement 12.3)
    // Baselines are NEVER deleted - they are preserved for historical analysis
    result.baselinesPreserved = await prisma.baseline.count();

    result.success = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : "Unknown error";
  }

  return result;
}

/**
 * Get retention statistics for monitoring
 * 
 * @returns Statistics about events and retention
 */
export async function getRetentionStats(): Promise<{
  totalEvents: number;
  eventsBySource: Record<string, number>;
  oldestEventDate: Date | null;
  newestEventDate: Date | null;
  totalBaselines: number;
}> {
  // Get total event count
  const totalEvents = await prisma.event.count();

  // Get events by source
  const eventsBySourceRaw = await prisma.event.groupBy({
    by: ["sourceId"],
    _count: {
      id: true,
    },
  });

  // Get source keys for the IDs
  const sourceIds = eventsBySourceRaw.map(e => e.sourceId);
  const sources = await prisma.source.findMany({
    where: { id: { in: sourceIds } },
    select: { id: true, key: true },
  });
  const sourceIdToKey = new Map(sources.map(s => [s.id, s.key]));

  const eventsBySource: Record<string, number> = {};
  for (const item of eventsBySourceRaw) {
    const key = sourceIdToKey.get(item.sourceId) || item.sourceId;
    eventsBySource[key] = item._count.id;
  }

  // Get oldest and newest event dates
  const oldestEvent = await prisma.event.findFirst({
    orderBy: { occurredAt: "asc" },
    select: { occurredAt: true },
  });

  const newestEvent = await prisma.event.findFirst({
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
  });

  // Get baseline count
  const totalBaselines = await prisma.baseline.count();

  return {
    totalEvents,
    eventsBySource,
    oldestEventDate: oldestEvent?.occurredAt || null,
    newestEventDate: newestEvent?.occurredAt || null,
    totalBaselines,
  };
}
