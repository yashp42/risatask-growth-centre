import { apiFetch } from './authSession';
import type {
  BetId,
  CampaignEntity,
  CampaignMetricId,
  MetricQueryResult,
} from '../types/campaigns';
import type { FilterOption } from '../types/overview';
import type {
  CanonicalRole,
  CategoryEntity,
  UserPermissionContext,
} from '../types/sponsors';
import type {
  AnalyticsComparisonRow,
  AnalyticsComparisonScope,
  AnalyticsFilterCatalog,
  AnalyticsFilters,
  AnalyticsPermissionProfile,
  AnalyticsRecordClass,
  CashCollectionGateSnapshot,
  ChannelGroupFunnelRow,
  ChannelGroupId,
  ExperimentReferenceRecord,
  ExperimentResultRecord,
  ForecastVersionRecord,
  GateScheduleWeek,
  GateWeeklyPacingRow,
  KpiReferenceRecord,
  MetricReferenceRecord,
  ModelAssumptionRecord,
  ScenarioReferenceRecord,
  TargetGateRecord,
  ThresholdRuleRecord,
  WeeklyPacingPoint,
} from '../types/analytics';
import {
  CANONICAL_BETS,
  CANONICAL_CHANNELS,
  CampaignApiError,
  queryMetrics,
} from './campaignsApi';
import { OVERVIEW_API_ENDPOINTS } from './overviewApi';

export class AnalyticsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = 'API_ERROR') {
    super(message);
    this.name = 'AnalyticsApiError';
    this.status = status;
    this.code = code;
  }
}

export const CHANNEL_GROUPS: ReadonlyArray<{
  channel_group: ChannelGroupId;
  label: string;
}> = [
  { channel_group: 'warm', label: 'Warm (introductions & creator referrals)' },
  { channel_group: 'inbound', label: 'Inbound (web form)' },
  { channel_group: 'renewal', label: 'Renewal (past sponsors)' },
  { channel_group: 'premium', label: 'Premium (pre-season inventory)' },
  { channel_group: 'cold', label: 'Cold (email & LinkedIn)' },
];

export const ANALYTICS_CHANNEL_GROUP_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All channel groups' },
  ...CHANNEL_GROUPS.map((g) => ({
    value: g.channel_group,
    label: g.label,
  })),
];

export const ANALYTICS_SCENARIO_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All scenarios' },
  { value: 'SC-01', label: 'SC-01 · Base' },
  { value: 'SC-02', label: 'SC-02 · Plan' },
  { value: 'SC-03', label: 'SC-03 · Stretch' },
];

export interface AnalyticsMetricUiHint {
  title: string;
  grain: string;
  caveat?: string;
}

export const ANALYTICS_METRIC_UI_HINTS: Record<string, AnalyticsMetricUiHint> = {
  'M-01': {
    title: 'Cash collected before the fest',
    grain: 'Reconciled receipts (cash)',
    caveat: 'Actual eligible cash received; excludes signed pledges and in-kind.',
  },
  'M-02': {
    title: 'Signed confirmed value',
    grain: 'Confirmed opportunities (total)',
    caveat: 'Includes cash and in-kind; never revenue or cash collected.',
  },
  'M-03': {
    title: 'Signed cash-type value',
    grain: 'Confirmed opportunities (cash)',
    caveat: 'Cash-type signed commitments only; excludes in-kind and receipts.',
  },
  'M-04': {
    title: 'In-kind value',
    grain: 'Confirmed opportunities (in-kind)',
    caveat: 'Non-cash goods/services tracked separately from cash.',
  },
  'M-06': {
    title: 'Collected ÷ signed cash',
    grain: 'Cash-type portfolio',
    caveat: 'Cash deals only; separate T−7 collection gate.',
  },
  'M-07': {
    title: 'Outstanding cash',
    grain: 'Signed cash deals',
    caveat: 'Remaining signed cash not yet collected; not automatically overdue.',
  },
  'M-08': {
    title: 'Cumulative signed value by week',
    grain: 'Weekly confirmed value',
    caveat: 'In-window signed-value pacing; separate from T−7 cash gate.',
  },
  'M-09': {
    title: 'Confirmed partnerships',
    grain: 'Opportunity-level count',
    caveat: 'Counts confirmed opportunities; one brand may have multiple.',
  },
  'M-11': {
    title: 'Meeting rate',
    grain: 'Brand-level',
  },
  'M-12': {
    title: 'Qualification → opportunity rate',
    grain: 'Brand-level (met brands)',
  },
  'M-13': {
    title: 'Win rate per proposal',
    grain: 'Opportunity-level',
    caveat: 'Withdrawn after confirmation counts as not won.',
  },
  'M-14': {
    title: 'Brand win rate',
    grain: 'Brand-level',
    caveat: 'Attribution rule: first-touch attribution unless stated otherwise.',
  },
  'M-15': {
    title: 'Mean won deal size',
    grain: 'Won opportunities',
    caveat: 'Signed confirmed value; includes in-kind unless filtered.',
  },
  'M-16': {
    title: 'Median won deal size',
    grain: 'Won opportunities',
    caveat: 'Signed confirmed value; includes in-kind unless filtered.',
  },
  'M-17': {
    title: 'Handoff leak rate',
    grain: 'Qualified brands',
    caveat: 'Scope: warm + inbound qualified brands unless stated; cold excluded.',
  },
  'M-18': {
    title: 'Deal record within 5 days',
    grain: 'Qualified lead cohort',
    caveat: 'Cohort timing applies; partial cohorts are not season-wide totals.',
  },
  'M-19': {
    title: 'Qualified → proposal within 10 days',
    grain: 'Qualified lead cohort',
    caveat: 'Cohort eligibility and evaluation checkpoint (W4, n ≥ 12) apply.',
  },
  'M-20': {
    title: 'Avg days to confirm',
    grain: 'Won deals (mean days)',
    caveat: 'Computed across won (partner_confirmed) opportunities only.',
  },
  'M-21': {
    title: 'Open pipeline value',
    grain: 'Open opportunities',
    caveat: 'Proposed face value of currently open deals; not a forecast.',
  },
  'M-22': {
    title: 'Cold share of outreach attempts',
    grain: 'Outreach attempts',
  },
  'M-23': {
    title: 'Response rate',
    grain: 'Campaign-brand grain',
    caveat:
      'Outreach and response counts sum over campaigns, so a brand contacted in two campaigns counts in each.',
  },
  'M-24': {
    title: 'Confirmed vs target',
    grain: 'Dated target comparison',
    caveat: 'Ever confirmed by the date, including later withdrawals.',
  },
  'M-25': {
    title: 'Advance paid within 7 days',
    grain: 'Signed cash deals',
  },
  'M-26': {
    title: 'Premium value signed pre-season',
    grain: 'Pre-season inventory deals',
    caveat: 'Applies only to stretch-tier pre-season premium inventory (W−5 to W0).',
  },
  'M-27': {
    title: 'Hours vs model rates',
    grain: 'Task type & strategic bet',
    caveat: 'Compares logged task hours against model rates; not a cash budget.',
  },
  'M-28': {
    title: 'Interested past sponsors',
    grain: 'Prior-edition sponsor screening',
  },
  'M-29': {
    title: 'Committed introductions',
    grain: 'VC/alumni referrals',
  },
  'M-30': {
    title: 'Approved scenario expected cash',
    grain: 'Approved scenario lookup',
    caveat: 'Read-only D-009 model lookup; never recomputed.',
  },
};

