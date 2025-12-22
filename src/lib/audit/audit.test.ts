/**
 * Property-Based Tests for Audit Logging System
 * Feature: insider-risk-monitor
 *
 * Property 15: Audit Log Completeness
 *
 * Validates: Requirements 15.1, 15.2
 * 
 * 15.1: WHEN admin changes rules, thresholds, or sources, THE Audit_System SHALL record the change
 * 15.2: THE Audit_Log SHALL include: timestamp, user, action, before/after values
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  createAuditLogData,
  validateAuditLogCompleteness,
  shouldCreateAuditLog,
  computeChanges,
  isValidAuditAction,
  isValidEntityType,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  CreateAuditLogInput,
  AuditLogData,
} from "./index";

// ============================================
// Arbitraries (Generators)
// ============================================

/**
 * Generate a valid user ID (UUID format)
 */
const userIdArbitrary = fc.uuid();

/**
 * Generate a valid entity ID (UUID format)
 */
const entityIdArbitrary = fc.uuid();

/**
 * Generate a valid audit action
 */
const validActionArbitrary = fc.constantFrom(...AUDIT_ACTIONS);

/**
 * Generate an invalid audit action
 */
const invalidActionArbitrary = fc.stringMatching(/^[a-z_]{5,20}$/).filter(
  (s) => !AUDIT_ACTIONS.includes(s as typeof AUDIT_ACTIONS[number])
);

/**
 * Generate a valid entity type
 */
const validEntityTypeArbitrary = fc.constantFrom(...AUDIT_ENTITY_TYPES);

/**
 * Generate an invalid entity type
 */
const invalidEntityTypeArbitrary = fc.stringMatching(/^[A-Z][a-zA-Z]{3,15}$/).filter(
  (s) => !AUDIT_ENTITY_TYPES.includes(s as typeof AUDIT_ENTITY_TYPES[number])
);

/**
 * Generate a simple value for before/after comparison
 */
const simpleValueArbitrary = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.float({ noNaN: true }),
  fc.constant(null)
);

/**
 * Generate a record of simple values for before/after
 */
const valueRecordArbitrary = fc.dictionary(
  fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{0,19}$/),
  simpleValueArbitrary,
  { minKeys: 1, maxKeys: 10 }
);

/**
 * Generate a valid CreateAuditLogInput
 */
const validAuditLogInputArbitrary: fc.Arbitrary<CreateAuditLogInput> = fc.record({
  userId: userIdArbitrary,
  action: validActionArbitrary,
  entityType: validEntityTypeArbitrary,
  entityId: entityIdArbitrary,
  beforeValue: fc.option(valueRecordArbitrary, { nil: null }),
  afterValue: fc.option(valueRecordArbitrary, { nil: null }),
});

/**
 * Generate an audit log input with at least one of before/after values
 */
const auditLogInputWithValuesArbitrary: fc.Arbitrary<CreateAuditLogInput> = fc.record({
  userId: userIdArbitrary,
  action: validActionArbitrary.filter(a => !a.includes("rotated")),
  entityType: validEntityTypeArbitrary,
  entityId: entityIdArbitrary,
  beforeValue: fc.option(valueRecordArbitrary, { nil: null }),
  afterValue: fc.option(valueRecordArbitrary, { nil: null }),
}).filter(input => input.beforeValue !== null || input.afterValue !== null);

// ============================================
// Property Tests
// ============================================

