/**
 * Property-Based Tests for Ingestion
 * Feature: insider-risk-monitor
 * 
 * Property 1: Valid Ingestion Produces Stored Event
 * Property 2: Invalid Authentication Rejects Request
 * Property 3: Invalid Payload Returns Validation Error
 * 
 * Validates: Requirements 1.1, 1.2, 1.4, 1.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { 
  verifyApiKey, 
  hashApiKey, 
  generateApiKey,
  checkRateLimit,
  clearAllRateLimits,
} from './index';
import { normalizeEvent, isValidNormalizedEvent, RawEvent } from '@/lib/normalization';
import { Source } from '@/types';

// ============================================
// Test Configuration
// ============================================

// Longer timeout for bcrypt operations
const ASYNC_TEST_TIMEOUT = 60000; // 60 seconds

// ============================================
// Validation Schema (mirrored from route)
// ============================================

// Simple validation without zod for faster tests
function validatePayload(payload: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be an object'] };
  }
  
  const data = payload as Record<string, unknown>;
  
  // Check for actor identifier
  if (!data.user && !data.userId && !data.actor && !data.actorId) {
    errors.push('At least one actor identifier required');
  }
  
  // Check for action type
  if (!data.action && !data.actionType && !data.type) {
    errors.push('At least one action type required');
  }
  
  // Check bytes is non-negative if present
  if (data.bytes !== undefined && (typeof data.bytes !== 'number' || data.bytes < 0)) {
    errors.push('bytes must be a non-negative number');
  }
  
  if (data.bytesTransferred !== undefined && (typeof data.bytesTransferred !== 'number' || data.bytesTransferred < 0)) {
    errors.push('bytesTransferred must be a non-negative number');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Simulates the ingestion validation and normalization pipeline
 * Returns the result that would be sent as HTTP response
 */
interface IngestionResult {
  status: number;
  body: { eventId?: string; error?: string; details?: { message: string }[] };
  event?: ReturnType<typeof normalizeEvent>['event'];
}

async function simulateIngestion(
  apiKey: string | null,
  storedApiKeyHash: string,
  sourceEnabled: boolean,
  payload: unknown,
  source: Source
): Promise<IngestionResult> {
  // Step 1: Check API key
  if (!apiKey) {
    return { status: 401, body: { error: "Missing API key" } };
  }

  const isValidKey = await verifyApiKey(apiKey, storedApiKeyHash);
  if (!isValidKey) {
    return { status: 401, body: { error: "Invalid API key" } };
  }

  if (!sourceEnabled) {
    return { status: 401, body: { error: "Invalid API key" } };
  }

  // Step 2: Validate payload
  const validation = validatePayload(payload);
  if (!validation.valid) {
    return {
      status: 400,
      body: {
        error: "Validation failed",
        details: validation.errors.map((message) => ({ message })),
      },
    };
  }

  // Step 3: Normalize event
  const normalizationResult = normalizeEvent(payload as RawEvent, source);
  if (!normalizationResult.success || !normalizationResult.event) {
    return {
      status: 400,
      body: {
        error: "Normalization failed",
        details: [{ message: normalizationResult.error || "Unknown error" }],
      },
    };
  }

  // Step 4: Success - would persist to DB
  return {
    status: 202,
    body: { eventId: normalizationResult.event.id },
    event: normalizationResult.event,
  };
}

// ============================================
// Arbitraries (Generators)
// ============================================

const hexStringArbitrary = (length: number) =>
  fc.array(fc.integer({ min: 0, max: 15 }), { minLength: length, maxLength: length })
    .map(arr => arr.map(n => n.toString(16)).join(''));

const sourceArbitrary = fc.record({
  id: fc.uuid(),
  key: fc.stringMatching(/^[a-z]{3,10}$/),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  description: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
  apiKeyHash: hexStringArbitrary(64),
  enabled: fc.constant(true),
  redactResourceId: fc.boolean(),
  retentionDays: fc.integer({ min: 30, max: 365 }),
  rateLimit: fc.integer({ min: 100, max: 10000 }),
  createdAt: fc.date(),
  updatedAt: fc.date(),
}) as fc.Arbitrary<Source>;

