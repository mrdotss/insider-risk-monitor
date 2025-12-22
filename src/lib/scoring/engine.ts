/**
 * Scoring Engine - Compute explainable risk scores for actors
 * Requirements: 4.1, 4.3, 4.4, 4.6
 * 
 * - 4.1: Compute risk score 0-100 for each actor based on recent events
 * - 4.3: Include rule contributions (e.g., "New IP +15, Off-hours +10")
 * - 4.4: Include baseline values used for comparison
 * - 4.6: Produce deterministic results given the same inputs
 */

import { Event, RuleContribution } from '@/types';
import { ActorBaseline, getSystemDefaults } from '@/lib/baseline';
import { ScoringRuleConfig, evaluateAllRules, getDefaultRules } from './rules';

// ============================================
// Types
// ============================================

/**
 * Complete risk score result for an actor
 */
export interface RiskScoreResult {
  actorId: string;
  totalScore: number;           // 0-100
  computedAt: Date;
  ruleContributions: RuleContribution[];
  baselineUsed: ActorBaseline;
  triggeringEventIds: string[]; // Event IDs that contributed to the score
}

/**
 * Options for scoring computation
 */
export interface ScoringOptions {
  /** Maximum score cap (default: 100) */
  maxScore?: number;
  /** Rules to use (default: DEFAULT_RULES) */
  rules?: ScoringRuleConfig[];
  /** Reference time for scoring (default: now) - useful for deterministic testing */
  referenceTime?: Date;
}

// ============================================
// Constants
// ============================================

/** Maximum risk score */
export const MAX_SCORE = 100;

/** Minimum risk score */
export const MIN_SCORE = 0;

// ============================================
// Helper Functions
// ============================================

/**
 * Extract event IDs that contributed to rule triggers
 * Returns IDs of events that fall within any rule's time window
 */
function extractTriggeringEventIds(
  events: Event[],
  rules: ScoringRuleConfig[],
  contributions: RuleContribution[],
  referenceTime: Date
): string[] {
  if (contributions.length === 0) {
    return [];
  }

  // Find the maximum window from triggered rules
  const triggeredRuleKeys = new Set(contributions.map(c => {
    // Extract rule key from rule ID (e.g., 'rule_off_hours' -> 'off_hours')
    const rule = rules.find(r => r.id === c.ruleId);
    return rule?.ruleKey;
  }).filter(Boolean));

  const maxWindow = rules
    .filter(r => triggeredRuleKeys.has(r.ruleKey))
    .reduce((max, r) => Math.max(max, r.windowMinutes), 0);

  // Get events within the maximum window
  const cutoff = new Date(referenceTime.getTime() - maxWindow * 60 * 1000);
  const relevantEvents = events.filter(e => e.occurredAt >= cutoff);

  return relevantEvents.map(e => e.id);
}

/**
 * Sum points from rule contributions
 */
function sumContributions(contributions: RuleContribution[]): number {
  return contributions.reduce((sum, c) => sum + c.points, 0);
}

/**
 * Clamp a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ============================================
// Main Scoring Functions
// ============================================

/**
 * Score an actor based on their baseline and recent events
 * 
 * This is a pure function that produces deterministic results given the same inputs.
 * It evaluates all enabled rules and combines their contributions into a total score.
 * 
 * @param actorId - The actor identifier
 * @param baseline - Actor's baseline behavior (or system defaults for new actors)
 * @param events - Recent events for this actor
 * @param options - Optional scoring configuration
 * @returns RiskScoreResult with total score, contributions, and triggering events
 * 
 * Requirements:
 * - 4.1: Score is 0-100
 * - 4.3: Includes rule contributions with points and reasons
 * - 4.4: Includes baseline values used
 * - 4.6: Deterministic given same inputs
 */
export function scoreActor(
  actorId: string,
  baseline: ActorBaseline,
  events: Event[],
  options: ScoringOptions = {}
): RiskScoreResult {
  const {
    maxScore = MAX_SCORE,
    rules = getDefaultRules(),
    referenceTime = new Date(),
  } = options;

  // Evaluate all rules against the baseline and events
  const contributions = evaluateAllRules(rules, baseline, events);

  // Sum contributions and cap at maxScore
  const rawScore = sumContributions(contributions);
  const totalScore = clamp(rawScore, MIN_SCORE, maxScore);

  // Extract triggering event IDs
  const triggeringEventIds = extractTriggeringEventIds(
    events,
    rules,
    contributions,
    referenceTime
  );

  return {
    actorId,
    totalScore,
    computedAt: referenceTime,
    ruleContributions: contributions,
    baselineUsed: baseline,
    triggeringEventIds,
  };
}

