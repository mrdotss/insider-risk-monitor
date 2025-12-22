/**
 * Scoring Engine - Risk scoring for actors based on behavioral rules
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

// Re-export rule types and functions
export {
  type RuleEvaluator,
  type ScoringRuleConfig,
  DEFAULT_RULES,
  RULE_EVALUATORS,
  evaluateRule,
  evaluateAllRules,
  evaluateOffHoursRule,
  evaluateNewIpRule,
  evaluateVolumeSpikeRule,
  evaluateScopeExpansionRule,
  evaluateFailureBurstRule,
  filterEventsInWindow,
  toScoringRuleConfig,
  getDefaultRules,
} from './rules';

// Re-export engine types and functions
export {
  type RiskScoreResult,
  type ScoringOptions,
  MAX_SCORE,
  MIN_SCORE,
  scoreActor,
  scoreActorWithDefaults,
  isValidRiskScore,
  contributionsSumToTotal,
  riskScoresEqual,
  formatRiskScore,
} from './engine';
