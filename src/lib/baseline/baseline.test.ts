/**
 * Property-Based Tests for Baseline Engine
 * Feature: insider-risk-monitor, Property 6: Baseline Computation Produces Valid Record
 * Validates: Requirements 3.1, 3.2, 3.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  computeBaselineFromEvents,
  isValidBaseline,
  getSystemDefaults,
  DEFAULT_WINDOW_DAYS,
} from './index';
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
 * Generate a valid date using timestamp to avoid NaN dates during shrinking
 */
const validDateArbitrary = fc.integer({ 
  min: new Date('2024-01-01').getTime(), 
  max: new Date('2024-12-31').getTime() 
}).map(ts => new Date(ts));

/**
 * Generate a valid Event object for baseline computation
 */
const eventArbitrary: fc.Arbitrary<Event> = fc.record({
  id: fc.uuid(),
  occurredAt: validDateArbitrary,
  ingestedAt: validDateArbitrary,
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

/**
 * Generate a non-empty array of events for a single actor
 * All events will have the same actorId
 */
const eventsForActorArbitrary: fc.Arbitrary<{ actorId: string; events: Event[]; windowDays: number }> = 
  fc.record({
    actorId: actorIdArbitrary,
    windowDays: fc.integer({ min: 1, max: 30 }),
    eventCount: fc.integer({ min: 1, max: 50 }),
  }).chain(({ actorId, windowDays, eventCount }) => 
    fc.array(eventArbitrary, { minLength: eventCount, maxLength: eventCount })
      .map(events => ({
        actorId,
        windowDays,
        // Override actorId in all events to match
        events: events.map(e => ({ ...e, actorId })),
      }))
  );

// ============================================
// Property Tests
// ============================================

describe('Baseline Engine - Property Tests', () => {
  /**
   * Property 6: Baseline Computation Produces Valid Record
   * 
   * For any actor with at least one event in the baseline window,
   * computing their baseline SHALL produce a valid Baseline record
   * with all behavioral metrics populated.
   * 
   * Validates: Requirements 3.1, 3.2, 3.5
   */
  it('Property 6: Baseline computation produces valid record for any actor with events', () => {
    fc.assert(
      fc.property(
        eventsForActorArbitrary,
        ({ actorId, events, windowDays }) => {
          // Compute baseline from events
          const baseline = computeBaselineFromEvents(actorId, events, windowDays);
          
          // Baseline should be valid (Requirement 3.5)
          expect(isValidBaseline(baseline)).toBe(true);
          
          // Verify all required fields are populated (Requirement 3.2)
          expect(baseline.actorId).toBe(actorId);
          expect(baseline.windowDays).toBe(windowDays);
          expect(baseline.computedAt).toBeInstanceOf(Date);
          expect(Array.isArray(baseline.typicalActiveHours)).toBe(true);
          expect(Array.isArray(baseline.knownIpAddresses)).toBe(true);
          expect(Array.isArray(baseline.knownUserAgents)).toBe(true);
          expect(typeof baseline.avgBytesPerDay).toBe('number');
          expect(typeof baseline.avgEventsPerDay).toBe('number');
          expect(typeof baseline.typicalResourceScope).toBe('number');
          expect(typeof baseline.normalFailureRate).toBe('number');
          expect(typeof baseline.eventCount).toBe('number');
          
          // Event count should match input
          expect(baseline.eventCount).toBe(events.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6 (extended): Baseline metrics are within valid ranges
   */
  it('Property 6 (extended): Baseline metrics are within valid ranges', () => {
    fc.assert(
      fc.property(
        eventsForActorArbitrary,
        ({ actorId, events, windowDays }) => {
          const baseline = computeBaselineFromEvents(actorId, events, windowDays);
          
          // Hours should be in valid range (0-23)
          for (const hour of baseline.typicalActiveHours) {
            expect(hour).toBeGreaterThanOrEqual(0);
            expect(hour).toBeLessThanOrEqual(23);
          }
          
          // Failure rate should be between 0 and 1
          expect(baseline.normalFailureRate).toBeGreaterThanOrEqual(0);
          expect(baseline.normalFailureRate).toBeLessThanOrEqual(1);
          
          // Bytes and events per day should be non-negative and not NaN
          expect(Number.isFinite(baseline.avgBytesPerDay)).toBe(true);
          expect(baseline.avgBytesPerDay).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(baseline.avgEventsPerDay)).toBe(true);
          expect(baseline.avgEventsPerDay).toBeGreaterThanOrEqual(0);
          
          // Resource scope should be non-negative
          expect(baseline.typicalResourceScope).toBeGreaterThanOrEqual(0);
          
          // Event count should be non-negative
          expect(baseline.eventCount).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6 (extended): Known IPs extracted correctly
   */
  it('Property 6 (extended): Known IPs are extracted from events', () => {
    fc.assert(
      fc.property(
        eventsForActorArbitrary,
        ({ actorId, events, windowDays }) => {
          const baseline = computeBaselineFromEvents(actorId, events, windowDays);
          
          // All known IPs should come from events
          const eventIps = new Set(events.filter(e => e.ip).map(e => e.ip));
          for (const ip of baseline.knownIpAddresses) {
            expect(eventIps.has(ip)).toBe(true);
          }
          
          // All event IPs should be in known IPs
          for (const event of events) {
            if (event.ip) {
              expect(baseline.knownIpAddresses).toContain(event.ip);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6 (extended): Failure rate calculation is correct
   */
  it('Property 6 (extended): Failure rate matches actual failure proportion', () => {
    fc.assert(
      fc.property(
        eventsForActorArbitrary,
        ({ actorId, events, windowDays }) => {
          const baseline = computeBaselineFromEvents(actorId, events, windowDays);
          
          // Calculate expected failure rate
          const failureCount = events.filter(e => e.outcome === 'failure').length;
          const expectedFailureRate = events.length > 0 ? failureCount / events.length : 0;
          
          // Should match computed failure rate
          expect(baseline.normalFailureRate).toBeCloseTo(expectedFailureRate, 10);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6 (extended): Resource scope counts distinct resources
   */
  it('Property 6 (extended): Resource scope counts distinct resources correctly', () => {
    fc.assert(
      fc.property(
        eventsForActorArbitrary,
        ({ actorId, events, windowDays }) => {
          const baseline = computeBaselineFromEvents(actorId, events, windowDays);
          
          // Calculate expected distinct resources
          const distinctResources = new Set(events.filter(e => e.resourceId).map(e => e.resourceId));
          
          // Should match computed scope
          expect(baseline.typicalResourceScope).toBe(distinctResources.size);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * System defaults should be valid
   */
  it('System defaults produce valid baseline', () => {
    const defaults = getSystemDefaults();
    expect(isValidBaseline(defaults)).toBe(true);
    
    // Verify default values are reasonable
    expect(defaults.actorId).toBe('system_default');
    expect(defaults.windowDays).toBe(DEFAULT_WINDOW_DAYS);
    expect(defaults.typicalActiveHours.length).toBeGreaterThan(0);
    expect(defaults.avgBytesPerDay).toBeGreaterThan(0);
    expect(defaults.avgEventsPerDay).toBeGreaterThan(0);
    expect(defaults.normalFailureRate).toBeGreaterThanOrEqual(0);
    expect(defaults.normalFailureRate).toBeLessThanOrEqual(1);
  });

  /**
   * Empty events array produces valid baseline with zero metrics
   */
  it('Empty events array produces valid baseline with zero metrics', () => {
    fc.assert(
      fc.property(
        actorIdArbitrary,
        fc.integer({ min: 1, max: 30 }),
        (actorId, windowDays) => {
          const baseline = computeBaselineFromEvents(actorId, [], windowDays);
          
          // Should still be valid
          expect(isValidBaseline(baseline)).toBe(true);
          
          // Metrics should be zero or empty
          expect(baseline.eventCount).toBe(0);
          expect(baseline.typicalActiveHours).toEqual([]);
          expect(baseline.knownIpAddresses).toEqual([]);
          expect(baseline.knownUserAgents).toEqual([]);
          expect(baseline.avgBytesPerDay).toBe(0);
          expect(baseline.avgEventsPerDay).toBe(0);
          expect(baseline.typicalResourceScope).toBe(0);
          expect(baseline.normalFailureRate).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
