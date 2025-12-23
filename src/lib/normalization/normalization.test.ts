/**
 * Property-Based Tests for Normalization Engine
 * Feature: insider-risk-monitor, Property 4: Normalization Round-Trip
 * Validates: Requirements 2.1, 2.3, 2.4, 2.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  normalizeEvent,
  serializeEvent,
  deserializeEvent,
  isValidNormalizedEvent,
  RawEvent,
} from './index';
import { Source } from '@/types';

// ============================================
// Arbitraries (Generators)
// ============================================

/**
 * Generate a valid Source object for testing
 */
/**
 * Generate a hex string of specified length
 */
const hexStringArbitrary = (length: number) =>
  fc.array(fc.integer({ min: 0, max: 15 }), { minLength: length, maxLength: length })
    .map(arr => arr.map(n => n.toString(16)).join(''));

const sourceArbitrary = fc.record({
  id: fc.uuid(),
  key: fc.stringMatching(/^[a-z]{3,10}$/),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  description: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
  apiKeyHash: hexStringArbitrary(64),
  enabled: fc.boolean(),
  redactResourceId: fc.boolean(),
  retentionDays: fc.integer({ min: 30, max: 365 }),
  rateLimit: fc.integer({ min: 100, max: 10000 }),
  createdAt: fc.date(),
  updatedAt: fc.date(),
}) as fc.Arbitrary<Source>;

/**
 * Generate a valid actor ID (non-empty string)
 */
const actorIdArbitrary = fc.stringMatching(/^[a-zA-Z0-9._@-]{1,50}$/);

/**
 * Generate a valid action type
 */
const actionTypeArbitrary = fc.constantFrom(
  'login',
  'logout',
  'read',
  'write',
  'download',
  'upload',
  'query',
  'admin_change',
  'delete',
  'create'
);

/**
 * Generate a valid actor type
 */
const actorTypeArbitrary = fc.constantFrom('employee', 'service');

/**
 * Generate a valid outcome
 */
const outcomeArbitrary = fc.constantFrom('success', 'failure');

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
const userAgentArbitrary = fc.stringMatching(/^[a-zA-Z0-9\/\.\s\(\);,-]{10,100}$/);

/**
 * Generate a valid timestamp as ISO string
 * Uses integer-based date generation to avoid invalid date issues
 */
const validTimestampArbitrary = fc.integer({
  min: new Date('2020-01-01').getTime(),
  max: new Date('2030-01-01').getTime()
}).map(ts => new Date(ts).toISOString());

/**
 * Generate a valid raw event with all required fields
 * This ensures the raw event will successfully normalize
 */
const validRawEventArbitrary: fc.Arbitrary<RawEvent> = fc.record({
  // Required fields - at least one actor identifier
  actorId: actorIdArbitrary,
  // Required fields - at least one action type
  actionType: actionTypeArbitrary,
  // Required fields - timestamp
  timestamp: validTimestampArbitrary,
  // Optional fields
  actorType: fc.option(actorTypeArbitrary, { nil: undefined }),
  resourceType: fc.option(fc.stringMatching(/^[a-z_]{3,20}$/), { nil: undefined }),
  resourceId: fc.option(fc.uuid(), { nil: undefined }),
  ip: fc.option(ipArbitrary, { nil: undefined }),
  userAgent: fc.option(userAgentArbitrary, { nil: undefined }),
  bytes: fc.option(fc.integer({ min: 0, max: 1000000000 }), { nil: undefined }),
  outcome: fc.option(outcomeArbitrary, { nil: undefined }),
});

/**
 * Generate raw events using alternative field names
 * Tests that normalization handles various source formats
 */
const alternativeFieldRawEventArbitrary: fc.Arbitrary<RawEvent> = fc.oneof(
  // Using 'user' instead of 'actorId'
  fc.record({
    user: actorIdArbitrary,
    action: actionTypeArbitrary,
    occurredAt: validTimestampArbitrary,
    success: fc.option(fc.boolean(), { nil: undefined }),
    ipAddress: fc.option(ipArbitrary, { nil: undefined }),
    bytesTransferred: fc.option(fc.integer({ min: 0, max: 1000000000 }), { nil: undefined }),
  }),
  // Using 'userId' and 'type'
  fc.record({
    userId: actorIdArbitrary,
    type: actionTypeArbitrary,
    timestamp: validTimestampArbitrary,
    resource: fc.option(fc.uuid(), { nil: undefined }),
  }),
  // Using 'actor' field
  fc.record({
    actor: actorIdArbitrary,
    actionType: actionTypeArbitrary,
    timestamp: validTimestampArbitrary,
  })
);

// ============================================
// Property Tests
// ============================================

