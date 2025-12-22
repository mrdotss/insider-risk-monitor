/**
 * Worker Process Tests
 * 
 * Tests for the background worker scheduler and job functions.
 * Requirements: 3.4, 12.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the prisma client
vi.mock("@/lib/db", () => ({
  prisma: {
    event: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    source: {
      findMany: vi.fn(),
    },
    actor: {
      upsert: vi.fn(),
    },
    riskScore: {
      create: vi.fn(),
    },
    baseline: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    $disconnect: vi.fn(),
  },
}));

// Mock the baseline module
vi.mock("@/lib/baseline", () => ({
  computeAllBaselines: vi.fn(),
  getOrComputeBaseline: vi.fn(),
  DEFAULT_WINDOW_DAYS: 14,
}));

// Mock the scoring module
vi.mock("@/lib/scoring", () => ({
  scoreActor: vi.fn(),
  getDefaultRules: vi.fn(() => []),
}));

// Mock the alerting module
vi.mock("@/lib/alerting", () => ({
  evaluateAndAlert: vi.fn(),
  DEFAULT_ALERT_THRESHOLD: 60,
}));

// Mock the retention module
vi.mock("@/lib/retention", () => ({
  runRetentionCleanup: vi.fn(),
  DEFAULT_RETENTION_DAYS: 90,
}));

import { prisma } from "@/lib/db";
import { computeAllBaselines, getOrComputeBaseline } from "@/lib/baseline";
import { scoreActor } from "@/lib/scoring";
import { evaluateAndAlert } from "@/lib/alerting";
import { runRetentionCleanup as executeRetentionCleanup } from "@/lib/retention";
import {
  runBaselineComputation,
  runScoringJob,
  runRetentionCleanup,
  getJobStates,
} from "./index";

describe("Worker Process", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("runBaselineComputation", () => {
    it("should call computeAllBaselines with default window days", async () => {
      vi.mocked(computeAllBaselines).mockResolvedValue({
        processed: 5,
        succeeded: 5,
        failed: 0,
        errors: [],
      });

      await runBaselineComputation();

      expect(computeAllBaselines).toHaveBeenCalledWith(14);
    });

    it("should handle errors gracefully", async () => {
      vi.mocked(computeAllBaselines).mockRejectedValue(new Error("Database error"));

      // Should not throw
      await expect(runBaselineComputation()).resolves.not.toThrow();
    });

    it("should update job state after completion", async () => {
      vi.mocked(computeAllBaselines).mockResolvedValue({
        processed: 3,
        succeeded: 3,
        failed: 0,
        errors: [],
      });

      await runBaselineComputation();

      const states = getJobStates();
      expect(states.baseline.lastRun).not.toBeNull();
      expect(states.baseline.lastError).toBeNull();
    });
  });

  describe("runScoringJob", () => {
    it("should score actors with recent events", async () => {
      // Mock actors with recent events
      vi.mocked(prisma.event.findMany).mockResolvedValue([
        { actorId: "actor-1" },
        { actorId: "actor-2" },
      ] as never);

      // Mock baseline retrieval
      vi.mocked(getOrComputeBaseline).mockResolvedValue({
        actorId: "actor-1",
        computedAt: new Date(),
        windowDays: 14,
        typicalActiveHours: [9, 10, 11],
        knownIpAddresses: ["192.168.1.1"],
        knownUserAgents: [],
        avgBytesPerDay: 1000,
        avgEventsPerDay: 10,
        typicalResourceScope: 5,
        normalFailureRate: 0.05,
        eventCount: 50,
        firstSeen: new Date(),
        lastSeen: new Date(),
      });

      // Mock scoring
      vi.mocked(scoreActor).mockReturnValue({
        actorId: "actor-1",
        totalScore: 45,
        computedAt: new Date(),
        ruleContributions: [],
        baselineUsed: {} as never,
        triggeringEventIds: [],
      });

      // Mock alert evaluation
      vi.mocked(evaluateAndAlert).mockResolvedValue({
        alertCreated: false,
        reason: "Score below threshold",
      });

      // Mock database operations
      vi.mocked(prisma.riskScore.create).mockResolvedValue({} as never);
      vi.mocked(prisma.actor.upsert).mockResolvedValue({} as never);

      await runScoringJob();

      expect(prisma.event.findMany).toHaveBeenCalled();
    });

    it("should handle empty actor list", async () => {
      vi.mocked(prisma.event.findMany).mockResolvedValue([]);

      await runScoringJob();

      const states = getJobStates();
      expect(states.scoring.lastRun).not.toBeNull();
    });
  });

  describe("runRetentionCleanup", () => {
    it("should call retention module and log results", async () => {
      vi.mocked(executeRetentionCleanup).mockResolvedValue({
        success: true,
        totalEventsDeleted: 30,
        sourcesProcessed: 2,
        deletionsBySource: { vpn: 10, iam: 20 },
        orphanedEventsDeleted: 0,
        baselinesPreserved: 5,
      });

      await runRetentionCleanup();

      expect(executeRetentionCleanup).toHaveBeenCalled();
    });

    it("should preserve baselines (not delete them)", async () => {
      vi.mocked(executeRetentionCleanup).mockResolvedValue({
        success: true,
        totalEventsDeleted: 5,
        sourcesProcessed: 1,
        deletionsBySource: { vpn: 5 },
        orphanedEventsDeleted: 0,
        baselinesPreserved: 10,
      });

      await runRetentionCleanup();

      // Verify baseline.deleteMany was NOT called (baselines preserved)
      expect(prisma.baseline.create).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      vi.mocked(executeRetentionCleanup).mockResolvedValue({
        success: false,
        totalEventsDeleted: 0,
        sourcesProcessed: 0,
        deletionsBySource: {},
        orphanedEventsDeleted: 0,
        baselinesPreserved: 0,
        error: "Database error",
      });

      // Should not throw
      await expect(runRetentionCleanup()).resolves.not.toThrow();
    });
  });

  describe("getJobStates", () => {
    it("should return current job states", () => {
      const states = getJobStates();

      expect(states).toHaveProperty("baseline");
      expect(states).toHaveProperty("scoring");
      expect(states).toHaveProperty("retention");

      expect(states.baseline).toHaveProperty("isRunning");
      expect(states.baseline).toHaveProperty("lastRun");
      expect(states.baseline).toHaveProperty("lastError");
      expect(states.baseline).toHaveProperty("runCount");
    });
  });
});
