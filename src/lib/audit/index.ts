/**
 * Audit Logging Service
 * 
 * Provides functions for creating and validating audit log entries.
 * Requirement 15: Audit Logging
 * 
 * - 15.1: WHEN admin changes rules, thresholds, or sources, THE Audit_System SHALL record the change
 * - 15.2: THE Audit_Log SHALL include: timestamp, user, action, before/after values
 */

import { prisma } from "@/lib/db";

// ============================================
// Types
// ============================================

export interface AuditLogEntry {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CreateAuditLogInput {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeValue?: Record<string, unknown> | null;
  afterValue?: Record<string, unknown> | null;
}

export interface AuditLogData {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown> | null;
  createdAt: Date;
}

// ============================================
// Constants
// ============================================

/**
 * Valid audit actions
 */
export const AUDIT_ACTIONS = [
  "rule_updated",
  "source_created",
  "source_updated",
  "source_api_key_rotated",
  "threshold_updated",
  "setting_updated",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Valid entity types for audit logging
 */
export const AUDIT_ENTITY_TYPES = [
  "ScoringRule",
  "Source",
  "SystemSetting",
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

// ============================================
// Validation Functions
// ============================================

/**
 * Check if an action is a valid audit action
 */
export function isValidAuditAction(action: string): action is AuditAction {
  return AUDIT_ACTIONS.includes(action as AuditAction);
}

/**
 * Check if an entity type is valid for audit logging
 */
export function isValidEntityType(entityType: string): entityType is AuditEntityType {
  return AUDIT_ENTITY_TYPES.includes(entityType as AuditEntityType);
}

/**
 * Validate that an audit log entry has all required fields
 * Property 15: Audit Log Completeness
 * 
 * For any admin change to rules, sources, or thresholds, an audit log entry
 * SHALL be created with timestamp, user, action, and before/after values.
 */
export function validateAuditLogCompleteness(entry: AuditLogData): {
  isComplete: boolean;
  missingFields: string[];
} {
  const missingFields: string[] = [];

  // Required fields per Requirement 15.2
  if (!entry.userId || entry.userId.trim() === "") {
    missingFields.push("userId");
  }

  if (!entry.action || entry.action.trim() === "") {
    missingFields.push("action");
  }

  if (!entry.entityType || entry.entityType.trim() === "") {
    missingFields.push("entityType");
  }

  if (!entry.entityId || entry.entityId.trim() === "") {
    missingFields.push("entityId");
  }

  if (!entry.createdAt || !(entry.createdAt instanceof Date) || isNaN(entry.createdAt.getTime())) {
    missingFields.push("createdAt (timestamp)");
  }

  // beforeValue and afterValue can be null, but at least one should be present
  // for meaningful audit (except for certain actions like key rotation)
  const hasBeforeOrAfter = entry.beforeValue !== null || entry.afterValue !== null;
  if (!hasBeforeOrAfter && !entry.action.includes("rotated")) {
    missingFields.push("beforeValue or afterValue");
  }

  return {
    isComplete: missingFields.length === 0,
    missingFields,
  };
}

/**
 * Create an audit log data object from input
 * This is a pure function that can be tested without database
 */
export function createAuditLogData(input: CreateAuditLogInput): AuditLogData {
  return {
    userId: input.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeValue: input.beforeValue ?? null,
    afterValue: input.afterValue ?? null,
    createdAt: new Date(),
  };
}

/**
 * Check if an audit log entry should be created for a given action
 * Requirement 15.1: Admin changes to rules, thresholds, or sources should be logged
 */
export function shouldCreateAuditLog(
  action: string,
  entityType: string
): boolean {
  // All valid actions on valid entity types should be logged
  if (!isValidAuditAction(action)) {
    return false;
  }

  if (!isValidEntityType(entityType)) {
    return false;
  }

  return true;
}

/**
 * Compute the changes between before and after values
 */
export function computeChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): { field: string; before: unknown; after: unknown }[] {
  const changes: { field: string; before: unknown; after: unknown }[] = [];

  if (!before && !after) {
    return changes;
  }

  const allKeys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);

  for (const key of allKeys) {
    const beforeVal = before?.[key];
    const afterVal = after?.[key];

    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      changes.push({
        field: key,
        before: beforeVal,
        after: afterVal,
      });
    }
  }

  return changes;
}

// ============================================
// Database Operations
// ============================================

/**
 * Create an audit log entry in the database
 */
export async function createAuditLog(input: CreateAuditLogInput): Promise<AuditLogEntry> {
  const entry = await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeValue: input.beforeValue as object ?? undefined,
      afterValue: input.afterValue as object ?? undefined,
    },
  });

  return {
    id: entry.id,
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    beforeValue: entry.beforeValue as Record<string, unknown> | null,
    afterValue: entry.afterValue as Record<string, unknown> | null,
    createdAt: entry.createdAt,
  };
}

/**
 * Get audit logs with optional filters
 */
export async function getAuditLogs(options?: {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  limit?: number;
}): Promise<AuditLogEntry[]> {
  const where: Record<string, unknown> = {};

  if (options?.entityType) {
    where.entityType = options.entityType;
  }
  if (options?.entityId) {
    where.entityId = options.entityId;
  }
  if (options?.userId) {
    where.userId = options.userId;
  }
  if (options?.action) {
    where.action = options.action;
  }

  const entries = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: options?.limit ?? 100,
  });

  return entries.map((entry) => ({
    id: entry.id,
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    beforeValue: entry.beforeValue as Record<string, unknown> | null,
    afterValue: entry.afterValue as Record<string, unknown> | null,
    createdAt: entry.createdAt,
  }));
}
