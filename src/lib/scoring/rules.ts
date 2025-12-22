/**
 * Scoring Rules - Rule evaluators for risk scoring
 * Requirement 4.2: Evaluate rules for off-hours, new IP, volume spike, scope expansion, failure burst
 * 
 * Each rule evaluates specific behavioral patterns and returns a RuleContribution
 * with points and a human-readable reason.
 */

import { Event, RuleContribution, ScoringRule } from '@/types';
import { ActorBaseline } from '@/lib/baseline';

// ============================================
// Types
// ============================================

/**
 * Rule evaluator function signature
 * Takes a rule config, baseline, and recent events
 * Returns a RuleContribution (or null if rule doesn't trigger)
 */
export type RuleEvaluator = (
  rule: ScoringRuleConfig,
  baseline: ActorBaseline,
  events: Event[]
) => RuleContribution | null;

/**
 * Scoring rule configuration (in-memory representation)
 */
export interface ScoringRuleConfig {
  id: string;
  ruleKey: string;
  name: string;
  description: string;
  enabled: boolean;
  weight: number;        // Max points this rule can contribute
  threshold: number;     // Trigger threshold
  windowMinutes: number; // Time window for evaluation
  config: Record<string, unknown>; // Rule-specific config
}

// ============================================
// Default Rule Configurations
// ============================================

export const DEFAULT_RULES: ScoringRuleConfig[] = [
  {
    id: 'rule_off_hours',
    ruleKey: 'off_hours',
    name: 'Off-Hours Activity',
    description: 'Activity outside typical hours',
    enabled: true,
    weight: 15,
    threshold: 2, // 2+ events outside typical hours
    windowMinutes: 60,
    config: {},
  },
  {
    id: 'rule_new_ip',
    ruleKey: 'new_ip',
    name: 'New IP Address',
    description: 'First-seen IP in last 14 days',
    enabled: true,
    weight: 15,
    threshold: 1, // 1+ new IPs
    windowMinutes: 60,
    config: {},
  },
  {
    id: 'rule_volume_spike',
    ruleKey: 'volume_spike',
    name: 'Volume Spike',
    description: 'Bytes transferred > 3x baseline',
    enabled: true,
    weight: 25,
    threshold: 3, // 3x multiplier
    windowMinutes: 1440, // 24 hours
    config: {},
  },
  {
    id: 'rule_scope_expansion',
    ruleKey: 'scope_expansion',
    name: 'Resource Scope Expansion',
    description: 'Accessing 2x more resources than normal',
    enabled: true,
    weight: 20,
    threshold: 2, // 2x multiplier
    windowMinutes: 1440, // 24 hours
    config: {},
  },
  {
    id: 'rule_failure_burst',
    ruleKey: 'failure_burst',
    name: 'Failure Burst',
    description: 'Many failures in short window',
    enabled: true,
    weight: 25,
    threshold: 5, // 5+ failures
    windowMinutes: 10, // 10 minutes
    config: {},
  },
];

// ============================================
// Helper Functions
// ============================================

/**
 * Get hour (0-23) from a Date in UTC
 */
function getHourFromDate(date: Date): number {
  return date.getUTCHours();
}

/**
 * Filter events within a time window (in minutes) from now
 */
export function filterEventsInWindow(events: Event[], windowMinutes: number): Event[] {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
  return events.filter(e => e.occurredAt >= cutoff);
}

/**
 * Calculate total bytes from events
 */
function sumBytes(events: Event[]): number {
  return events.reduce((sum, e) => sum + (e.bytes || 0), 0);
}

/**
 * Count distinct resources accessed
 */
function countDistinctResources(events: Event[]): number {
  const resources = new Set<string>();
  for (const event of events) {
    if (event.resourceId) {
      resources.add(event.resourceId);
    }
  }
  return resources.size;
}

/**
 * Count failures in events
 */
function countFailures(events: Event[]): number {
  return events.filter(e => e.outcome === 'failure').length;
}

/**
 * Get unique IPs from events
 */
function getUniqueIps(events: Event[]): string[] {
  const ips = new Set<string>();
  for (const event of events) {
    if (event.ip) {
      ips.add(event.ip);
    }
  }
  return Array.from(ips);
}

// ============================================
// Rule Evaluators
// ============================================

/**
 * Off-Hours Activity Rule
 * Triggers when actor has activity outside their typical active hours
 * 
 * @param rule - Rule configuration
 * @param baseline - Actor's baseline behavior
 * @param events - Recent events to evaluate
 * @returns RuleContribution if triggered, null otherwise
 */