describe("Audit Logging System - Property Tests", () => {
  /**
   * Property 15: Audit Log Completeness
   *
   * For any admin change to rules, sources, or thresholds, an audit log entry
   * SHALL be created with timestamp, user, action, and before/after values.
   *
   * Validates: Requirements 15.1, 15.2
   */
  describe("Property 15: Audit Log Completeness", () => {
    it("Property 15: Created audit log data contains all required fields", () => {
      fc.assert(
        fc.property(auditLogInputWithValuesArbitrary, (input) => {
          const auditData = createAuditLogData(input);

          // Validate completeness
          const validation = validateAuditLogCompleteness(auditData);

          // Should be complete
          expect(validation.isComplete).toBe(true);
          expect(validation.missingFields).toHaveLength(0);

          // Verify all required fields are present (Requirement 15.2)
          expect(auditData.userId).toBe(input.userId);
          expect(auditData.action).toBe(input.action);
          expect(auditData.entityType).toBe(input.entityType);
          expect(auditData.entityId).toBe(input.entityId);
          expect(auditData.createdAt).toBeInstanceOf(Date);
          expect(auditData.createdAt.getTime()).not.toBeNaN();
        }),
        { numRuns: 100 }
      );
    });

    it("Property 15: Audit log includes timestamp", () => {
      fc.assert(
        fc.property(validAuditLogInputArbitrary, (input) => {
          const beforeTime = new Date();
          const auditData = createAuditLogData(input);
          const afterTime = new Date();

          // Timestamp should be present and within expected range
          expect(auditData.createdAt).toBeInstanceOf(Date);
          expect(auditData.createdAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
          expect(auditData.createdAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
        }),
        { numRuns: 100 }
      );
    });

    it("Property 15: Audit log includes user information", () => {
      fc.assert(
        fc.property(validAuditLogInputArbitrary, (input) => {
          const auditData = createAuditLogData(input);

          // User ID should be preserved exactly
          expect(auditData.userId).toBe(input.userId);
          expect(auditData.userId.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    it("Property 15: Audit log includes action", () => {
      fc.assert(
        fc.property(validAuditLogInputArbitrary, (input) => {
          const auditData = createAuditLogData(input);

          // Action should be preserved exactly
          expect(auditData.action).toBe(input.action);
          expect(isValidAuditAction(auditData.action)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it("Property 15: Audit log includes before/after values", () => {
      fc.assert(
        fc.property(auditLogInputWithValuesArbitrary, (input) => {
          const auditData = createAuditLogData(input);

          // Before/after values should be preserved
          if (input.beforeValue !== undefined) {
            expect(auditData.beforeValue).toEqual(input.beforeValue);
          }
          if (input.afterValue !== undefined) {
            expect(auditData.afterValue).toEqual(input.afterValue);
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Requirement 15.1: Admin changes should be logged
   */
  describe("Requirement 15.1: Admin changes trigger audit logging", () => {
    it("Valid action and entity type should create audit log", () => {
      fc.assert(
        fc.property(
          validActionArbitrary,
          validEntityTypeArbitrary,
          (action, entityType) => {
            const shouldLog = shouldCreateAuditLog(action, entityType);
            expect(shouldLog).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("Invalid action should not create audit log", () => {
      fc.assert(
        fc.property(
          invalidActionArbitrary,
          validEntityTypeArbitrary,
          (action, entityType) => {
            const shouldLog = shouldCreateAuditLog(action, entityType);
            expect(shouldLog).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("Invalid entity type should not create audit log", () => {
      fc.assert(
        fc.property(
          validActionArbitrary,
          invalidEntityTypeArbitrary,
          (action, entityType) => {
            const shouldLog = shouldCreateAuditLog(action, entityType);
            expect(shouldLog).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Change computation tests
   */
  describe("Change computation", () => {
    it("Computes changes correctly between before and after values", () => {
      fc.assert(
        fc.property(
          valueRecordArbitrary,
          valueRecordArbitrary,
          (before, after) => {
            const changes = computeChanges(before, after);

            // Each change should have a field that differs
            for (const change of changes) {
              const beforeVal = before[change.field];
              const afterVal = after[change.field];
              
              // Values should be different (or one is undefined)
              expect(
                JSON.stringify(beforeVal) !== JSON.stringify(afterVal) ||
                beforeVal === undefined ||
                afterVal === undefined
              ).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it("No changes when before and after are identical", () => {
      fc.assert(
        fc.property(valueRecordArbitrary, (value) => {
          const changes = computeChanges(value, { ...value });
          expect(changes).toHaveLength(0);
        }),
        { numRuns: 100 }
      );
    });

    it("Handles null before value (creation)", () => {
      fc.assert(
        fc.property(valueRecordArbitrary, (after) => {
          const changes = computeChanges(null, after);
          
          // All fields in after should be changes
          expect(changes.length).toBe(Object.keys(after).length);
          
          for (const change of changes) {
            expect(change.before).toBeUndefined();
            expect(change.after).toBe(after[change.field]);
          }
        }),
        { numRuns: 100 }
      );
    });

    it("Handles null after value (deletion)", () => {
      fc.assert(
        fc.property(valueRecordArbitrary, (before) => {
          const changes = computeChanges(before, null);
          
          // All fields in before should be changes
          expect(changes.length).toBe(Object.keys(before).length);
          
          for (const change of changes) {
            expect(change.before).toBe(before[change.field]);
            expect(change.after).toBeUndefined();
          }
        }),
        { numRuns: 100 }
      );
    });

    it("Handles both null values", () => {
      const changes = computeChanges(null, null);
      expect(changes).toHaveLength(0);
    });
  });

  /**
   * Validation function tests
   */
  describe("Validation functions", () => {
    it("isValidAuditAction returns true for valid actions", () => {
      for (const action of AUDIT_ACTIONS) {
        expect(isValidAuditAction(action)).toBe(true);
      }
    });

    it("isValidAuditAction returns false for invalid actions", () => {
      fc.assert(
        fc.property(invalidActionArbitrary, (action) => {
          expect(isValidAuditAction(action)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it("isValidEntityType returns true for valid entity types", () => {
      for (const entityType of AUDIT_ENTITY_TYPES) {
        expect(isValidEntityType(entityType)).toBe(true);
      }
    });

    it("isValidEntityType returns false for invalid entity types", () => {
      fc.assert(
        fc.property(invalidEntityTypeArbitrary, (entityType) => {
          expect(isValidEntityType(entityType)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Completeness validation edge cases
   */
  describe("Completeness validation edge cases", () => {
    it("Missing userId fails validation", () => {
      const auditData: AuditLogData = {
        userId: "",
        action: "rule_updated",
        entityType: "ScoringRule",
        entityId: "test-id",
        beforeValue: { enabled: true },
        afterValue: { enabled: false },
        createdAt: new Date(),
      };

      const validation = validateAuditLogCompleteness(auditData);
      expect(validation.isComplete).toBe(false);
      expect(validation.missingFields).toContain("userId");
    });

    it("Missing action fails validation", () => {
      const auditData: AuditLogData = {
        userId: "user-123",
        action: "",
        entityType: "ScoringRule",
        entityId: "test-id",
        beforeValue: { enabled: true },
        afterValue: { enabled: false },
        createdAt: new Date(),
      };

      const validation = validateAuditLogCompleteness(auditData);
      expect(validation.isComplete).toBe(false);
      expect(validation.missingFields).toContain("action");
    });

    it("Invalid timestamp fails validation", () => {
      const auditData: AuditLogData = {
        userId: "user-123",
        action: "rule_updated",
        entityType: "ScoringRule",
        entityId: "test-id",
        beforeValue: { enabled: true },
        afterValue: { enabled: false },
        createdAt: new Date("invalid"),
      };

      const validation = validateAuditLogCompleteness(auditData);
      expect(validation.isComplete).toBe(false);
      expect(validation.missingFields).toContain("createdAt (timestamp)");
    });

    it("API key rotation can have null before/after values", () => {
      const auditData: AuditLogData = {
        userId: "user-123",
        action: "source_api_key_rotated",
        entityType: "Source",
        entityId: "source-id",
        beforeValue: null,
        afterValue: null,
        createdAt: new Date(),
      };

      const validation = validateAuditLogCompleteness(auditData);
      // Key rotation is special case - doesn't need before/after values
      expect(validation.isComplete).toBe(true);
    });
  });
});