export const BET_SCORECARD_SPEC: ReadonlyArray<{
  bet_id: BetId;
  name: string;
  rank: number;
  metricIds: ReadonlyArray<string>;
  strategyNote: string;
}> = [
  {
    bet_id: 'B1',
    name: 'Funnel recovery',
    rank: 1,
    metricIds: ['M-19', 'M-17'],
    strategyNote: 'Base, Plan, and Stretch',
  },
  {
    bet_id: 'B2',
    name: 'Cash discipline',
    rank: 2,
    metricIds: ['M-25'],
    strategyNote: 'Base, Plan, and Stretch',
  },
  {
    bet_id: 'B4a',
    name: 'Renewals',
    rank: 3,
    metricIds: ['M-28'],
    strategyNote: 'Base, Plan, and Stretch',
  },
  {
    bet_id: 'B4b',
    name: 'Creator referrals',
    rank: 3,
    metricIds: [],
    strategyNote: 'Incremental in Plan and Stretch · No dedicated metric mapped',
  },
  {
    bet_id: 'B3',
    name: 'VC/alumni introductions',
    rank: 4,
    metricIds: ['M-29'],
    strategyNote: 'Incremental in Plan and Stretch',
  },
  {
    bet_id: 'B5',
    name: 'Premium inventory',
    rank: 5,
    metricIds: ['M-26'],
    strategyNote: 'Incremental in Stretch only (not active under Base or Plan)',
  },
];

const FULL_ANALYTICS_ROLES: ReadonlyArray<CanonicalRole> = [
  'coordination_lead',
  'pipeline_ops',
  'finance_collections',
];

const SALES_ANALYTICS_ROLES: ReadonlyArray<CanonicalRole> = [
  'partnerships',
  'community',
  'network',
  'premium_sales',
];

export function getAnalyticsPermissionProfile(
  permissions: UserPermissionContext
): AnalyticsPermissionProfile {
  if (!permissions.verified_by_server) {
    return {
      canViewAnalytics: true,
      canViewCashCollectionsMetrics: true,
      canViewHoursCapacityMetrics: true,
      canDrillToCampaigns: true,
      canDrillToPipeline: true,
      canDrillToSponsors: true,
      isViewerRestricted: false,
      verifiedByServer: false,
      currentMemberId: permissions.member_id,
    };
  }

  const roles = permissions.roles;
  const hasAny = (list: ReadonlyArray<CanonicalRole>) =>
    list.some((r) => roles.includes(r));

  const isViewer = roles.includes('viewer');
  const hasBusiness = hasAny(FULL_ANALYTICS_ROLES) || hasAny(SALES_ANALYTICS_ROLES);

  if (!hasBusiness && !isViewer) {
    return {
      canViewAnalytics: false,
      canViewCashCollectionsMetrics: false,
      canViewHoursCapacityMetrics: false,
      canDrillToCampaigns: false,
      canDrillToPipeline: false,
      canDrillToSponsors: false,
      isViewerRestricted: true,
      verifiedByServer: true,
      currentMemberId: permissions.member_id,
    };
  }

  return {
    canViewAnalytics: true,
    canViewCashCollectionsMetrics: hasBusiness,
    canViewHoursCapacityMetrics: hasBusiness,
    canDrillToCampaigns: hasBusiness || isViewer,
    canDrillToPipeline: hasBusiness || isViewer,
    canDrillToSponsors: hasBusiness || isViewer,
    isViewerRestricted: !hasBusiness && isViewer,
    verifiedByServer: true,
    currentMemberId: permissions.member_id,
  };
}

export function formatAnalyticsMetricValue(
  result: MetricQueryResult | null | undefined,
  unitOverride?: string | null
): string {
  if (!result) return 'Unavailable';
  if (!result.computable || result.value === null || result.value === undefined) {
    return 'Not computable';
  }
  const unit = unitOverride || result.unit;
  if (unit === 'ratio') {
    return `${(result.value * 100).toFixed(1)}%`;
  }
  if (unit === '₹ lakh' || unit === 'lakh') {
    return `₹${result.value.toFixed(2)}L`;
  }
  if (unit === '₹') {
    if (Math.abs(result.value) >= 100000) {
      return `₹${(result.value / 100000).toFixed(2)}L`;
    }
    return `₹${Math.round(result.value).toLocaleString('en-IN')}`;
  }
  if (unit === 'days') {
    return `${result.value.toFixed(1)} d`;
  }
  return Number.isInteger(result.value)
    ? result.value.toLocaleString('en-IN')
    : result.value.toFixed(1);
}

