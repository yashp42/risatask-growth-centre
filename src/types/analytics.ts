import type {
  BetId,
  CampaignEntity,
  CampaignMetricId,
  MetricQueryResult,
} from './campaigns';
import type { CategoryEntity } from './sponsors';

export type AnalyticsRecordClass =
  | 'simulated'
  | 'historical_synthetic'
  | 'live';

export type AnalyticsTab =
  | 'performance'
  | 'funnel'
  | 'campaigns_channels'
  | 'strategy_pipeline'
  | 'explorer';

export type AnalyticsComparisonScope = 'channel' | 'campaign';

export type ChannelGroupId = 'warm' | 'inbound' | 'cold' | 'renewal' | 'premium';

export interface AnalyticsFilters {
  record_class: AnalyticsRecordClass;
  edition_id: string;
  as_of: string;
  campaign_id: string;
  channel_group: string;
  bet_id: string;
  scenario_id: string;
}

/**
 * Canonical SCENARIO_REFERENCE entity (01_conceptual_data_model.md §4F)
 */
export interface ScenarioReferenceRecord {
  scenario_id: string;
  name: string;
  status: string;
  expected_cash: number;
  p10?: number | null;
  p50?: number | null;
  p90?: number | null;
  window_pw?: number | null;
  preseason_pw?: number | null;
  decision_id?: string | null;
  output_checksum?: string | null;
  record_class?: string | null;
  description?: string | null;
}

/**
 * Canonical TARGET_VERSION / gate reference from GET /api/gates
 */
export interface TargetGateRecord {
  gate_id: string;
  edition_id?: string | null;
  kpi_id?: string | null;
  metric_id?: string | null;
  scenario_id?: string | null;
  period?: string | null;
  week_no?: number | null;
  week_end?: string | null;
  target_value?: number | null;
  threshold?: number | null;
  threshold_label?: string | null;
  checkpoint_label?: string | null;
  actual_value?: number | null;
  status?: string | null;
  pass?: boolean | null;
  decision_id?: string | null;
  name?: string | null;
  description?: string | null;
}

export interface GateScheduleWeek {
  period: string;
  week_no: number;
  week_end: string;
  passed: boolean;
}

export interface GateWeeklyPacingRow {
  period: string;
  week_no: number;
  week_end: string | null;
  passed: boolean;
  base_target: number | null;
  plan_target: number | null;
  actual_value: number | null;
  computable: boolean;
  reason: string | null;
  status: string;
}

export interface CashCollectionGateSnapshot {
  kpi_id: string;
  metric_id: string;
  threshold: number;
  due_date?: string | null;
  is_due?: boolean;
  actual_value: number | null;
  computable: boolean;
  reason: string | null;
  status: string;
}

/**
 * Canonical THRESHOLD_RULE entity with server-side band evaluation from GET /api/rules
 */
export interface ThresholdRuleRecord {
  rule_id: string;
  kpi_id: string;
  kpi_name?: string | null;
  bet_id?: BetId | string | null;
  metric_id?: string | null;
  evaluate_at: string;
  keep_if?: string | null;
  change_if?: string | null;
  escalate_if: string;
  response: string;
  owner_role?: string | null;
  decision_id?: string | null;
  rule_status: string;
  current_value?: number | null;
  current_numerator?: number | null;
  current_denominator?: number | null;
  current_unit?: string | null;
  computable?: boolean;
  reason?: string | null;
  band?: 'keep' | 'change' | 'escalate' | 'stop' | 'not_due' | 'manual_review' | 'not_computable' | string | null;
  status_label?: string | null;
  severity?: 'ok' | 'warning' | 'critical' | 'neutral' | string | null;
  record_class?: string | null;
  as_of?: string | null;
  evaluated_status?: string | null;
  fired?: boolean | null;
}

/**
 * Canonical MODEL_ASSUMPTION entity (01_conceptual_data_model.md §4F)
 */
