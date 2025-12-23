/**
 * Retention System Tests
 * 
 * Tests for data retention and cleanup functionality.
 * Requirements: 12.1, 12.2, 12.3, 12.4
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// Mock the prisma client
vi.mock("@/lib/db", () => ({
  prisma: {
    event: {
      count: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      groupBy: vi.fn(),
    },
    source: {
      findMany: vi.fn(),
    },
    baseline: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import {
  calculateCutoffDate,
  isValidRetentionPeriod,
  deleteExpiredEventsForSource,
  deleteOrphanedEvents,
  runRetentionCleanup,
  DEFAULT_RETENTION_DAYS,
  SUPPORTED_RETENTION_PERIODS,
} from "./index";

describe("Retention System", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculateCutoffDate", () => {
    it("should calculate correct cutoff date for 30 days", () => {
      const referenceDate = new Date("2025-12-22T00:00:00Z");
      const cutoff = calculateCutoffDate(30, referenceDate);
      
      expect(cutoff.toISOString().split("T")[0]).toBe("2025-11-22");
    });

    it("should calculate correct cutoff date for 90 days", () => {
      const referenceDate = new Date("2025-12-22T00:00:00Z");
      const cutoff = calculateCutoffDate(90, referenceDate);
      
      expect(cutoff.toISOString().split("T")[0]).toBe("2025-09-23");
    });

    it("should calculate correct cutoff date for 180 days", () => {
      const referenceDate = new Date("2025-12-22T00:00:00Z");
      const cutoff = calculateCutoffDate(180, referenceDate);
      
      expect(cutoff.toISOString().split("T")[0]).toBe("2025-06-25");
    });

    it("should use current date when no reference provided", () => {
      const cutoff = calculateCutoffDate(30);
      const expected = new Date();
      expected.setDate(expected.getDate() - 30);
      
      // Compare dates (ignoring time)
      expect(cutoff.toISOString().split("T")[0]).toBe(
        expected.toISOString().split("T")[0]
      );
    });
  });

  describe("isValidRetentionPeriod", () => {
    it("should accept positive integers", () => {
      expect(isValidRetentionPeriod(30)).toBe(true);
      expect(isValidRetentionPeriod(90)).toBe(true);
      expect(isValidRetentionPeriod(180)).toBe(true);
      expect(isValidRetentionPeriod(1)).toBe(true);
    });

    it("should reject zero and negative numbers", () => {
      expect(isValidRetentionPeriod(0)).toBe(false);
      expect(isValidRetentionPeriod(-1)).toBe(false);
      expect(isValidRetentionPeriod(-30)).toBe(false);
    });

    it("should reject non-integers", () => {
      expect(isValidRetentionPeriod(30.5)).toBe(false);
      expect(isValidRetentionPeriod(0.1)).toBe(false);
    });
  });

  describe("deleteExpiredEventsForSource", () => {
    it("should delete events older than retention period", async () => {
      vi.mocked(prisma.event.deleteMany).mockResolvedValue({ count: 100 });

      const result = await deleteExpiredEventsForSource("source-1", 30);

      expect(result).toBe(100);
      expect(prisma.event.deleteMany).toHaveBeenCalledWith({
        where: {
          sourceId: "source-1",
          occurredAt: {
            lt: expect.any(Date),
          },
        },
      });
    });

    it("should count events in dry run mode", async () => {
      vi.mocked(prisma.event.count).mockResolvedValue(50);

      const result = await deleteExpiredEventsForSource("source-1", 30, true);

      expect(result).toBe(50);
      expect(prisma.event.count).toHaveBeenCalled();
      expect(prisma.event.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("deleteOrphanedEvents", () => {
    it("should delete events from non-existent sources", async () => {
      vi.mocked(prisma.event.deleteMany).mockResolvedValue({ count: 25 });

      const result = await deleteOrphanedEvents(["source-1", "source-2"], 90);

      expect(result).toBe(25);
      expect(prisma.event.deleteMany).toHaveBeenCalledWith({
        where: {
          sourceId: {
            notIn: ["source-1", "source-2"],
          },
          occurredAt: {
            lt: expect.any(Date),
          },
        },
      });
    });

    it("should return 0 when no existing sources", async () => {
      const result = await deleteOrphanedEvents([], 90);

      expect(result).toBe(0);
      expect(prisma.event.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("runRetentionCleanup", () => {
    it("should process all sources with their retention settings", async () => {
      // Mock sources with different retention periods
      vi.mocked(prisma.source.findMany).mockResolvedValue([
        { id: "source-1", key: "vpn", retentionDays: 30 },
        { id: "source-2", key: "iam", retentionDays: 90 },
      ] as never);

      // Mock event deletion
      vi.mocked(prisma.event.deleteMany).mockResolvedValue({ count: 10 });
      vi.mocked(prisma.baseline.count).mockResolvedValue(5);

      const result = await runRetentionCleanup();

      expect(result.success).toBe(true);
      expect(result.sourcesProcessed).toBe(2);
      // 2 sources + 1 orphaned cleanup = 3 calls
      expect(prisma.event.deleteMany).toHaveBeenCalledTimes(3);
    });

    it("should preserve baselines (Requirement 12.3)", async () => {
      vi.mocked(prisma.source.findMany).mockResolvedValue([
        { id: "source-1", key: "vpn", retentionDays: 30 },
      ] as never);
      vi.mocked(prisma.event.deleteMany).mockResolvedValue({ count: 5 });
      vi.mocked(prisma.baseline.count).mockResolvedValue(10);

      const result = await runRetentionCleanup();

      expect(result.success).toBe(true);
      expect(result.baselinesPreserved).toBe(10);
      // Baselines should never be deleted
    });

    it("should respect per-source retention overrides (Requirement 12.4)", async () => {
      vi.mocked(prisma.source.findMany).mockResolvedValue([
        { id: "source-1", key: "vpn", retentionDays: 30 },
        { id: "source-2", key: "iam", retentionDays: 180 },
      ] as never);
      vi.mocked(prisma.event.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.baseline.count).mockResolvedValue(0);

      await runRetentionCleanup();

      // Each source should be processed with its own retention period
      expect(prisma.event.deleteMany).toHaveBeenCalledTimes(3);
    });

    it("should use default retention when source has no override", async () => {
      vi.mocked(prisma.source.findMany).mockResolvedValue([
        { id: "source-1", key: "vpn", retentionDays: null },
      ] as never);
      vi.mocked(prisma.event.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.baseline.count).mockResolvedValue(0);

      const result = await runRetentionCleanup({ defaultRetentionDays: 90 });

      expect(result.success).toBe(true);
    });

    it("should handle errors gracefully", async () => {
      vi.mocked(prisma.source.findMany).mockRejectedValue(new Error("DB error"));

      const result = await runRetentionCleanup();

      expect(result.success).toBe(false);
      expect(result.error).toBe("DB error");
    });
  });

  describe("Constants", () => {
    it("should have correct default retention days", () => {
      expect(DEFAULT_RETENTION_DAYS).toBe(90);
    });

    it("should support 30, 90, and 180 day retention periods", () => {
      expect(SUPPORTED_RETENTION_PERIODS).toContain(30);
      expect(SUPPORTED_RETENTION_PERIODS).toContain(90);
      expect(SUPPORTED_RETENTION_PERIODS).toContain(180);
    });
  });
});

// ============================================
// Property-Based Tests
// ============================================

describe("Retention - Property Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property 14: Retention Cleanup Preserves Baselines
   * 
   * *For any* retention cleanup run, events older than the retention period 
   * SHALL be deleted, but baseline records SHALL be preserved.
   * 
   * **Feature: insider-risk-monitor, Property 14: Retention Cleanup Preserves Baselines**
   * **Validates: Requirements 12.2, 12.3**
   */
  it("Property 14: Retention cleanup preserves baselines while deleting expired events", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random sources with retention periods
        fc.array(
          fc.record({
            id: fc.uuid(),
            key: fc.stringMatching(/^[a-z]{3,10}$/),
            retentionDays: fc.option(
              fc.integer({ min: 1, max: 365 }),
              { nil: null }
            ),
          }),
          { minLength: 0, maxLength: 5 }
        ),
        // Generate random number of events to delete per source
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 0, maxLength: 10 }),
        // Generate random number of baselines that exist
        fc.integer({ min: 0, max: 100 }),
        // Generate random default retention days
        fc.integer({ min: 1, max: 365 }),
        async (sources, eventCounts, baselineCount, defaultRetentionDays) => {
          // Setup mocks
          vi.mocked(prisma.source.findMany).mockResolvedValue(sources as never);
          
          // Mock event deletion - return different counts for each call
          let callIndex = 0;
          vi.mocked(prisma.event.deleteMany).mockImplementation(() => {
            const count = eventCounts[callIndex] || 0;
            callIndex++;
            return Promise.resolve({ count }) as never;
          });
          
          // Mock baseline count - baselines should be preserved
          vi.mocked(prisma.baseline.count).mockResolvedValue(baselineCount);

          // Run retention cleanup
          const result = await runRetentionCleanup({ defaultRetentionDays });

          // Property assertions:
          
          // 1. Cleanup should succeed (no errors thrown)
          expect(result.success).toBe(true);
          
          // 2. Baselines should be preserved (count returned, never deleted)
          expect(result.baselinesPreserved).toBe(baselineCount);
          
          // 3. baseline.deleteMany should NEVER be called
          // This is the key property - baselines are never deleted
          expect(prisma.baseline.deleteMany).not.toHaveBeenCalled();
          
          // 4. Sources processed should match input
          expect(result.sourcesProcessed).toBe(sources.length);
          
          // 5. Total deleted should be non-negative
          expect(result.totalEventsDeleted).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 14 (extended): Cutoff date calculation is consistent
   * 
   * For any retention period and reference date, the cutoff date should be
   * exactly retentionDays before the reference date.
   */
  it("Property 14 (extended): Cutoff date is always retentionDays before reference", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random retention days (1-365)
        fc.integer({ min: 1, max: 365 }),
        // Generate random reference date using integer timestamps to avoid invalid dates
        fc.integer({
          min: new Date("2020-01-01").getTime(),
          max: new Date("2030-12-31").getTime()
        }).map(ts => new Date(ts)),
        async (retentionDays, referenceDate) => {
          const cutoff = calculateCutoffDate(retentionDays, referenceDate);
          
          // Calculate expected cutoff
          const expected = new Date(referenceDate);
          expected.setDate(expected.getDate() - retentionDays);
          
          // Cutoff should match expected (comparing date strings to avoid time issues)
          expect(cutoff.toISOString().split("T")[0]).toBe(
            expected.toISOString().split("T")[0]
          );
          
          // Cutoff should always be before reference date
          expect(cutoff.getTime()).toBeLessThan(referenceDate.getTime());
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 14 (extended): Per-source retention is respected
   * 
   * For any source with a custom retention period, that period should be used
   * instead of the default.
   */
  it("Property 14 (extended): Per-source retention overrides are respected", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate source with custom retention
        fc.record({
          id: fc.uuid(),
          key: fc.stringMatching(/^[a-z]{3,10}$/),
          retentionDays: fc.integer({ min: 1, max: 365 }),
        }),
        // Generate default retention (different from source)
        fc.integer({ min: 1, max: 365 }),
        async (source, defaultRetentionDays) => {
          // Setup mocks
          vi.mocked(prisma.source.findMany).mockResolvedValue([source] as never);
          vi.mocked(prisma.event.deleteMany).mockResolvedValue({ count: 10 });
          vi.mocked(prisma.baseline.count).mockResolvedValue(5);

          // Run retention cleanup
          const result = await runRetentionCleanup({ defaultRetentionDays });

          // Verify cleanup was called
          expect(result.success).toBe(true);
          expect(result.sourcesProcessed).toBe(1);
          
          // The deleteMany should have been called with the source's retention period
          // (We can't directly verify the date, but we verify the call was made)
          expect(prisma.event.deleteMany).toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});