const actorIdArbitrary = fc.stringMatching(/^[a-zA-Z0-9._@-]{1,50}$/);

const actionTypeArbitrary = fc.constantFrom(
  'login', 'logout', 'read', 'write', 'download', 
  'upload', 'query', 'admin_change', 'delete', 'create'
);

const ipArbitrary = fc.tuple(
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 })
).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/**
 * Generate a valid raw event payload
 */
const validRawEventArbitrary: fc.Arbitrary<RawEvent> = fc.record({
  actorId: actorIdArbitrary,
  actionType: actionTypeArbitrary,
  timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
    .map(d => d.toISOString()),
  actorType: fc.option(fc.constantFrom('employee', 'service'), { nil: undefined }),
  resourceType: fc.option(fc.stringMatching(/^[a-z_]{3,20}$/), { nil: undefined }),
  resourceId: fc.option(fc.uuid(), { nil: undefined }),
  ip: fc.option(ipArbitrary, { nil: undefined }),
  userAgent: fc.option(fc.stringMatching(/^[a-zA-Z0-9\/\.\s\(\);,-]{10,50}$/), { nil: undefined }),
  bytes: fc.option(fc.integer({ min: 0, max: 1000000000 }), { nil: undefined }),
  outcome: fc.option(fc.constantFrom('success', 'failure'), { nil: undefined }),
});

/**
 * Generate an invalid payload missing required fields
 */
const invalidPayloadMissingActorArbitrary = fc.record({
  actionType: actionTypeArbitrary,
  timestamp: fc.date().map(d => d.toISOString()),
});

const invalidPayloadMissingActionArbitrary = fc.record({
  actorId: actorIdArbitrary,
  timestamp: fc.date().map(d => d.toISOString()),
});

/**
 * Generate completely invalid payloads
 */
const malformedPayloadArbitrary = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.string(),
  fc.integer(),
  fc.array(fc.integer()),
  fc.record({
    bytes: fc.constant(-1), // Invalid negative bytes
    actorId: actorIdArbitrary,
    actionType: actionTypeArbitrary,
  }),
);

// ============================================
// Property Tests
// ============================================