describe('Normalization Engine - Property Tests', () => {
  /**
   * Property 4: Normalization Round-Trip
   * 
   * For any valid raw event, normalizing it to the Event schema and then
   * serializing back to JSON SHALL produce a valid, complete Event record
   * with all required fields.
   * 
   * Validates: Requirements 2.1, 2.3, 2.4, 2.5
   */
  it('Property 4: Normalization round-trip produces valid Event record', () => {
    fc.assert(
      fc.property(
        validRawEventArbitrary,
        sourceArbitrary,
        (rawEvent, source) => {
          // Step 1: Normalize the raw event
          const result = normalizeEvent(rawEvent, source);
          
          // Normalization should succeed for valid raw events
          expect(result.success).toBe(true);
          expect(result.event).toBeDefined();
          
          if (!result.event) return;
          
          // Step 2: Validate the normalized event has all required fields (Req 2.1)
          expect(isValidNormalizedEvent(result.event)).toBe(true);
          
          // Step 3: Serialize to JSON
          const serialized = serializeEvent(result.event);
          expect(typeof serialized).toBe('string');
          expect(serialized.length).toBeGreaterThan(0);
          
          // Step 4: Deserialize back
          const deserialized = deserializeEvent(serialized);
          
          // Step 5: Verify round-trip produces equivalent event (Req 2.5)
          expect(deserialized.id).toBe(result.event.id);
          expect(deserialized.actorId).toBe(result.event.actorId);
          expect(deserialized.actorType).toBe(result.event.actorType);
          expect(deserialized.sourceId).toBe(result.event.sourceId);
          expect(deserialized.actionType).toBe(result.event.actionType);
          expect(deserialized.outcome).toBe(result.event.outcome);
          expect(deserialized.occurredAt.getTime()).toBe(result.event.occurredAt.getTime());
          expect(deserialized.ingestedAt.getTime()).toBe(result.event.ingestedAt.getTime());
          
          // Optional fields should match (Req 2.3 - null for missing)
          expect(deserialized.ip).toBe(result.event.ip);
          expect(deserialized.userAgent).toBe(result.event.userAgent);
          expect(deserialized.bytes).toBe(result.event.bytes);
          expect(deserialized.resourceType).toBe(result.event.resourceType);
          expect(deserialized.resourceId).toBe(result.event.resourceId);
          
          // Metadata should be preserved (Req 2.4)
          expect(deserialized.metadata).toEqual(result.event.metadata);
          
          // Deserialized event should also be valid
          expect(isValidNormalizedEvent(deserialized)).toBe(true);
        }
      ),
      { numRuns: 100 } // Minimum 100 iterations as per design spec
    );
  });

  /**
   * Additional property: Alternative field names normalize correctly
   * Tests that various source formats are handled properly
   */
  it('Property 4 (extended): Alternative field names normalize to valid events', () => {
    fc.assert(
      fc.property(
        alternativeFieldRawEventArbitrary,
        sourceArbitrary,
        (rawEvent, source) => {
          const result = normalizeEvent(rawEvent, source);
          
          // Should successfully normalize
          expect(result.success).toBe(true);
          expect(result.event).toBeDefined();
          
          if (!result.event) return;
          
          // Should produce valid normalized event
          expect(isValidNormalizedEvent(result.event)).toBe(true);
          
          // Round-trip should work
          const serialized = serializeEvent(result.event);
          const deserialized = deserializeEvent(serialized);
          expect(isValidNormalizedEvent(deserialized)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Metadata preservation
   * Extra fields in raw event should be preserved in metadata (Req 2.4)
   */
  it('Property 4 (metadata): Extra fields are preserved in metadata', () => {
    fc.assert(
      fc.property(
        validRawEventArbitrary,
        sourceArbitrary,
        fc.dictionary(
          fc.stringMatching(/^extra_[a-z]{3,10}$/),
          fc.oneof(fc.string(), fc.integer(), fc.boolean())
        ),
        (rawEvent, source, extraFields) => {
          // Add extra fields to raw event
          const rawWithExtras: RawEvent = { ...rawEvent, ...extraFields };
          
          const result = normalizeEvent(rawWithExtras, source);
          
          expect(result.success).toBe(true);
          expect(result.event).toBeDefined();
          
          if (!result.event) return;
          
          // Extra fields should be in metadata
          for (const [key, value] of Object.entries(extraFields)) {
            expect(result.event.metadata[key]).toBe(value);
          }
          
          // Round-trip should preserve metadata
          const serialized = serializeEvent(result.event);
          const deserialized = deserializeEvent(serialized);
          
          for (const [key, value] of Object.entries(extraFields)) {
            expect(deserialized.metadata[key]).toBe(value);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