export function evaluateOffHoursRule(
  rule: ScoringRuleConfig,
  baseline: ActorBaseline,
  events: Event[]
): RuleContribution | null {
  if (!rule.enabled || events.length === 0) {
    return null;
  }

  const windowEvents = filterEventsInWindow(events, rule.windowMinutes);
  if (windowEvents.length === 0) {
    return null;
  }

  const typicalHours = new Set(baseline.typicalActiveHours);
  
  // If no typical hours established, use default business hours (9-17)
  if (typicalHours.size === 0) {
    for (let h = 9; h <= 17; h++) {
      typicalHours.add(h);
    }
  }

  // Count events outside typical hours
  let offHoursCount = 0;
  const offHoursSet = new Set<number>();
  
  for (const event of windowEvents) {
    const hour = getHourFromDate(event.occurredAt);
    if (!typicalHours.has(hour)) {
      offHoursCount++;
      offHoursSet.add(hour);
    }
  }

  // Check if threshold is met
  if (offHoursCount < rule.threshold) {
    return null;
  }

  // Calculate points proportionally (more off-hours events = more points, up to weight)
  const ratio = Math.min(offHoursCount / rule.threshold, 2); // Cap at 2x threshold
  const points = Math.round(rule.weight * (ratio / 2));

  const offHoursArray = Array.from(offHoursSet).sort((a, b) => a - b);
  const typicalHoursArray = Array.from(typicalHours).sort((a, b) => a - b);

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    points: Math.min(points, rule.weight),
    reason: `${offHoursCount} events outside typical hours (hours: ${offHoursArray.join(', ')})`,
    currentValue: offHoursArray.join(', ') || 'none',
    baselineValue: typicalHoursArray.join(', ') || '9-17 (default)',
  };
}

/**
 * New IP Address Rule
 * Triggers when actor uses IP addresses not seen in their baseline
 * 
 * @param rule - Rule configuration
 * @param baseline - Actor's baseline behavior
 * @param events - Recent events to evaluate
 * @returns RuleContribution if triggered, null otherwise
 */
export function evaluateNewIpRule(
  rule: ScoringRuleConfig,
  baseline: ActorBaseline,
  events: Event[]
): RuleContribution | null {
  if (!rule.enabled || events.length === 0) {
    return null;
  }

  const windowEvents = filterEventsInWindow(events, rule.windowMinutes);
  if (windowEvents.length === 0) {
    return null;
  }

  const knownIps = new Set(baseline.knownIpAddresses);
  const currentIps = getUniqueIps(windowEvents);
  
  // Find new IPs not in baseline
  const newIps = currentIps.filter(ip => !knownIps.has(ip));

  // Check if threshold is met
  if (newIps.length < rule.threshold) {
    return null;
  }

  // Calculate points proportionally
  const ratio = Math.min(newIps.length / rule.threshold, 3); // Cap at 3x threshold
  const points = Math.round(rule.weight * (ratio / 3));

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    points: Math.min(points, rule.weight),
    reason: `${newIps.length} new IP address(es) detected: ${newIps.slice(0, 3).join(', ')}${newIps.length > 3 ? '...' : ''}`,
    currentValue: newIps.join(', '),
    baselineValue: knownIps.size > 0 ? `${knownIps.size} known IPs` : 'no known IPs',
  };
}

/**
 * Volume Spike Rule
 * Triggers when bytes transferred exceeds baseline by threshold multiplier
 * 
 * @param rule - Rule configuration
 * @param baseline - Actor's baseline behavior
 * @param events - Recent events to evaluate
 * @returns RuleContribution if triggered, null otherwise
 */
export function evaluateVolumeSpikeRule(
  rule: ScoringRuleConfig,
  baseline: ActorBaseline,
  events: Event[]
): RuleContribution | null {
  if (!rule.enabled || events.length === 0) {
    return null;
  }

  const windowEvents = filterEventsInWindow(events, rule.windowMinutes);
  if (windowEvents.length === 0) {
    return null;
  }

  const currentBytes = sumBytes(windowEvents);
  
  // Use baseline average or a default minimum
  const baselineBytes = baseline.avgBytesPerDay > 0 
    ? baseline.avgBytesPerDay 
    : 10_000_000; // 10 MB default

  // Calculate the multiplier
  const multiplier = currentBytes / baselineBytes;

  // Check if threshold is met
  if (multiplier < rule.threshold) {
    return null;
  }

  // Calculate points proportionally
  const excessMultiplier = multiplier - rule.threshold + 1;
  const ratio = Math.min(excessMultiplier / rule.threshold, 2); // Cap at 2x excess
  const points = Math.round(rule.weight * (0.5 + ratio * 0.5));

  // Format bytes for display
  const formatBytes = (bytes: number): string => {
    if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
    if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    points: Math.min(points, rule.weight),
    reason: `Volume spike: ${formatBytes(currentBytes)} transferred (${multiplier.toFixed(1)}x baseline)`,
    currentValue: formatBytes(currentBytes),
    baselineValue: formatBytes(baselineBytes),
  };
}

/**
 * Resource Scope Expansion Rule
 * Triggers when actor accesses more distinct resources than baseline by threshold multiplier
 * 
 * @param rule - Rule configuration
 * @param baseline - Actor's baseline behavior
 * @param events - Recent events to evaluate
 * @returns RuleContribution if triggered, null otherwise
 */
