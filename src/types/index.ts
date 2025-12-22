// Re-export Prisma types for convenience
export type {
  Source,
  Event,
  Actor,
  Baseline,
  RiskScore,
  Alert,
  ScoringRule,
  SystemSetting,
  AuditLog,
  User,
  ActorType,
  Outcome,
  Severity,
  AlertStatus,
} from "@/generated/prisma";

// Business logic types (not stored in DB directly)

export interface RuleContribution {
  ruleId: string;
  ruleName: string;
  points: number;
  reason: string;
  currentValue: number | string;
  baselineValue: number | string;
}

export interface BaselineComparison {
  typicalHours: string;
  currentHours: string;
  avgBytes: number;
  currentBytes: number;
  normalScope: number;
  currentScope: number;
  normalFailureRate: number;
  currentFailureRate: number;
}

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

// Re-export normalization types
export type {
  NormalizedEvent,
  NormalizationResult,
} from "@/lib/normalization";

export interface IngestResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}