/**
 * Score an actor using system defaults as baseline
 * Useful for new actors without established baselines
 * 
 * @param actorId - The actor identifier
 * @param events - Recent events for this actor
 * @param options - Optional scoring configuration
 * @returns RiskScoreResult
 */
export function scoreActorWithDefaults(
  actorId: string,
  events: Event[],
  options: ScoringOptions = {}
): RiskScoreResult {
  const defaults = getSystemDefaults();
  const baseline: ActorBaseline = {
    ...defaults,
    actorId,
  };

  return scoreActor(actorId, baseline, events, options);
}

/**
 * Validate that a risk score result is well-formed
 * Used for testing Property 7 (score range) and Property 8 (contributions)
 * 
 * @param result - The risk score result to validate
 * @returns true if valid, false otherwise
 */
export function isValidRiskScore(result: RiskScoreResult): boolean {
  // Check score range (Property 7)
  if (result.totalScore < MIN_SCORE || result.totalScore > MAX_SCORE) {
    return false;
  }

  // Check actorId is present
  if (!result.actorId || result.actorId.length === 0) {
    return false;
  }

  // Check computedAt is valid date
  if (!(result.computedAt instanceof Date) || isNaN(result.computedAt.getTime())) {
    return false;
  }

  // Check contributions array exists
  if (!Array.isArray(result.ruleContributions)) {
    return false;
  }

  // Check each contribution is well-formed
  for (const contribution of result.ruleContributions) {
    if (!contribution.ruleId || !contribution.ruleName) {
      return false;
    }
    if (typeof contribution.points !== 'number' || contribution.points < 0) {
      return false;
    }
    if (!contribution.reason || contribution.reason.length === 0) {
      return false;
    }
  }

  // Check baseline is present
  if (!result.baselineUsed || !result.baselineUsed.actorId) {
    return false;
  }

  // Check triggering events array exists
  if (!Array.isArray(result.triggeringEventIds)) {
    return false;
  }

  return true;
}

/**
 * Check if contributions sum matches total score (within rounding tolerance)
 * Used for testing Property 8
 * 
 * @param result - The risk score result to check
 * @returns true if contributions sum to total (capped at 100)
 */
export function contributionsSumToTotal(result: RiskScoreResult): boolean {
  const sum = sumContributions(result.ruleContributions);
  const expectedTotal = clamp(sum, MIN_SCORE, MAX_SCORE);
  return result.totalScore === expectedTotal;
}

/**
 * Compare two risk score results for equality (determinism check)
 * Used for testing Property 9
 * 
 * @param a - First result
 * @param b - Second result
 * @returns true if results are equivalent
 */
export function riskScoresEqual(a: RiskScoreResult, b: RiskScoreResult): boolean {
  // Check basic fields
  if (a.actorId !== b.actorId) return false;
  if (a.totalScore !== b.totalScore) return false;

  // Check contributions length
  if (a.ruleContributions.length !== b.ruleContributions.length) return false;

  // Check each contribution (order matters for determinism)
  for (let i = 0; i < a.ruleContributions.length; i++) {
    const ca = a.ruleContributions[i];
    const cb = b.ruleContributions[i];
    
    if (ca.ruleId !== cb.ruleId) return false;
    if (ca.points !== cb.points) return false;
    if (ca.reason !== cb.reason) return false;
  }

  // Check triggering events (sorted for comparison)
  const sortedA = [...a.triggeringEventIds].sort();
  const sortedB = [...b.triggeringEventIds].sort();
  
  if (sortedA.length !== sortedB.length) return false;
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i] !== sortedB[i]) return false;
  }

  return true;
}

/**
 * Format a risk score result for display
 * 
 * @param result - The risk score result
 * @returns Human-readable summary
 */
export function formatRiskScore(result: RiskScoreResult): string {
  const lines: string[] = [
    `Risk Score: ${result.totalScore}/100`,
    `Actor: ${result.actorId}`,
    `Computed: ${result.computedAt.toISOString()}`,
  ];

  if (result.ruleContributions.length > 0) {
    lines.push('');
    lines.push('Rule Contributions:');
    for (const c of result.ruleContributions) {
      lines.push(`  - ${c.ruleName}: +${c.points} (${c.reason})`);
    }
  } else {
    lines.push('');
    lines.push('No rules triggered.');
  }

  if (result.triggeringEventIds.length > 0) {
    lines.push('');
    lines.push(`Triggering Events: ${result.triggeringEventIds.length}`);
  }

  return lines.join('\n');
}