export interface ModelAssumptionRecord {
  assumption_id: string;
  variable: string;
  frozen_value: string;
  uncertainty?: string | null;
  validation_kpi_id?: string | null;
  experiment_id?: string | null;
}

/**
 * Canonical METRIC_DEFINITION from GET /api/reference/metrics
 */
export interface MetricReferenceRecord {
  metric_id: string;
  kpi_id?: string | null;
  name: string;
  business_meaning?: string | null;
  formula: string;
  numerator?: string | null;
  denominator?: string | null;
  aggregation?: string | null;
  time_period?: string | null;
  inclusion_exclusion?: string | null;
  value_nature?: string | null;
  unit?: string | null;
  computable_2025?: boolean | string | null;
  definition_version?: string | number | null;
}

/**
 * Canonical KPI_DEFINITION from GET /api/reference/kpis
 */
export interface KpiReferenceRecord {
  kpi_id: string;
  name: string;
  bet_id?: string | null;
  kpi_type?: string | null;
  definition: string;
  grain?: string | null;
  frequency?: string | null;
  metric_id?: string | null;
}

/**
 * Canonical EXPERIMENT & EXPERIMENT_RESULT (01_conceptual_data_model.md §4F)
 */
export interface ExperimentReferenceRecord {
  experiment_id: string;
  bet_id: string;
  hypothesis: string;
  population?: string | null;
  intervention?: string | null;
  sample_size?: string | null;
  time_limit?: string | null;
  primary_kpi_id?: string | null;
  rule_id?: string | null;
  status: 'planned' | 'running' | 'decided' | string;
}

export interface ExperimentResultRecord {
  result_id: string;
  experiment_id: string;
  kpi_actual_id: string;
  n: number;
  decision: 'keep' | 'change' | 'stop' | 'escalate' | string;
  decided_by: string;
  decided_at: string;
  note?: string | null;
}

/**
 * Canonical FORECAST_VERSION (01_conceptual_data_model.md §4F)
 */
export interface ForecastVersionRecord {
  forecast_id: string;
  edition_id: string;
  baseline_scenario_id: string;
  model_version: string;
  input_data_version: string;
  run_at: string;
  expected_cash?: number | null;
  p10?: number | null;
  p90?: number | null;
  status: 'draft' | 'reviewed' | 'published' | string;
  reviewed_by?: string | null;
}

export interface WeeklyPacingPoint {
  week: string;
  weekNo: number;
  weekEnd: string | null;
  passed: boolean;
  metric: MetricQueryResult | null;
  baseTarget: number | null;
  planTarget: number | null;
  serverStatus: string | null;
  targetGate: TargetGateRecord | null;
}

export interface AnalyticsComparisonRow {
  scopeType: AnalyticsComparisonScope;
  id: string;
  label: string;
  subtitle?: string | null;
  betId?: string | null;
  metrics: Partial<Record<CampaignMetricId | 'M-12', MetricQueryResult>>;
  synthetic2025Metrics?: Partial<Record<CampaignMetricId | 'M-12', MetricQueryResult>>;
  error?: string | null;
  forbidden?: boolean;
}

export interface ChannelGroupFunnelRow {
  channel_group: ChannelGroupId;
  label: string;
  currentMetrics: Record<string, MetricQueryResult>;
  synthetic2025Metrics: Record<string, MetricQueryResult>;
  currentError?: string | null;
  syntheticError?: string | null;
}

export interface AnalyticsFilterCatalog {
  campaigns: CampaignEntity[];
  categories: CategoryEntity[];
  owners: Array<{ id: string; label: string }>;
}

export interface AnalyticsPermissionProfile {
  canViewAnalytics: boolean;
  canViewCashCollectionsMetrics: boolean;
  canViewHoursCapacityMetrics: boolean;
  canDrillToCampaigns: boolean;
  canDrillToPipeline: boolean;
  canDrillToSponsors: boolean;
  isViewerRestricted: boolean;
  verifiedByServer: boolean;
  currentMemberId: string | null;
}
