// Normalization Engine - Transform raw events into common Event schema
// Requirements: 2.1, 2.2, 2.3, 2.4

import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { Source, ActorType, Outcome } from "@/types";

// ============================================
// Types
// ============================================

/**
 * Raw event payload from external sources
 * Flexible schema to accommodate various source formats
 */
export interface RawEvent {
  timestamp?: string;
  occurredAt?: string;
  user?: string;
  userId?: string;
  actor?: string;
  actorId?: string;
  actorType?: string;
  action?: string;
  actionType?: string;
  type?: string;
  resource?: string;
  resourceType?: string;
  resourceId?: string;
  ip?: string;
  ipAddress?: string;
  userAgent?: string;
  bytes?: number;
  bytesTransferred?: number;
  success?: boolean;
  outcome?: string;
  [key: string]: unknown;
}

/**
 * Normalized event ready for database storage
 */
export interface NormalizedEvent {
  id: string;
  occurredAt: Date;
  ingestedAt: Date;
  actorId: string;
  actorType: ActorType;
  sourceId: string;
  actionType: string;
  resourceType: string | null;
  resourceId: string | null;
  outcome: Outcome;
  ip: string | null;
  userAgent: string | null;
  bytes: number | null;
  metadata: Record<string, unknown>;
}

/**
 * Result of normalization operation
 */
export interface NormalizationResult {
  success: boolean;
  event?: NormalizedEvent;
  error?: string;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Hash a value using SHA-256 for redaction
 * Used when source has redactResourceId enabled
 */
export function hashForRedaction(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Extract actor ID from raw event
 * Tries multiple field names in priority order
 */
function extractActorId(raw: RawEvent): string | null {
  return (
    (raw.actorId as string) ||
    (raw.actor as string) ||
    (raw.userId as string) ||
    (raw.user as string) ||
    null
  );
}

/**
 * Extract actor type from raw event
 * Defaults to 'employee' if not specified or invalid
 */
function extractActorType(raw: RawEvent): ActorType {
  const rawType = raw.actorType?.toLowerCase();
  if (rawType === "service") {
    return "service";
  }
  return "employee";
}

/**
 * Extract timestamp from raw event
 * Tries multiple field names and formats
 */
function extractTimestamp(raw: RawEvent): Date | null {
  const rawTimestamp = raw.occurredAt || raw.timestamp;
  if (!rawTimestamp) {
    return null;
  }

  try {
    const date = new Date(rawTimestamp);
    if (isNaN(date.getTime())) {
      return null;
    }
    return date;
  } catch {
    return null;
  }
}

/**
 * Extract action type from raw event
 * Tries multiple field names
 */
function extractActionType(raw: RawEvent): string | null {
  return (
    (raw.actionType as string) ||
    (raw.action as string) ||
    (raw.type as string) ||
    null
  );
}

/**
 * Extract outcome from raw event
 * Handles boolean success field and string outcome field
 */
function extractOutcome(raw: RawEvent): Outcome {
  // Check explicit outcome field
  if (raw.outcome) {
    const outcome = raw.outcome.toLowerCase();
    if (outcome === "failure" || outcome === "failed" || outcome === "error") {
      return "failure";
    }
    return "success";
  }

  // Check boolean success field
  if (typeof raw.success === "boolean") {
    return raw.success ? "success" : "failure";
  }

  // Default to success
  return "success";
}

/**
 * Extract IP address from raw event
 */
function extractIp(raw: RawEvent): string | null {
  return (raw.ip as string) || (raw.ipAddress as string) || null;
}

/**
 * Extract bytes transferred from raw event
 */
function extractBytes(raw: RawEvent): number | null {
  const bytes = raw.bytes ?? raw.bytesTransferred;
  if (typeof bytes === "number" && bytes >= 0) {
    return bytes;
  }
  return null;
}

/**
 * Extract resource type from raw event
 */
function extractResourceType(raw: RawEvent): string | null {
  return (raw.resourceType as string) || null;
}

/**
 * Extract resource ID from raw event
 */
function extractResourceId(raw: RawEvent): string | null {
  return (raw.resourceId as string) || (raw.resource as string) || null;
}

/**
 * Build metadata object preserving raw fields
 * Excludes fields that are already mapped to normalized schema
 */
function buildMetadata(raw: RawEvent): Record<string, unknown> {
  const mappedFields = new Set([
    "timestamp",
    "occurredAt",
    "user",
    "userId",
    "actor",
    "actorId",
    "actorType",
    "action",
    "actionType",
    "type",
    "resource",
    "resourceType",
    "resourceId",
    "ip",
    "ipAddress",
    "userAgent",
    "bytes",
    "bytesTransferred",
    "success",
    "outcome",
  ]);

  const metadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!mappedFields.has(key) && value !== undefined && value !== null) {
      metadata[key] = value;
    }
  }