export function formatNumeratorDenominator(
  result: MetricQueryResult | null | undefined
): string | null {
  if (!result || !result.computable) return null;
  if (
    result.numerator === null ||
    result.numerator === undefined ||
    result.denominator === null ||
    result.denominator === undefined
  ) {
    if (result.numerator !== null && result.numerator !== undefined) {
      return `Numerator: ${result.numerator.toLocaleString('en-IN')}`;
    }
    return null;
  }
  return `${result.numerator.toLocaleString('en-IN')} / ${result.denominator.toLocaleString('en-IN')}`;
}

export function formatAppliedFiltersSummary(
  appliedFilters?: Record<string, unknown>
): string {
  if (!appliedFilters || typeof appliedFilters !== 'object') {
    return 'None reported';
  }
  const entries = Object.entries(appliedFilters).filter(
    ([, val]) => val !== null && val !== undefined && val !== ''
  );
  if (entries.length === 0) return 'Season-wide (no dimension filter)';
  return entries.map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
}

/**
 * Strictly restricts metric filter keys to those accepted by metrics.get_metric:
 * ONLY { campaign_id, channel_group, bet_id, scenario_id }.
 */
export function buildMetricQueryFilters(
  filters: AnalyticsFilters
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (filters.campaign_id && filters.campaign_id !== 'all') {
    out.campaign_id = filters.campaign_id;
  }
  if (filters.channel_group && filters.channel_group !== 'all') {
    out.channel_group = filters.channel_group;
  }
  if (filters.bet_id && filters.bet_id !== 'all') {
    out.bet_id = filters.bet_id;
  }
  if (filters.scenario_id && filters.scenario_id !== 'all') {
    out.scenario_id = filters.scenario_id;
  }
  return out;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  if (!response.ok) {
    let message = 'Unable to retrieve analytics data.';
    let code = `HTTP_${response.status}`;

    if (isJson) {
      try {
        const errBody = (await response.json()) as {
          message?: string;
          error?: string;
          code?: string;
        };
        if (errBody.message) message = errBody.message;
        else if (errBody.error) message = errBody.error;
        if (errBody.code) code = errBody.code;
      } catch {
        // Ignore parse error
      }
    } else if (response.status === 403) {
      message = 'Access restricted by your assigned role.';
    } else if (response.status === 404) {
      message = 'Analytics service is currently unavailable.';
    }

    throw new AnalyticsApiError(message, response.status, code);
  }

  if (!isJson) {
    throw new AnalyticsApiError(
      'Analytics service is currently unavailable.',
      503,
      'SERVICE_UNAVAILABLE'
    );
  }

  return (await response.json()) as T;
}

export async function fetchAnalyticsFilterCatalog(
  recordClass: AnalyticsRecordClass,
  editionId: string,
  signal?: AbortSignal
): Promise<AnalyticsFilterCatalog> {
  const campaignsPromise = requestJson<
    | Array<Record<string, unknown>>
    | { campaigns?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }
  >(
    `${OVERVIEW_API_ENDPOINTS.campaigns}?${new URLSearchParams({
      record_class: recordClass,
      edition_id: editionId,
    }).toString()}`,
    { signal }
  )
    .then((res) => {
      const list = Array.isArray(res) ? res : res.campaigns ?? res.items ?? [];
      return list.map(
        (raw): CampaignEntity => ({
          campaign_id: String(raw.campaign_id ?? raw.id ?? ''),
          edition_id: String(raw.edition_id ?? editionId),
          name: String(raw.name ?? ''),
          channel_id: String(raw.channel_id ?? raw.channel ?? ''),
          channel_group:
            (raw.channel_group as CampaignEntity['channel_group']) ?? null,
          bet_id: (raw.bet_id as BetId | string | null | undefined) ?? null,
          owner_member_id:
            (raw.owner_member_id as string | null | undefined) ?? null,
          planned_start: (raw.planned_start as string | null | undefined) ?? null,
          planned_end: (raw.planned_end as string | null | undefined) ?? null,
          objective: (raw.objective as string | null | undefined) ?? null,
          status: (raw.status as CampaignEntity['status']) ?? 'planned',
          record_class:
            (raw.record_class as AnalyticsRecordClass) ?? recordClass,
          channel_name: (raw.channel_name as string | null | undefined) ?? null,
          owner_name: (raw.owner_name as string | null | undefined) ?? null,
          bet_name: (raw.bet_name as string | null | undefined) ?? null,
        })
      );
    });

  const categoriesPromise = requestJson<
    CategoryEntity[] | { categories?: CategoryEntity[]; items?: CategoryEntity[] }
  >(OVERVIEW_API_ENDPOINTS.referenceCategories, { signal }).then((res) =>
    Array.isArray(res) ? res : res.categories ?? res.items ?? []
  );

  const [campaigns, categories] = await Promise.all([
    campaignsPromise,
    categoriesPromise,
  ]);

  const ownerMap = new Map<string, string>();
  for (const c of campaigns) {
    if (c.owner_member_id && !ownerMap.has(c.owner_member_id)) {
      ownerMap.set(
        c.owner_member_id,
        c.owner_name ? `${c.owner_name} (${c.owner_member_id})` : c.owner_member_id
      );
    }
  }

  return {
    campaigns,
    categories,
    owners: Array.from(ownerMap.entries()).map(([id, label]) => ({ id, label })),
  };
}

export interface AnalyticsReferenceBundle {
  approvedScenarios: ScenarioReferenceRecord[];
  gates: TargetGateRecord[];
  gateWeeks: GateScheduleWeek[];
  gateWeeklyPacing: GateWeeklyPacingRow[];
  latestPassedGateWeek: GateWeeklyPacingRow | null;
  cashGate: CashCollectionGateSnapshot | null;
  rules: ThresholdRuleRecord[];
  assumptions: ModelAssumptionRecord[];
  metricDefinitions: MetricReferenceRecord[];
  kpiDefinitions: KpiReferenceRecord[];
  experiments: ExperimentReferenceRecord[];
  experimentResults: ExperimentResultRecord[];
  forecasts: ForecastVersionRecord[];
  availability: {
    scenarios: boolean;
    gates: boolean;
    rules: boolean;
    assumptions: boolean;
    metrics: boolean;
    kpis: boolean;
    experiments: boolean;
    forecasts: boolean;
  };
}