export function evaluateScopeExpansionRule(
  rule: ScoringRuleConfig,
  baseline: ActorBaseline,
  events: Event[]
): RuleContribution | null {
  if (!rule.enabled || events.length === 0) {
    return null;
  }

  const windowEvents = filterEventsInWindow(events, rule.windowMinutes);
  if (windowEvents.length === 0) {
    return null;
  }

  const currentScope = countDistinctResources(windowEvents);
  
  // Use baseline scope or a default minimum
  const baselineScope = baseline.typicalResourceScope > 0 
    ? baseline.typicalResourceScope 
    : 10; // Default minimum scope

  // Calculate the multiplier
  const multiplier = currentScope / baselineScope;

  // Check if threshold is met
  if (multiplier < rule.threshold) {
    return null;
  }

  // Calculate points proportionally
  const excessMultiplier = multiplier - rule.threshold + 1;
  const ratio = Math.min(excessMultiplier / rule.threshold, 2);
  const points = Math.round(rule.weight * (0.5 + ratio * 0.5));

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    points: Math.min(points, rule.weight),
    reason: `Scope expansion: ${currentScope} resources accessed (${multiplier.toFixed(1)}x baseline)`,
    currentValue: currentScope,
    baselineValue: baselineScope,
  };
}

/**
 * Failure Burst Rule
 * Triggers when actor has many failures in a short time window
 * 
 * @param rule - Rule configuration
 * @param baseline - Actor's baseline behavior
 * @param events - Recent events to evaluate
 * @returns RuleContribution if triggered, null otherwise
 */
export function evaluateFailureBurstRule(
  rule: ScoringRuleConfig,
  baseline: ActorBaseline,
  events: Event[]
): RuleContribution | null {
  if (!rule.enabled || events.length === 0) {
    return null;
  }

  const windowEvents = filterEventsInWindow(events, rule.windowMinutes);
  if (windowEvents.length === 0) {
    return null;
  }

  const failureCount = countFailures(windowEvents);

  // Check if threshold is met
  if (failureCount < rule.threshold) {
    return null;
  }

  // Calculate points proportionally
  const ratio = Math.min(failureCount / rule.threshold, 3); // Cap at 3x threshold
  const points = Math.round(rule.weight * (ratio / 3));

  // Calculate current failure rate for comparison
  const currentFailureRate = windowEvents.length > 0 
    ? failureCount / windowEvents.length 
    : 0;

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    points: Math.min(points, rule.weight),
    reason: `Failure burst: ${failureCount} failures in ${rule.windowMinutes} minutes`,
    currentValue: `${failureCount} failures (${(currentFailureRate * 100).toFixed(0)}%)`,
    baselineValue: `${(baseline.normalFailureRate * 100).toFixed(0)}% normal rate`,
  };
}

// ============================================
// Rule Registry
// ============================================

/**
 * Map of rule keys to their evaluator functions
 */
export const RULE_EVALUATORS: Record<string, RuleEvaluator> = {
  off_hours: evaluateOffHoursRule,
  new_ip: evaluateNewIpRule,
  volume_spike: evaluateVolumeSpikeRule,
  scope_expansion: evaluateScopeExpansionRule,
  failure_burst: evaluateFailureBurstRule,
};

/**
 * Evaluate a single rule
 * 
 * @param rule - Rule configuration
 * @param baseline - Actor's baseline behavior
 * @param events - Recent events to evaluate
 * @returns RuleContribution if triggered, null otherwise
 */
export function evaluateRule(
  rule: ScoringRuleConfig,
  baseline: ActorBaseline,
  events: Event[]
): RuleContribution | null {
  const evaluator = RULE_EVALUATORS[rule.ruleKey];
  
  if (!evaluator) {
    console.warn(`Unknown rule key: ${rule.ruleKey}`);
    return null;
  }

  try {
    return evaluator(rule, baseline, events);
  } catch (error) {
    console.error(`Error evaluating rule ${rule.ruleKey}:`, error);
    return null;
  }
}

/**
 * Evaluate all enabled rules and return contributions
 * 
 * @param rules - Array of rule configurations
 * @param baseline - Actor's baseline behavior
 * @param events - Recent events to evaluate
 * @returns Array of RuleContributions for triggered rules
 */
export function evaluateAllRules(
  rules: ScoringRuleConfig[],
  baseline: ActorBaseline,
  events: Event[]
): RuleContribution[] {
  const contributions: RuleContribution[] = [];

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    const contribution = evaluateRule(rule, baseline, events);
    if (contribution) {
      contributions.push(contribution);
    }
  }

  return contributions;
}

/**
 * Convert a Prisma ScoringRule to ScoringRuleConfig
 */
export function toScoringRuleConfig(rule: ScoringRule): ScoringRuleConfig {
  return {
    id: rule.id,
    ruleKey: rule.ruleKey,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    weight: rule.weight,
    threshold: rule.threshold,
    windowMinutes: rule.windowMinutes,
    config: rule.config as Record<string, unknown>,
  };
}

/**
 * Get default rules as ScoringRuleConfig array
 */
export function getDefaultRules(): ScoringRuleConfig[] {
  return [...DEFAULT_RULES];
}