  return metadata;
}

// ============================================
// Main Normalization Function
// ============================================

/**
 * Normalize a raw event into the common Event schema
 *
 * @param raw - Raw event payload from external source
 * @param source - Source configuration (for redaction settings)
 * @returns NormalizationResult with normalized event or error
 *
 * Requirements:
 * - 2.1: Map to common Event schema with all required fields
 * - 2.2: Hash resourceId when redaction is enabled for source
 * - 2.3: Store null for missing optional fields (ip, userAgent, bytes)
 * - 2.4: Preserve raw fields in metadata JSONB
 */
export function normalizeEvent(
  raw: RawEvent,
  source: Source
): NormalizationResult {
  // Extract required fields
  const actorId = extractActorId(raw);
  if (!actorId) {
    return {
      success: false,
      error: "Missing required field: actorId (or user, userId, actor)",
    };
  }

  const actionType = extractActionType(raw);
  if (!actionType) {
    return {
      success: false,
      error: "Missing required field: actionType (or action, type)",
    };
  }

  // Extract timestamp - use current time if not provided
  const occurredAt = extractTimestamp(raw) || new Date();

  // Extract optional fields (Requirement 2.3: store null if missing)
  const ip = extractIp(raw);
  const userAgent = (raw.userAgent as string) || null;
  const bytes = extractBytes(raw);
  const resourceType = extractResourceType(raw);
  let resourceId = extractResourceId(raw);

  // Apply redaction if enabled for source (Requirement 2.2)
  if (resourceId && source.redactResourceId) {
    resourceId = hashForRedaction(resourceId);
  }

  // Build normalized event
  const normalizedEvent: NormalizedEvent = {
    id: uuidv4(),
    occurredAt,
    ingestedAt: new Date(),
    actorId,
    actorType: extractActorType(raw),
    sourceId: source.id,
    actionType,
    resourceType,
    resourceId,
    outcome: extractOutcome(raw),
    ip,
    userAgent,
    bytes,
    metadata: buildMetadata(raw), // Requirement 2.4: preserve raw fields
  };

  return {
    success: true,
    event: normalizedEvent,
  };
}

/**
 * Serialize a normalized event to JSON
 * Used for round-trip testing (Property 4)
 */
export function serializeEvent(event: NormalizedEvent): string {
  return JSON.stringify({
    ...event,
    occurredAt: event.occurredAt.toISOString(),
    ingestedAt: event.ingestedAt.toISOString(),
  });
}

/**
 * Deserialize a JSON string back to NormalizedEvent
 * Used for round-trip testing (Property 4)
 */
export function deserializeEvent(json: string): NormalizedEvent {
  const parsed = JSON.parse(json);
  return {
    ...parsed,
    occurredAt: new Date(parsed.occurredAt),
    ingestedAt: new Date(parsed.ingestedAt),
  };
}

/**
 * Validate that a normalized event has all required fields
 * Returns true if valid, false otherwise
 */
export function isValidNormalizedEvent(event: NormalizedEvent): boolean {
  return (
    typeof event.id === "string" &&
    event.id.length > 0 &&
    event.occurredAt instanceof Date &&
    !isNaN(event.occurredAt.getTime()) &&
    event.ingestedAt instanceof Date &&
    !isNaN(event.ingestedAt.getTime()) &&
    typeof event.actorId === "string" &&
    event.actorId.length > 0 &&
    (event.actorType === "employee" || event.actorType === "service") &&
    typeof event.sourceId === "string" &&
    event.sourceId.length > 0 &&
    typeof event.actionType === "string" &&
    event.actionType.length > 0 &&
    (event.outcome === "success" || event.outcome === "failure") &&
    typeof event.metadata === "object" &&
    event.metadata !== null
  );
}