function normalizeScenario(
  raw: Record<string, unknown>
): ScenarioReferenceRecord {
  return {
    scenario_id: String(raw.scenario_id ?? raw.id ?? ''),
    name: String(raw.name ?? ''),
    status: String(raw.status ?? ''),
    expected_cash: Number(raw.expected_cash ?? 0),
    p10:
      raw.p10 !== undefined && raw.p10 !== null ? Number(raw.p10) : null,
    p50:
      raw.p50 !== undefined && raw.p50 !== null ? Number(raw.p50) : null,
    p90:
      raw.p90 !== undefined && raw.p90 !== null ? Number(raw.p90) : null,
    window_pw:
      raw.window_pw !== undefined && raw.window_pw !== null
        ? Number(raw.window_pw)
        : null,
    preseason_pw:
      raw.preseason_pw !== undefined && raw.preseason_pw !== null
        ? Number(raw.preseason_pw)
        : null,
    decision_id: (raw.decision_id as string | null | undefined) ?? null,
    output_checksum: (raw.output_checksum as string | null | undefined) ?? null,
    record_class: (raw.record_class as string | null | undefined) ?? null,
    description: (raw.description as string | null | undefined) ?? null,
  };
}

function normalizeGate(raw: Record<string, unknown>): TargetGateRecord {
  return {
    gate_id: String(raw.gate_id ?? raw.target_id ?? raw.id ?? ''),
    edition_id: (raw.edition_id as string | null | undefined) ?? null,
    kpi_id: (raw.kpi_id as string | null | undefined) ?? null,
    metric_id: (raw.metric_id as string | null | undefined) ?? null,
    scenario_id: (raw.scenario_id as string | null | undefined) ?? null,
    period: (raw.period as string | null | undefined) ?? null,
    week_no:
      raw.week_no !== undefined && raw.week_no !== null
        ? Number(raw.week_no)
        : null,
    week_end: (raw.week_end as string | null | undefined) ?? null,
    target_value:
      raw.target_value !== undefined && raw.target_value !== null
        ? Number(raw.target_value)
        : null,
    threshold:
      raw.threshold !== undefined && raw.threshold !== null
        ? Number(raw.threshold)
        : null,
    threshold_label:
      (raw.threshold_label as string | null | undefined) ?? null,
    checkpoint_label:
      (raw.checkpoint_label as string | null | undefined) ?? null,
    actual_value:
      raw.actual_value !== undefined && raw.actual_value !== null
        ? Number(raw.actual_value)
        : null,
    status: (raw.status as string | null | undefined) ?? null,
    pass: typeof raw.pass === 'boolean' ? raw.pass : null,
    decision_id: (raw.decision_id as string | null | undefined) ?? null,
    name: (raw.name as string | null | undefined) ?? null,
    description: (raw.description as string | null | undefined) ?? null,
  };
}

function normalizeRule(raw: Record<string, unknown>): ThresholdRuleRecord {
  return {
    rule_id: String(raw.rule_id ?? raw.id ?? ''),
    kpi_id: String(raw.kpi_id ?? ''),
    kpi_name: (raw.kpi_name as string | null | undefined) ?? null,
    bet_id: (raw.bet_id as string | null | undefined) ?? null,
    metric_id: (raw.metric_id as string | null | undefined) ?? null,
    evaluate_at: String(raw.evaluate_at ?? ''),
    keep_if: (raw.keep_if as string | null | undefined) ?? null,
    change_if: (raw.change_if as string | null | undefined) ?? null,
    escalate_if: String(raw.escalate_if ?? ''),
    response: String(raw.response ?? ''),
    owner_role: (raw.owner_role as string | null | undefined) ?? null,
    decision_id: (raw.decision_id as string | null | undefined) ?? null,
    rule_status: String(raw.rule_status ?? ''),
    current_value:
      raw.current_value !== undefined && raw.current_value !== null
        ? Number(raw.current_value)
        : null,
    current_numerator:
      raw.current_numerator !== undefined && raw.current_numerator !== null
        ? Number(raw.current_numerator)
        : null,
    current_denominator:
      raw.current_denominator !== undefined && raw.current_denominator !== null
        ? Number(raw.current_denominator)
        : null,
    current_unit: (raw.current_unit as string | null | undefined) ?? null,
    computable: typeof raw.computable === 'boolean' ? raw.computable : undefined,
    reason: (raw.reason as string | null | undefined) ?? null,
    band: (raw.band as string | null | undefined) ?? null,
    status_label: (raw.status_label as string | null | undefined) ?? null,
    severity: (raw.severity as string | null | undefined) ?? null,
    record_class: (raw.record_class as string | null | undefined) ?? null,
    as_of: (raw.as_of as string | null | undefined) ?? null,
    evaluated_status:
      (raw.evaluated_status as string | null | undefined) ??
      (raw.status_label as string | null | undefined) ??
      null,
    fired: typeof raw.fired === 'boolean' ? raw.fired : null,
  };
}

function normalizeAssumption(
  raw: Record<string, unknown>
): ModelAssumptionRecord {
  return {
    assumption_id: String(raw.assumption_id ?? raw.id ?? ''),
    variable: String(raw.variable ?? ''),
    frozen_value: String(raw.frozen_value ?? ''),
    uncertainty: (raw.uncertainty as string | null | undefined) ?? null,
    validation_kpi_id:
      (raw.validation_kpi_id as string | null | undefined) ?? null,
    experiment_id: (raw.experiment_id as string | null | undefined) ?? null,
  };
}

