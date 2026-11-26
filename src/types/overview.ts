export type NavGroupId = 'workspace' | 'manage' | 'monitor' | 'intelligence';

export type NavSectionId =
  | 'overview'
  | 'campaigns'
  | 'sponsors'
  | 'pipeline'
  | 'tasks'
  | 'collections'
  | 'analytics'
  | 'growth-analyst'
  | 'team-settings';

export type DataLoadStatus = 'loading' | 'empty' | 'error' | 'ready';

export type DataClassFilter = 'all' | 'cash' | 'in_kind';

export type ScenarioKey = 'base' | 'plan' | 'stretch';

export interface OverviewFilterState {
  editionId: string;
  recordClass: 'simulated' | 'historical_synthetic' | 'live';
  asOf: string;
  dataClass: DataClassFilter;
  campaignId: string;
}

export interface FilterOption {
  value: string;
  label: string;
}

export interface GrowthPulseMetric {
  id:
    | 'active_opportunities'
    | 'signed_value'
    | 'cash_collected'
    | 'outstanding_collections';
  metricId: string;
  label: string;
  isNorthStar?: boolean;
  formattedValue: string | null;
  computable: boolean;
  reason?: string | null;
  comparisonText: string | null;
  supportingLabel: string;
  secondaryBreakdownLabel?: string | null;
  recordClassLabel?: string;
  asOfDate?: string;
}

export type FunnelStageKey =
  | 'prospects'
  | 'conversations'
  | 'qualified'
  | 'proposals'
  | 'confirmed_partnerships';

export interface FunnelStageRecord {
  key: FunnelStageKey;
  label: string;
  metricId: string;
  count: number | null;
  rateFormatted: string | null;
  conversionFromPreviousPct: number | null;
  cashValueFormatted: string | null;
  inKindValueFormatted: string | null;
  reason?: string | null;
  description: string;
}

export interface CashOutcomeSummary {
  collectedCashFormatted: string | null;
  collectedReason?: string | null;
  confirmedCashBasisFormatted: string | null;
  collectionRateFormatted: string | null;
  collectionRateReason?: string | null;
  inKindValueSeparateFormatted: string | null;
  definitionNote: string;
  recordClassLabel?: string;
  asOfDate?: string;
}

export interface WeeklyMilestonePoint {
  weekId: string;
  label: string;
  weekEnd: string | null;
  passed: boolean;
  actualValue: number | null;
  actualFormatted: string | null;
  baseTargetValue: number | null;
  baseTargetFormatted: string | null;
  planTargetValue: number | null;
  planTargetFormatted: string | null;
  gateStatus: string | null;
  reason?: string | null;
  progressRatio: number | null;
}

export interface TargetPacingSnapshot {
  selectedScenario: ScenarioKey;
  actualSignedFormatted: string | null;
  actualSignedReason?: string | null;
  latestGateStatusLabel: string | null;
  latestGateWeekLabel: string | null;
  scenarioTargets: Record<
    ScenarioKey,
    {
      scenarioId: string;
      label: string;
      shortLabel?: string;
      targetFormatted: string | null;
      p50Formatted?: string | null;
      cashCollectedFormatted: string | null;
      cashCollectedReason?: string | null;
    }
  >;
  weeklyMilestones: WeeklyMilestonePoint[];
  cashCollectionGate: {
    gateLabel: string;
    collectedFormatted: string | null;
    collectionRateFormatted: string | null;
    outstandingFormatted: string | null;
    gateTargetFormatted: string | null;
    gateStatusLabel: string | null;
    reason?: string | null;
  };
}

export type CampaignHealthStatus = 'nominal' | 'watch' | 'at_risk' | 'unassigned';

export type CampaignSortKey =
  | 'campaignName'
  | 'ownerName'
  | 'pipelineValue'
  | 'proposalCount'
  | 'signedValue'
  | 'signedCash'
  | 'collectedCash'
  | 'health';

export type SortDirection = 'asc' | 'desc';

export interface CampaignSortConfig {
  key: CampaignSortKey;
  direction: SortDirection;
}

export interface CampaignPerformanceRow {
  id: string;
  campaignName: string;
  ownerName: string;
  pipelineValue: number | null;
  pipelineFormatted: string | null;
  proposalCount: number | null;
  signedValue: number | null;
  signedFormatted: string | null;
  signedCash: number | null;
  signedCashFormatted: string | null;
  collectedCash: number | null;
  collectedCashFormatted: string | null;
  health: CampaignHealthStatus;
  healthLabel: string;
}

export type AttentionCategory =
  | 'all'
  | 'stalled_opportunities'
  | 'overdue_follow_ups'
  | 'collection_risks'
  | 'campaign_warnings'
  | 'execution_issues';

export interface NeedsAttentionItem {
  id: string;
  category: Exclude<AttentionCategory, 'all'>;
  categoryLabel: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  whatHappened: string;
  whyItMatters: string;
  relevantEvidence: string;
  responsibleOwner: string;
  recommendedNextStep: string;
  timestampLabel: string;
  targetEntityType?: 'campaign' | 'sponsor' | 'opportunity' | 'task' | 'collections' | 'analytics';
  targetEntityId?: string;
}

export interface StrategicBetSlot {
  id: string;
  indexLabel: string;
  title: string;
  ruleId: string | null;
  progressPct: number | null;
  thresholdStatus: string | null;
  band: string | null;
  metricSummary: string | null;
  keepIf?: string | null;
  changeIf?: string | null;
  escalateIf?: string | null;
  evaluateAt?: string | null;
}

export interface TeamExecutionSnapshot {
  openTasksCount: number | null;
  overdueTasksCount: number | null;
  activeOwnersCount: number | null;
  capacityStatusLabel: string | null;
  capacityReason?: string | null;
  nextDueSummary: string | null;
}

export interface OverviewDashboardPayload {
  editionId: string;
  recordClass: 'simulated' | 'historical_synthetic' | 'live';
  asOfTimestamp: string;
  campaignOptions: FilterOption[];
  pulseMetrics: GrowthPulseMetric[];
  funnelStages: FunnelStageRecord[];
  cashOutcome: CashOutcomeSummary;
  targetPacing: TargetPacingSnapshot;
  campaigns: CampaignPerformanceRow[];
  attentionItems: NeedsAttentionItem[];
  strategicBets: StrategicBetSlot[];
  teamExecution: TeamExecutionSnapshot;
}

export interface ApiErrorInfo {
  code: string;
  message: string;
  endpoint: string;
}