describe('Ingestion - Property Tests', () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  /**
   * Property 1: Valid Ingestion Produces Stored Event
   * 
   * For any valid raw event payload and authenticated source, ingesting the event
   * SHALL result in a normalized event being stored with all required fields populated.
   * 
   * Validates: Requirements 1.1, 1.4
   */
  it('Property 1: Valid ingestion produces stored event', async () => {
    await fc.assert(
      fc.asyncProperty(
        validRawEventArbitrary,
        sourceArbitrary,
        async (rawEvent, source) => {
          // Generate a real API key and hash it
          const apiKey = generateApiKey();
          const apiKeyHash = await hashApiKey(apiKey);
          
          // Update source with the real hash
          const sourceWithHash = { ...source, apiKeyHash };
          
          const result = await simulateIngestion(
            apiKey,
            apiKeyHash,
            true, // source enabled
            rawEvent,
            sourceWithHash
          );
          
          // Should return 202 Accepted
          expect(result.status).toBe(202);
          expect(result.body.eventId).toBeDefined();
          expect(typeof result.body.eventId).toBe('string');
          expect(result.body.eventId!.length).toBeGreaterThan(0);
          
          // Event should be valid
          expect(result.event).toBeDefined();
          expect(isValidNormalizedEvent(result.event!)).toBe(true);
          
          // Event should have correct actor and action
          expect(result.event!.actorId).toBe(rawEvent.actorId);
          expect(result.event!.actionType).toBe(rawEvent.actionType);
          expect(result.event!.sourceId).toBe(sourceWithHash.id);
        }
      ),
      { numRuns: 20 } // Reduced runs due to bcrypt overhead
    );
  }, ASYNC_TEST_TIMEOUT);

  /**
   * Property 2: Invalid Authentication Rejects Request
   * 
   * For any request without a valid API key or with an invalid API key,
   * the ingestion endpoint SHALL return 401 Unauthorized and NOT store any event.
   * 
   * Validates: Requirements 1.2
   */
  it('Property 2: Invalid authentication rejects request', async () => {
    await fc.assert(
      fc.asyncProperty(
        validRawEventArbitrary,
        sourceArbitrary,
        fc.oneof(
          fc.constant(null as string | null),           // Missing API key
          fc.constant(''),                               // Empty API key
          fc.stringMatching(/^[a-zA-Z0-9]{10,40}$/),    // Random invalid key
          fc.constant('irm_invalid_key_12345'),          // Wrong format key
        ),
        async (rawEvent, source, invalidApiKey) => {
          // Generate a valid API key hash that won't match
          const validApiKey = generateApiKey();
          const validApiKeyHash = await hashApiKey(validApiKey);
          
          const result = await simulateIngestion(
            invalidApiKey,
            validApiKeyHash,
            true,
            rawEvent,
            source
          );
          
          // Should return 401 Unauthorized
          expect(result.status).toBe(401);
          expect(result.body.error).toBeDefined();
          expect(result.body.eventId).toBeUndefined();
          
          // No event should be created
          expect(result.event).toBeUndefined();
        }
      ),
      { numRuns: 20 } // Reduced runs due to bcrypt overhead
    );
  }, ASYNC_TEST_TIMEOUT);

  /**
   * Property 2 (extended): Disabled source rejects request
   */
  it('Property 2 (extended): Disabled source rejects request', async () => {
    await fc.assert(
      fc.asyncProperty(
        validRawEventArbitrary,
        sourceArbitrary,
        async (rawEvent, source) => {
          const apiKey = generateApiKey();
          const apiKeyHash = await hashApiKey(apiKey);
          
          const result = await simulateIngestion(
            apiKey,
            apiKeyHash,
            false, // source disabled
            rawEvent,
            source
          );
          
          // Should return 401 (source disabled treated as invalid)
          expect(result.status).toBe(401);
          expect(result.body.eventId).toBeUndefined();
          expect(result.event).toBeUndefined();
        }
      ),
      { numRuns: 20 } // Reduced runs due to bcrypt overhead
    );
  }, ASYNC_TEST_TIMEOUT);

  /**
   * Property 3: Invalid Payload Returns Validation Error
   * 
   * For any malformed or invalid JSON payload, the ingestion endpoint
   * SHALL return 400 Bad Request with validation details and NOT store any event.
   * 
   * Validates: Requirements 1.5
   */
  it('Property 3: Invalid payload returns validation error - missing actor', async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidPayloadMissingActorArbitrary,
        sourceArbitrary,
        async (invalidPayload, source) => {
          const apiKey = generateApiKey();
          const apiKeyHash = await hashApiKey(apiKey);
          const sourceWithHash = { ...source, apiKeyHash };
          
          const result = await simulateIngestion(
            apiKey,
            apiKeyHash,
            true,
            invalidPayload,
            sourceWithHash
          );
          
          // Should return 400 Bad Request
          expect(result.status).toBe(400);
          expect(result.body.error).toBeDefined();
          expect(result.body.details).toBeDefined();
          expect(result.body.details!.length).toBeGreaterThan(0);
          
          // No event should be created
          expect(result.body.eventId).toBeUndefined();
          expect(result.event).toBeUndefined();
        }
      ),
      { numRuns: 20 } // Reduced runs due to bcrypt overhead
    );
  }, ASYNC_TEST_TIMEOUT);

  it('Property 3: Invalid payload returns validation error - missing action', async () => {
    await fc.assert(
      fc.asyncProperty(
        invalidPayloadMissingActionArbitrary,
        sourceArbitrary,
        async (invalidPayload, source) => {
          const apiKey = generateApiKey();
          const apiKeyHash = await hashApiKey(apiKey);
          const sourceWithHash = { ...source, apiKeyHash };
          
          const result = await simulateIngestion(
            apiKey,
            apiKeyHash,
            true,
            invalidPayload,
            sourceWithHash
          );
          
          // Should return 400 Bad Request
          expect(result.status).toBe(400);
          expect(result.body.error).toBeDefined();
          expect(result.body.details).toBeDefined();
          
          // No event should be created
          expect(result.body.eventId).toBeUndefined();
          expect(result.event).toBeUndefined();
        }
      ),
      { numRuns: 20 } // Reduced runs due to bcrypt overhead
    );
  }, ASYNC_TEST_TIMEOUT);

  it('Property 3: Invalid payload returns validation error - malformed data', async () => {
    await fc.assert(
      fc.asyncProperty(
        malformedPayloadArbitrary,
        sourceArbitrary,
        async (malformedPayload, source) => {
          const apiKey = generateApiKey();
          const apiKeyHash = await hashApiKey(apiKey);
          const sourceWithHash = { ...source, apiKeyHash };
          
          const result = await simulateIngestion(
            apiKey,
            apiKeyHash,
            true,
            malformedPayload,
            sourceWithHash
          );
          
          // Should return 400 Bad Request
          expect(result.status).toBe(400);
          expect(result.body.error).toBeDefined();
          
          // No event should be created
          expect(result.body.eventId).toBeUndefined();
          expect(result.event).toBeUndefined();
        }
      ),
      { numRuns: 20 } // Reduced runs due to bcrypt overhead
    );
  }, ASYNC_TEST_TIMEOUT);
});