function normalizeMetricDef(
  raw: Record<string, unknown>
): MetricReferenceRecord {
  return {
    metric_id: String(raw.metric_id ?? raw.id ?? ''),
    kpi_id: (raw.kpi_id as string | null | undefined) ?? null,
    name: String(raw.name ?? ''),
    business_meaning:
      (raw.business_meaning as string | null | undefined) ?? null,
    formula: String(raw.formula ?? ''),
    numerator: (raw.numerator as string | null | undefined) ?? null,
    denominator: (raw.denominator as string | null | undefined) ?? null,
    aggregation: (raw.aggregation as string | null | undefined) ?? null,
    time_period: (raw.time_period as string | null | undefined) ?? null,
    inclusion_exclusion:
      (raw.inclusion_exclusion as string | null | undefined) ?? null,
    value_nature: (raw.value_nature as string | null | undefined) ?? null,
    unit: (raw.unit as string | null | undefined) ?? null,
    computable_2025:
      (raw.computable_2025 as boolean | string | null | undefined) ?? null,
    definition_version:
      (raw.definition_version as string | number | null | undefined) ?? null,
  };
}

function normalizeKpiDef(raw: Record<string, unknown>): KpiReferenceRecord {
  return {
    kpi_id: String(raw.kpi_id ?? raw.id ?? ''),
    name: String(raw.name ?? ''),
    bet_id: (raw.bet_id as string | null | undefined) ?? null,
    kpi_type: (raw.kpi_type as string | null | undefined) ?? null,
    definition: String(raw.definition ?? ''),
    grain: (raw.grain as string | null | undefined) ?? null,
    frequency: (raw.frequency as string | null | undefined) ?? null,
    metric_id: (raw.metric_id as string | null | undefined) ?? null,
  };
}

function normalizeExperiment(
  raw: Record<string, unknown>
): ExperimentReferenceRecord {
  return {
    experiment_id: String(raw.experiment_id ?? raw.id ?? ''),
    bet_id: String(raw.bet_id ?? ''),
    hypothesis: String(raw.hypothesis ?? ''),
    population: (raw.population as string | null | undefined) ?? null,
    intervention: (raw.intervention as string | null | undefined) ?? null,
    sample_size: (raw.sample_size as string | null | undefined) ?? null,
    time_limit: (raw.time_limit as string | null | undefined) ?? null,
    primary_kpi_id: (raw.primary_kpi_id as string | null | undefined) ?? null,
    rule_id: (raw.rule_id as string | null | undefined) ?? null,
    status: String(raw.status ?? 'planned'),
  };
}

export async function fetchAnalyticsReferenceBundle(
  recordClass: AnalyticsRecordClass,
  editionId: string,
  asOf: string,
  signal?: AbortSignal
): Promise<AnalyticsReferenceBundle> {
  const gateParams = new URLSearchParams({
    record_class: recordClass,
    editionId,
    edition_id: editionId,
    asOf,
    as_of: asOf,
  });

  const safeFetch = async <T>(url: string): Promise<T | null> => {
    try {
      return await requestJson<T>(url, { signal });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      return null;
    }
  };

  const [
    scenariosRaw,
    gatesRaw,
    rulesRaw,
    assumptionsRaw,
    metricsRaw,
    kpisRaw,
    experimentsRaw,
  ] = await Promise.all([
    safeFetch<Record<string, unknown> | Array<Record<string, unknown>>>(
      OVERVIEW_API_ENDPOINTS.referenceScenarios
    ),
    safeFetch<Record<string, unknown> | Array<Record<string, unknown>>>(
      `${OVERVIEW_API_ENDPOINTS.gates}?${gateParams.toString()}`
    ),
    safeFetch<Record<string, unknown> | Array<Record<string, unknown>>>(
      `${OVERVIEW_API_ENDPOINTS.rules}?${gateParams.toString()}`
    ),
    safeFetch<Record<string, unknown> | Array<Record<string, unknown>>>(
      OVERVIEW_API_ENDPOINTS.referenceAssumptions
    ),
    safeFetch<Record<string, unknown> | Array<Record<string, unknown>>>(
      OVERVIEW_API_ENDPOINTS.referenceMetrics
    ),
    safeFetch<Record<string, unknown> | Array<Record<string, unknown>>>(
      OVERVIEW_API_ENDPOINTS.referenceKpis
    ),
    safeFetch<Record<string, unknown> | Array<Record<string, unknown>>>(
      OVERVIEW_API_ENDPOINTS.referenceExperiments
    ),
  ]);

  const extractList = (
    payload: Record<string, unknown> | Array<Record<string, unknown>> | null,
    key: string
  ): Array<Record<string, unknown>> => {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    const candidate = payload[key] ?? payload.items;
    return Array.isArray(candidate)
      ? (candidate as Array<Record<string, unknown>>)
      : [];
  };

  const scenariosList = extractList(scenariosRaw, 'scenarios').map(
    normalizeScenario
  );
  const approvedScenarios = scenariosList.filter(
    (s) => s.status.toUpperCase() === 'APPROVED'
  );

  const gateWeeks: GateScheduleWeek[] =
    gatesRaw && !Array.isArray(gatesRaw) && Array.isArray(gatesRaw.weeks)
      ? (gatesRaw.weeks as GateScheduleWeek[])
      : [];

  const gateWeeklyPacing: GateWeeklyPacingRow[] =
    gatesRaw && !Array.isArray(gatesRaw) && Array.isArray(gatesRaw.weekly_pacing)
      ? (gatesRaw.weekly_pacing as GateWeeklyPacingRow[])
      : [];

  const latestPassedGateWeek: GateWeeklyPacingRow | null =
    gatesRaw &&
    !Array.isArray(gatesRaw) &&
    gatesRaw.latest_passed_week &&
    typeof gatesRaw.latest_passed_week === 'object'
      ? (gatesRaw.latest_passed_week as GateWeeklyPacingRow)
      : null;

  const cashGate: CashCollectionGateSnapshot | null =
    gatesRaw &&
    !Array.isArray(gatesRaw) &&
    gatesRaw.cash_gate &&
    typeof gatesRaw.cash_gate === 'object'
      ? (gatesRaw.cash_gate as CashCollectionGateSnapshot)
      : null;

  const experimentsList = extractList(experimentsRaw, 'experiments').map(
    normalizeExperiment
  );

  const optionalExperimentResults =
    experimentsRaw &&
    !Array.isArray(experimentsRaw) &&
    Array.isArray(experimentsRaw.experiment_results)
      ? (experimentsRaw.experiment_results as ExperimentResultRecord[])
      : [];

  const optionalForecasts =
    scenariosRaw &&
    !Array.isArray(scenariosRaw) &&
    Array.isArray(scenariosRaw.forecasts)
      ? (scenariosRaw.forecasts as ForecastVersionRecord[])
      : [];

  return {
    approvedScenarios,
    gates: extractList(gatesRaw, 'gates').map(normalizeGate),
    gateWeeks,
    gateWeeklyPacing,
    latestPassedGateWeek,
    cashGate,
    rules: extractList(rulesRaw, 'rules').map(normalizeRule),
    assumptions: extractList(assumptionsRaw, 'assumptions').map(
      normalizeAssumption
    ),
    metricDefinitions: extractList(metricsRaw, 'metrics').map(
      normalizeMetricDef
    ),
    kpiDefinitions: extractList(kpisRaw, 'kpis').map(normalizeKpiDef),
    experiments: experimentsList,
    experimentResults: optionalExperimentResults,
    forecasts: optionalForecasts,
    availability: {
      scenarios: scenariosRaw !== null,
      gates: gatesRaw !== null,
      rules: rulesRaw !== null,
      assumptions: assumptionsRaw !== null,
      metrics: metricsRaw !== null,
      kpis: kpisRaw !== null,
      experiments: experimentsRaw !== null,
      forecasts: optionalForecasts.length > 0,
    },
  };
}

