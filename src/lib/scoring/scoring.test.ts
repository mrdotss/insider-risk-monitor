/**
 * Property-Based Tests for Scoring Engine
 * Feature: insider-risk-monitor
 * 
 * Property 7: Risk Score Range Invariant
 * Property 8: Score Includes Rule Contributions
 * Property 9: Scoring Determinism
 * 
 * Validates: Requirements 4.1, 4.3, 4.4, 4.6
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  scoreActor,
  isValidRiskScore,
  contributionsSumToTotal,
  riskScoresEqual,
  MAX_SCORE,
  MIN_SCORE,
  getDefaultRules,
} from './index';
import { ActorBaseline, getSystemDefaults } from '@/lib/baseline';
import { Event, ActorType, Outcome } from '@/types';

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
const ipArbitrary = fc.tuple(
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 })
).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/**
 * Generate a valid user agent string
 */
const userAgentArbitrary = fc.stringMatching(/^[a-zA-Z0-9\/\.\s\(\);,-]{10,50}$/);

/**
 * Generate a valid action type
 */
const actionTypeArbitrary = fc.constantFrom(
  'login', 'logout', 'read', 'write', 'download',
  'upload', 'query', 'admin_change', 'delete', 'create'
);

/**
 * Generate a valid actor type
 */
const actorTypeArbitrary: fc.Arbitrary<ActorType> = fc.constantFrom('employee', 'service') as fc.Arbitrary<ActorType>;

/**
 * Generate a valid outcome
 */
const outcomeArbitrary: fc.Arbitrary<Outcome> = fc.constantFrom('success', 'failure') as fc.Arbitrary<Outcome>;

/**
 * Generate a valid hour (0-23)
 */
const hourArbitrary = fc.integer({ min: 0, max: 23 });

/**
 * Generate a reference time for deterministic testing
 */
const referenceTimeArbitrary = fc.integer({
  min: new Date('2024-06-01').getTime(),
  max: new Date('2024-06-30').getTime()
}).map(ts => new Date(ts));

/**
 * Generate a valid Event object within a time window relative to reference time
 * Events are generated within the last 24 hours of the reference time
 */
const eventArbitraryWithinWindow = (referenceTime: Date): fc.Arbitrary<Event> => {
  const refTime = referenceTime.getTime();
  // Events within last 24 hours (1440 minutes - max rule window)
  const minTime = refTime - 24 * 60 * 60 * 1000;
  
  return fc.record({
    id: fc.uuid(),
    occurredAt: fc.integer({ min: minTime, max: refTime }).map(ts => new Date(ts)),
    ingestedAt: fc.integer({ min: minTime, max: refTime }).map(ts => new Date(ts)),
    actorId: actorIdArbitrary,
    actorType: actorTypeArbitrary,
    sourceId: fc.uuid(),
    actionType: actionTypeArbitrary,
    resourceType: fc.option(fc.stringMatching(/^[a-z_]{3,20}$/), { nil: null }),
    resourceId: fc.option(fc.uuid(), { nil: null }),
    outcome: outcomeArbitrary,
    ip: fc.option(ipArbitrary, { nil: null }),
    userAgent: fc.option(userAgentArbitrary, { nil: null }),
    bytes: fc.option(fc.integer({ min: 0, max: 1000000000 }), { nil: null }),
    metadata: fc.constant({}),
  }) as fc.Arbitrary<Event>;
};

/**
 * Generate a valid ActorBaseline
 */
const baselineArbitrary: fc.Arbitrary<ActorBaseline> = fc.record({
  actorId: actorIdArbitrary,
  computedAt: referenceTimeArbitrary,
  windowDays: fc.integer({ min: 7, max: 30 }),
  typicalActiveHours: fc.array(hourArbitrary, { minLength: 0, maxLength: 12 })
    .map(hours => [...new Set(hours)].sort((a, b) => a - b)),
  knownIpAddresses: fc.array(ipArbitrary, { minLength: 0, maxLength: 10 })
    .map(ips => [...new Set(ips)]),
  knownUserAgents: fc.array(userAgentArbitrary, { minLength: 0, maxLength: 5 })
    .map(uas => [...new Set(uas)]),
  avgBytesPerDay: fc.integer({ min: 0, max: 100000000 }),
  avgEventsPerDay: fc.integer({ min: 0, max: 1000 }),
  typicalResourceScope: fc.integer({ min: 0, max: 100 }),
  normalFailureRate: fc.float({ min: 0, max: 1, noNaN: true }),
  eventCount: fc.integer({ min: 0, max: 10000 }),
  firstSeen: fc.option(referenceTimeArbitrary, { nil: null }),
  lastSeen: fc.option(referenceTimeArbitrary, { nil: null }),
});