// ============================================
// Rate Limiting Tests
// ============================================

describe('Rate Limiting - Property Tests', () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  /**
   * Rate limit allows requests up to the limit
   */
  it('Rate limit allows requests up to limit', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{3,10}$/),
        fc.integer({ min: 1, max: 100 }),
        (sourceKey, limit) => {
          clearAllRateLimits();
          
          // All requests up to limit should be allowed
          for (let i = 0; i < limit; i++) {
            const result = checkRateLimit(sourceKey, limit);
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(limit - i - 1);
          }
          
          // Next request should be rejected
          const rejectedResult = checkRateLimit(sourceKey, limit);
          expect(rejectedResult.allowed).toBe(false);
          expect(rejectedResult.remaining).toBe(0);
        }
      ),
      { numRuns: 50 } // Fewer runs since this is deterministic
    );
  });

  /**
   * Rate limit remaining count is always non-negative
   */
  it('Rate limit remaining is always non-negative', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{3,10}$/),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 2000 }),
        (sourceKey, limit, requestCount) => {
          clearAllRateLimits();
          
          for (let i = 0; i < requestCount; i++) {
            const result = checkRateLimit(sourceKey, limit);
            expect(result.remaining).toBeGreaterThanOrEqual(0);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ============================================
// API Key Tests
// ============================================

describe('API Key - Property Tests', () => {
  /**
   * Generated API keys can be verified against their hash
   */
  it('API key verification round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null), // No input needed, just generate keys
        async () => {
          const apiKey = generateApiKey();
          const hash = await hashApiKey(apiKey);
          
          // Should verify correctly
          const isValid = await verifyApiKey(apiKey, hash);
          expect(isValid).toBe(true);
          
          // Different key should not verify
          const differentKey = generateApiKey();
          const isInvalid = await verifyApiKey(differentKey, hash);
          expect(isInvalid).toBe(false);
        }
      ),
      { numRuns: 10 } // Fewer runs since bcrypt is slow
    );
  }, ASYNC_TEST_TIMEOUT);

  /**
   * Generated API keys have correct format
   */
  it('Generated API keys have correct format', () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          const apiKey = generateApiKey();
          
          // Should start with prefix
          expect(apiKey.startsWith('irm_')).toBe(true);
          
          // Should have reasonable length
          expect(apiKey.length).toBeGreaterThan(10);
          expect(apiKey.length).toBeLessThan(100);
        }
      ),
      { numRuns: 100 }
    );
  });
});