export const ANALYTICS_BROAD_METRIC_IDS: ReadonlyArray<string> = [
  'M-02',
  'M-03',
  'M-04',
  'M-08',
  'M-09',
  'M-11',
  'M-12',
  'M-13',
  'M-14',
  'M-15',
  'M-16',
  'M-17',
  'M-18',
  'M-19',
  'M-20',
  'M-21',
  'M-22',
  'M-23',
  'M-24',
  'M-26',
  'M-28',
  'M-29',
  'M-30',
];

export const RESTRICTED_VIEWER_METRIC_IDS: ReadonlyArray<string> = [
  'M-01',
  'M-06',
  'M-07',
  'M-25',
  'M-27',
];

export async function fetchAnalyticsCoreMetrics(
  filters: AnalyticsFilters,
  permissionProfile: AnalyticsPermissionProfile,
  signal?: AbortSignal
): Promise<{
  results: Record<string, MetricQueryResult>;
  m30ByScenario: Record<string, MetricQueryResult>;
  restrictedForbidden: boolean;
  error: AnalyticsApiError | null;
}> {
  if (permissionProfile.verifiedByServer && !permissionProfile.canViewAnalytics) {
    return {
      results: {},
      m30ByScenario: {},
      restrictedForbidden: true,
      error: new AnalyticsApiError(
        'Analytics access requires an assigned business role.',
        403,
        'FORBIDDEN'
      ),
    };
  }

  const cleanedFilters = buildMetricQueryFilters(filters);

  try {
    const broadPromise = queryMetrics(
      {
        metric_ids: [...ANALYTICS_BROAD_METRIC_IDS],
        record_class: filters.record_class,
        edition_id: filters.edition_id,
        as_of: filters.as_of,
        filters: cleanedFilters,
      },
      signal
    );

    const restrictedPromise: Promise<{
      forbidden: boolean;
      items: MetricQueryResult[];
    }> = permissionProfile.isViewerRestricted
      ? Promise.resolve({ forbidden: true, items: [] })
      : queryMetrics(
          {
            metric_ids: [...RESTRICTED_VIEWER_METRIC_IDS],
            record_class: filters.record_class,
            edition_id: filters.edition_id,
            as_of: filters.as_of,
            filters: cleanedFilters,
          },
          signal
        )
          .then((items) => ({ forbidden: false, items }))
          .catch((err) => {
            if (err instanceof DOMException && err.name === 'AbortError') throw err;
            if (err instanceof CampaignApiError && err.status === 403) {
              return { forbidden: true, items: [] };
            }
            throw err;
          });

    const [broadItems, restrictedOutcome] = await Promise.all([
      broadPromise,
      restrictedPromise,
    ]);

    const map: Record<string, MetricQueryResult> = {};
    const m30ByScenario: Record<string, MetricQueryResult> = {};

    for (const item of broadItems) {
      if (item.metric_id === 'M-30') {
        const sc = String(
          item.series_key ?? item.applied_filters?.scenario_id ?? ''
        );
        if (sc) {
          m30ByScenario[sc] = item;
        }
        if (!map['M-30']) {
          map['M-30'] = item;
        }
      } else {
        map[item.metric_id] = item;
      }
    }

    for (const item of restrictedOutcome.items) {
      map[item.metric_id] = item;
    }

    return {
      results: map,
      m30ByScenario,
      restrictedForbidden: restrictedOutcome.forbidden,
      error: null,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (err instanceof CampaignApiError) {
      return {
        results: {},
        m30ByScenario: {},
        restrictedForbidden: false,
        error: new AnalyticsApiError(err.message, err.status, err.code),
      };
    }
    return {
      results: {},
      m30ByScenario: {},
      restrictedForbidden: false,
      error: new AnalyticsApiError(
        'Metrics service is currently unavailable.',
        503,
        'METRICS_UNAVAILABLE'
      ),
    };
  }
}

export async function fetchAnalyticsWeeklyPacing(
  filters: AnalyticsFilters,
  permissionProfile: AnalyticsPermissionProfile,
  gateWeeks: GateScheduleWeek[],
  gateWeeklyPacing: GateWeeklyPacingRow[],
  gates: TargetGateRecord[],
  selectedScenarioId: string | null,
  signal?: AbortSignal
): Promise<{
  points: WeeklyPacingPoint[];
  unavailable: boolean;
}> {
  if (permissionProfile.verifiedByServer && !permissionProfile.canViewAnalytics) {
    return { points: [], unavailable: true };
  }

  const orderedWeeks = gateWeeks.slice(0, 10);
  const asOfDates = orderedWeeks.map((w) => w.week_end).filter(Boolean);
  if (asOfDates.length === 0) {
    return { points: [], unavailable: true };
  }

  const baseFilters = buildMetricQueryFilters(filters);

  try {
    const res = await requestJson<{
      metric_id: string;
      edition_id: string;
      record_class: AnalyticsRecordClass;
      series: Array<{ as_of: string; rows: Array<Record<string, unknown>> }>;
    }>(OVERVIEW_API_ENDPOINTS.metricsSeries, {
      method: 'POST',
      signal,
      body: JSON.stringify({
        metricId: 'M-08',
        editionId: filters.edition_id,
        recordClass: filters.record_class,
        asOfDates,
        filters: baseFilters,
      }),
    });

    const rowByDate = new Map<string, MetricQueryResult>();
    for (const entry of res.series ?? []) {
      const raw = entry.rows?.[0];
      if (raw) {
        rowByDate.set(entry.as_of, {
          metric_id: String(raw.metric_id ?? 'M-08'),
          value:
            raw.value !== null && raw.value !== undefined
              ? Number(raw.value)
              : null,
          numerator:
            raw.numerator !== null && raw.numerator !== undefined
              ? Number(raw.numerator)
              : null,
          denominator:
            raw.denominator !== null && raw.denominator !== undefined
              ? Number(raw.denominator)
              : null,
          unit: (raw.unit as string | null | undefined) ?? '₹',
          computable: Boolean(raw.computable),
          reason: (raw.reason as string | null | undefined) ?? null,
          record_class:
            (raw.record_class as AnalyticsRecordClass) ?? filters.record_class,
          as_of: String(raw.as_of ?? entry.as_of),
          applied_filters:
            (raw.filters_applied as Record<string, unknown> | undefined) ??
            (raw.applied_filters as Record<string, unknown> | undefined) ??
            {},
          data_version:
            (raw.data_version as string | number | null | undefined) ?? null,
        });
      }
    }

    const pacingByPeriod = new Map<string, GateWeeklyPacingRow>();
    for (const row of gateWeeklyPacing) {
      pacingByPeriod.set(row.period.toUpperCase(), row);
    }

    const points: WeeklyPacingPoint[] = orderedWeeks.map((wk) => {
      const periodUpper = wk.period.toUpperCase();
      const pacingRow = pacingByPeriod.get(periodUpper);
      const targetGate =
        gates.find(
          (g) =>
            g.kpi_id === 'K-G-01' &&
            (g.period?.toUpperCase() === periodUpper ||
              (g.week_no !== null && g.week_no === wk.week_no)) &&
            (!selectedScenarioId ||
              !g.scenario_id ||
              g.scenario_id === selectedScenarioId)
        ) ?? null;

      return {
        week: wk.period,
        weekNo: wk.week_no,
        weekEnd: wk.week_end,
        passed: wk.passed,
        metric: rowByDate.get(wk.week_end) ?? null,
        baseTarget: pacingRow?.base_target ?? null,
        planTarget: pacingRow?.plan_target ?? null,
        serverStatus: pacingRow?.status ?? targetGate?.status ?? null,
        targetGate,
      };
    });

    return { points, unavailable: false };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return { points: [], unavailable: true };
  }
}

const CHANNEL_FUNNEL_METRIC_IDS = [
  'M-23',
  'M-11',
  'M-12',
  'M-13',
  'M-09',
  'M-02',
  'M-21',
  'M-17',
] as const;

const SYNTHETIC_2025_FUNNEL_METRIC_IDS = [
  'M-23',
  'M-11',
  'M-12',
  'M-13',
  'M-09',
  'M-02',
] as const;

/**
 * Fetches funnel metrics per channel_group for the active edition AND
 * a completely separate comparison query against ED-2025 (historical_synthetic).
 */
export async function fetchChannelGroupFunnelComparison(
  filters: AnalyticsFilters,
  permissionProfile: AnalyticsPermissionProfile,
  signal?: AbortSignal
): Promise<ChannelGroupFunnelRow[]> {
  if (permissionProfile.verifiedByServer && !permissionProfile.canViewAnalytics) {
    return [];
  }

  const targetGroups =
    filters.channel_group !== 'all'
      ? CHANNEL_GROUPS.filter((g) => g.channel_group === filters.channel_group)
      : CHANNEL_GROUPS;

  const baseFilters = buildMetricQueryFilters(filters);

  return Promise.all(
    targetGroups.map(async (group): Promise<ChannelGroupFunnelRow> => {
      const currentPromise = queryMetrics(
        {
          metric_ids: [...CHANNEL_FUNNEL_METRIC_IDS],
          record_class: filters.record_class,
          edition_id: filters.edition_id,
          as_of: filters.as_of,
          filters: { ...baseFilters, channel_group: group.channel_group },
        },
        signal
      )
        .then((items) => {
          const map: Record<string, MetricQueryResult> = {};
          for (const item of items) map[item.metric_id] = item;
          return { map, error: null as string | null };
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') throw err;
          return {
            map: {} as Record<string, MetricQueryResult>,
            error: err instanceof Error ? err.message : 'Unable to query channel metrics.',
          };
        });

      const syntheticPromise = queryMetrics(
        {
          metric_ids: [...SYNTHETIC_2025_FUNNEL_METRIC_IDS],
          record_class: 'historical_synthetic',
          edition_id: 'ED-2025',
          as_of: '2025-12-31',
          filters: { channel_group: group.channel_group },
        },
        signal
      )
        .then((items) => {
          const map: Record<string, MetricQueryResult> = {};
          for (const item of items) map[item.metric_id] = item;
          return { map, error: null as string | null };
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') throw err;
          return {
            map: {} as Record<string, MetricQueryResult>,
            error:
              err instanceof Error
                ? err.message
                : 'Unable to query 2025 synthetic comparison.',
          };
        });

      const [cur, syn] = await Promise.all([currentPromise, syntheticPromise]);

      return {
        channel_group: group.channel_group,
        label: group.label,
        currentMetrics: cur.map,
        synthetic2025Metrics: syn.map,
        currentError: cur.error,
        syntheticError: syn.error,
      };
    })
  );
}

const COMPARISON_METRIC_IDS: ReadonlyArray<CampaignMetricId | 'M-12'> = [
  'M-23',
  'M-11',
  'M-12',
  'M-13',
  'M-09',
  'M-02',
  'M-17',
];

export async function fetchAnalyticsComparisonRows(
  scopeType: AnalyticsComparisonScope,
  filters: AnalyticsFilters,
  campaigns: CampaignEntity[],
  permissionProfile: AnalyticsPermissionProfile,
  signal?: AbortSignal
): Promise<AnalyticsComparisonRow[]> {
  if (permissionProfile.verifiedByServer && !permissionProfile.canViewAnalytics) {
    return [];
  }

  const baseFilters = buildMetricQueryFilters(filters);

  if (scopeType === 'channel') {
    const targetGroups =
      filters.channel_group !== 'all'
        ? CHANNEL_GROUPS.filter((g) => g.channel_group === filters.channel_group)
        : CHANNEL_GROUPS;

    return Promise.all(
      targetGroups.map(async (grp): Promise<AnalyticsComparisonRow> => {
        try {
          const [items, synItems] = await Promise.all([
            queryMetrics(
              {
                metric_ids: [...COMPARISON_METRIC_IDS],
                record_class: filters.record_class,
                edition_id: filters.edition_id,
                as_of: filters.as_of,
                filters: { ...baseFilters, channel_group: grp.channel_group },
              },
              signal
            ),
            queryMetrics(
              {
                metric_ids: [...COMPARISON_METRIC_IDS],
                record_class: 'historical_synthetic',
                edition_id: 'ED-2025',
                as_of: '2025-12-31',
                filters: { channel_group: grp.channel_group },
              },
              signal
            ).catch(() => [] as MetricQueryResult[]),
          ]);

          const map: Partial<Record<CampaignMetricId | 'M-12', MetricQueryResult>> =
            {};
          for (const item of items) {
            if (
              COMPARISON_METRIC_IDS.includes(
                item.metric_id as CampaignMetricId | 'M-12'
              )
            ) {
              map[item.metric_id as CampaignMetricId | 'M-12'] = item;
            }
          }

          const synMap: Partial<
            Record<CampaignMetricId | 'M-12', MetricQueryResult>
          > = {};
          for (const item of synItems) {
            if (
              COMPARISON_METRIC_IDS.includes(
                item.metric_id as CampaignMetricId | 'M-12'
              )
            ) {
              synMap[item.metric_id as CampaignMetricId | 'M-12'] = item;
            }
          }

          return {
            scopeType: 'channel',
            id: grp.channel_group,
            label: grp.label,
            subtitle: `channel_group: ${grp.channel_group}`,
            metrics: map,
            synthetic2025Metrics: synMap,
          };
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') throw err;
          const isForbidden =
            err instanceof CampaignApiError && err.status === 403;
          return {
            scopeType: 'channel',
            id: grp.channel_group,
            label: grp.label,
            subtitle: `channel_group: ${grp.channel_group}`,
            metrics: {},
            forbidden: isForbidden,
            error:
              err instanceof CampaignApiError
                ? err.message
                : 'Metrics unavailable for this channel group.',
          };
        }
      })
    );
  }

  const filteredCampaigns = campaigns.filter((c) => {
    if (filters.campaign_id !== 'all' && c.campaign_id !== filters.campaign_id) {
      return false;
    }
    if (
      filters.channel_group !== 'all' &&
      c.channel_group &&
      c.channel_group !== filters.channel_group
    ) {
      return false;
    }
    if (filters.bet_id !== 'all' && c.bet_id !== filters.bet_id) {
      return false;
    }
    return true;
  });

  return Promise.all(
    filteredCampaigns.map(async (c): Promise<AnalyticsComparisonRow> => {
      try {
        const items = await queryMetrics(
          {
            metric_ids: [...COMPARISON_METRIC_IDS],
            record_class: filters.record_class,
            edition_id: filters.edition_id,
            as_of: filters.as_of,
            filters: { ...baseFilters, campaign_id: c.campaign_id },
          },
          signal
        );
        const map: Partial<Record<CampaignMetricId | 'M-12', MetricQueryResult>> =
          {};
        for (const item of items) {
          if (
            COMPARISON_METRIC_IDS.includes(
              item.metric_id as CampaignMetricId | 'M-12'
            )
          ) {
            map[item.metric_id as CampaignMetricId | 'M-12'] = item;
          }
        }
        return {
          scopeType: 'campaign',
          id: c.campaign_id,
          label: c.name,
          subtitle: c.channel_name || c.channel_id,
          betId: c.bet_id ?? null,
          metrics: map,
        };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        const isForbidden =
          err instanceof CampaignApiError && err.status === 403;
        return {
          scopeType: 'campaign',
          id: c.campaign_id,
          label: c.name,
          subtitle: c.channel_name || c.channel_id,
          betId: c.bet_id ?? null,
          metrics: {},
          forbidden: isForbidden,
          error:
            err instanceof CampaignApiError
              ? err.message
              : 'Metrics unavailable for this campaign.',
        };
      }
    })
  );
}

export async function querySingleAnalyticsMetric(
  metricId: string,
  filters: AnalyticsFilters,
  signal?: AbortSignal
): Promise<MetricQueryResult | null> {
  const items = await queryMetrics(
    {
      metric_ids: [metricId],
      record_class: filters.record_class,
      edition_id: filters.edition_id,
      as_of: filters.as_of,
      filters: buildMetricQueryFilters(filters),
    },
    signal
  );
  return items.find((item) => item.metric_id === metricId) ?? null;
}

export async function fetchAnalyticsDataVersion(
  signal?: AbortSignal
): Promise<string | number | null> {
  try {
    const res = await requestJson<{
      data_version?: string | number | null;
      version?: string | number | null;
    }>(OVERVIEW_API_ENDPOINTS.version, { signal });
    return res.data_version ?? res.version ?? null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return null;
  }
}

export { CANONICAL_BETS, CANONICAL_CHANNELS };
