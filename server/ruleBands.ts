export type RuleBandCode =
  | 'keep'
  | 'change'
  | 'stop'
  | 'escalate'
  | 'not_due'
  | 'manual_review'
  | 'unavailable';

export interface RuleMetricSnapshot {
  metric_id: string | null;
  value: number | null;
  computable: boolean;
  reason: string | null;
}

export interface RuleBandEvaluation {
  band: RuleBandCode;
  status_label: string;
  severity: 'ok' | 'warning' | 'critical' | 'neutral';
}

const RULE_BAND_SUPPORTED_IDS = new Set([
  'EX-B1a',
  'EX-B2',
  'EX-B2 (gate)',
  'EX-B4a',
  'EX-B3a',
]);

export interface RuleBandContext {
  notDueMessage?: string | null;
}

/**
 * Evaluates threshold_rule bands using canonical D-010 thresholds.
 * Unmetricized rules cleanly evaluate to 'manual review: no metric defined'.
 */
export function evaluateRuleBand(
  ruleId: string,
  metric: RuleMetricSnapshot | null,
  context?: RuleBandContext
): RuleBandEvaluation {
  if (!RULE_BAND_SUPPORTED_IDS.has(ruleId) || !metric || !metric.metric_id) {
    return {
      band: 'manual_review',
      status_label: 'manual review: no metric defined',
      severity: 'neutral',
    };
  }

  if (ruleId === 'EX-B2 (gate)' && context?.notDueMessage) {
    return {
      band: 'not_due',
      status_label: context.notDueMessage,
      severity: 'neutral',
    };
  }

  if (!metric.computable || metric.value === null || !Number.isFinite(metric.value)) {
    return {
      band: 'unavailable',
      status_label: metric.reason || 'Not computable',
      severity: 'neutral',
    };
  }

  const v = metric.value;

  switch (ruleId) {
    case 'EX-B1a':
      if (v >= 0.8) {
        return { band: 'keep', status_label: 'keep', severity: 'ok' };
      }
      if (v >= 0.63) {
        return {
          band: 'change',
          status_label: 'change (0.63–0.80)',
          severity: 'warning',
        };
      }
      return {
        band: 'escalate',
        status_label: 'escalate (< 0.63)',
        severity: 'critical',
      };

    case 'EX-B2':
      if (v >= 0.85) {
        return { band: 'keep', status_label: 'keep', severity: 'ok' };
      }
      if (v >= 0.74) {
        return {
          band: 'change',
          status_label: 'change (0.74–0.85)',
          severity: 'warning',
        };
      }
      return {
        band: 'escalate',
        status_label: 'escalate (< 0.74)',
        severity: 'critical',
      };

    case 'EX-B2 (gate)':
      if (v >= 0.85) {
        return { band: 'keep', status_label: 'keep', severity: 'ok' };
      }
      return {
        band: 'escalate',
        status_label: 'escalate (< 0.85)',
        severity: 'critical',
      };

    case 'EX-B4a':
      if (v >= 8) {
        return { band: 'keep', status_label: 'keep', severity: 'ok' };
      }
      if (v >= 4) {
        return {
          band: 'change',
          status_label: 'change (4–7)',
          severity: 'warning',
        };
      }
      return {
        band: 'stop',
        status_label: 'stop (< 4)',
        severity: 'critical',
      };

    case 'EX-B3a':
      if (v >= 12) {
        return { band: 'keep', status_label: 'keep', severity: 'ok' };
      }
      if (v >= 6) {
        return {
          band: 'change',
          status_label: 'change (6–11)',
          severity: 'warning',
        };
      }
      return {
        band: 'stop',
        status_label: 'stop (< 6)',
        severity: 'critical',
      };

    default:
      return {
        band: 'manual_review',
        status_label: 'manual review: no metric defined',
        severity: 'neutral',
      };
  }
}