/**
 * Generate scoring test data: actorId, baseline, events, and reference time
 * All events have the same actorId as the baseline
 */
const scoringTestDataArbitrary = referenceTimeArbitrary.chain(referenceTime =>
  fc.record({
    actorId: actorIdArbitrary,
    baseline: baselineArbitrary,
    events: fc.array(eventArbitraryWithinWindow(referenceTime), { minLength: 0, maxLength: 30 }),
    referenceTime: fc.constant(referenceTime),
  }).map(({ actorId, baseline, events, referenceTime }) => ({
    actorId,
    baseline: { ...baseline, actorId },
    events: events.map(e => ({ ...e, actorId })),
    referenceTime,
  }))
);

// ============================================
// Property Tests
// ============================================

describe('Scoring Engine - Property Tests', () => {
  /**
   * Property 7: Risk Score Range Invariant
   * 
   * For any actor and any combination of rule evaluations,
   * the computed risk score SHALL be in the range 0-100 inclusive.
   * 
   * Validates: Requirements 4.1
   */
  it('Property 7: Risk score is always in range 0-100', () => {
    fc.assert(
      fc.property(
        scoringTestDataArbitrary,
        ({ actorId, baseline, events, referenceTime }) => {
          const result = scoreActor(actorId, baseline, events, { referenceTime });
          
          // Score must be in valid range
          expect(result.totalScore).toBeGreaterThanOrEqual(MIN_SCORE);
          expect(result.totalScore).toBeLessThanOrEqual(MAX_SCORE);
          
          // Score must be an integer
          expect(Number.isInteger(result.totalScore)).toBe(true);
          
          // Validate using helper function
          expect(isValidRiskScore(result)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7 (extended): Score is capped even with extreme rule contributions
   */
  it('Property 7 (extended): Score is capped at 100 even with many rule triggers', () => {
    fc.assert(
      fc.property(
        scoringTestDataArbitrary,
        ({ actorId, baseline, events, referenceTime }) => {
          // Create a baseline that will trigger many rules
          const extremeBaseline: ActorBaseline = {
            ...baseline,
            actorId,
            typicalActiveHours: [9, 10, 11, 12, 13, 14, 15, 16, 17], // Business hours only
            knownIpAddresses: [], // No known IPs - any IP is new
            avgBytesPerDay: 1000, // Very low baseline - easy to spike
            typicalResourceScope: 1, // Very narrow scope - easy to expand
            normalFailureRate: 0, // No failures expected
          };
          
          const result = scoreActor(actorId, extremeBaseline, events, { referenceTime });
          
          // Even with extreme baseline, score must be capped
          expect(result.totalScore).toBeLessThanOrEqual(MAX_SCORE);
          expect(result.totalScore).toBeGreaterThanOrEqual(MIN_SCORE);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 8: Score Includes Rule Contributions
   * 
   * For any computed risk score, the score SHALL include a list of rule
   * contributions that sum to the total score (capped at 100), with each
   * contribution including rule name, points, reason, and baseline comparison.
   * 
   * Validates: Requirements 4.3, 4.4
   */
  it('Property 8: Score includes rule contributions that sum to total', () => {
    fc.assert(
      fc.property(
        scoringTestDataArbitrary,
        ({ actorId, baseline, events, referenceTime }) => {
          const result = scoreActor(actorId, baseline, events, { referenceTime });
          
          // Contributions must sum to total (capped at 100)
          expect(contributionsSumToTotal(result)).toBe(true);
          
          // Each contribution must have required fields
          for (const contribution of result.ruleContributions) {
            expect(contribution.ruleId).toBeTruthy();
            expect(contribution.ruleName).toBeTruthy();
            expect(typeof contribution.points).toBe('number');
            expect(contribution.points).toBeGreaterThanOrEqual(0);
            expect(contribution.reason).toBeTruthy();
            expect(contribution.currentValue !== undefined).toBe(true);
            expect(contribution.baselineValue !== undefined).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 8 (extended): Baseline values are included in output
   */
  it('Property 8 (extended): Baseline values are included in output', () => {
    fc.assert(
      fc.property(
        scoringTestDataArbitrary,
        ({ actorId, baseline, events, referenceTime }) => {
          const result = scoreActor(actorId, baseline, events, { referenceTime });
          
          // Baseline must be included (Requirement 4.4)
          expect(result.baselineUsed).toBeDefined();
          expect(result.baselineUsed.actorId).toBe(actorId);
          
          // Baseline should match input baseline
          expect(result.baselineUsed.typicalActiveHours).toEqual(baseline.typicalActiveHours);
          expect(result.baselineUsed.knownIpAddresses).toEqual(baseline.knownIpAddresses);
          expect(result.baselineUsed.avgBytesPerDay).toBe(baseline.avgBytesPerDay);
          expect(result.baselineUsed.typicalResourceScope).toBe(baseline.typicalResourceScope);
          expect(result.baselineUsed.normalFailureRate).toBe(baseline.normalFailureRate);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 9: Scoring Determinism
   * 
   * For any actor, baseline, and set of events, computing the risk score
   * multiple times with the same inputs SHALL produce identical results.
   * 
   * Validates: Requirements 4.6
   */
  it('Property 9: Scoring is deterministic - same inputs produce identical results', () => {
    fc.assert(
      fc.property(
        scoringTestDataArbitrary,
        ({ actorId, baseline, events, referenceTime }) => {
          const rules = getDefaultRules();
          const options = { referenceTime, rules };
          
          // Score the same actor multiple times
          const result1 = scoreActor(actorId, baseline, events, options);
          const result2 = scoreActor(actorId, baseline, events, options);
          const result3 = scoreActor(actorId, baseline, events, options);
          
          // All results must be identical
          expect(riskScoresEqual(result1, result2)).toBe(true);
          expect(riskScoresEqual(result2, result3)).toBe(true);
          expect(riskScoresEqual(result1, result3)).toBe(true);
          
          // Verify specific fields match
          expect(result1.totalScore).toBe(result2.totalScore);
          expect(result1.totalScore).toBe(result3.totalScore);
          expect(result1.ruleContributions.length).toBe(result2.ruleContributions.length);
          expect(result1.triggeringEventIds.length).toBe(result2.triggeringEventIds.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 9 (extended): Order of events doesn't affect determinism
   */
  it('Property 9 (extended): Scoring produces same result regardless of event order', () => {
    fc.assert(
      fc.property(
        scoringTestDataArbitrary.filter(d => d.events.length >= 2),
        ({ actorId, baseline, events, referenceTime }) => {
          const rules = getDefaultRules();
          const options = { referenceTime, rules };
          
          // Score with original order
          const result1 = scoreActor(actorId, baseline, events, options);
          
          // Score with reversed order
          const reversedEvents = [...events].reverse();
          const result2 = scoreActor(actorId, baseline, reversedEvents, options);
          
          // Total score should be the same
          expect(result1.totalScore).toBe(result2.totalScore);
          
          // Rule contributions should be the same (same rules triggered)
          expect(result1.ruleContributions.length).toBe(result2.ruleContributions.length);
          
          // Same rules should trigger with same points
          const rules1 = new Map(result1.ruleContributions.map(c => [c.ruleId, c.points]));
          const rules2 = new Map(result2.ruleContributions.map(c => [c.ruleId, c.points]));
          
          for (const [ruleId, points] of rules1) {
            expect(rules2.get(ruleId)).toBe(points);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional test: Empty events produce zero score
   */
  it('Empty events array produces zero score with no contributions', () => {
    fc.assert(
      fc.property(
        actorIdArbitrary,
        baselineArbitrary,
        referenceTimeArbitrary,
        (actorId, baseline, referenceTime) => {
          const result = scoreActor(actorId, { ...baseline, actorId }, [], { referenceTime });
          
          // No events means no rules can trigger
          expect(result.totalScore).toBe(0);
          expect(result.ruleContributions).toEqual([]);
          expect(result.triggeringEventIds).toEqual([]);
          
          // Result should still be valid
          expect(isValidRiskScore(result)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional test: System defaults produce valid baseline for scoring
   */
  it('System defaults produce valid scoring results', () => {
    fc.assert(
      fc.property(
        actorIdArbitrary,
        referenceTimeArbitrary,
        fc.array(eventArbitraryWithinWindow(new Date()), { minLength: 0, maxLength: 20 }),
        (actorId, referenceTime, events) => {
          const defaults = getSystemDefaults();
          const baseline: ActorBaseline = { ...defaults, actorId };
          const eventsWithActor = events.map(e => ({ ...e, actorId }));
          
          const result = scoreActor(actorId, baseline, eventsWithActor, { referenceTime });
          
          // Result should be valid
          expect(isValidRiskScore(result)).toBe(true);
          expect(result.totalScore).toBeGreaterThanOrEqual(MIN_SCORE);
          expect(result.totalScore).toBeLessThanOrEqual(MAX_SCORE);
        }
      ),
      { numRuns: 100 }
    );
  });
});
