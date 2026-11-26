import { apiFetch } from './authSession';
import type {
  ApiErrorInfo,
  AttentionCategory,
  CampaignHealthStatus,
  CampaignPerformanceRow,
  CashOutcomeSummary,
  DataLoadStatus,
  FilterOption,
  FunnelStageRecord,
  GrowthPulseMetric,
  NavGroupId,
  NavSectionId,
  NeedsAttentionItem,
  OverviewDashboardPayload,
  OverviewFilterState,
  ScenarioKey,
  StrategicBetSlot,
  TargetPacingSnapshot,
  WeeklyMilestonePoint,
} from '../types/overview';

export const OVERVIEW_API_ENDPOINTS = {
  overviewSnapshot: '/api/overview',
  editions: '/api/editions',
  campaigns: '/api/campaigns',
  outreach: '/api/outreach',
  interactions: '/api/interactions',
  meetings: '/api/meetings',
  opportunities: '/api/opportunities',
  sponsors: '/api/sponsors',
  contacts: '/api/contacts',
  contracts: '/api/contracts',
  contractLines: '/api/contract-lines',
  paymentSchedule: '/api/collections/schedule',
  invoices: '/api/collections/invoices',
  receipts: '/api/collections/receipts',
  me: '/api/me',
  version: '/api/version',
  tasks: '/api/tasks',
  escalations: '/api/escalations',
  timeLogs: '/api/time-logs',
  qualifications: '/api/qualifications',
  ownership: '/api/ownership',
  referrals: '/api/referrals',
  networkPartners: '/api/network-partners',
  team: '/api/team',
  teamMembers: '/api/team/members',
  teamRoles: '/api/team/roles',
  audit: '/api/audit',
  collections: '/api/collections',
  collectionsSchedule: '/api/collections/schedule',
  collectionsInvoices: '/api/collections/invoices',
  collectionsBalances: '/api/collections/balances',
  collectionsReceipts: '/api/collections/receipts',
  collectionsAllocations: '/api/collections/allocations',
  metricsQuery: '/api/metrics/query',
  metricsSeries: '/api/metrics/series',
  gates: '/api/gates',
  rules: '/api/rules',
  referenceScenarios: '/api/reference/scenarios',
  referenceRules: '/api/rules',
  referenceGates: '/api/gates',
  referenceBets: '/api/reference/bets',
  referenceChannels: '/api/reference/channels',
  referenceCategories: '/api/reference/categories',
  referenceAssets: '/api/reference/assets',
  referenceExperiments: '/api/reference/experiments',
  referenceAssumptions: '/api/reference/assumptions',
  referenceDecisions: '/api/reference/decisions',
  referenceMetrics: '/api/reference/metrics',
  referenceKpis: '/api/reference/kpis',
  aiChat: '/api/ai/chat',
  aiAsk: '/api/ai/ask',
  aiQuota: '/api/ai/quota',
  aiFeedback: '/api/ai/feedback',
  aiConversation: (id: string) => `/api/ai/conversations/${encodeURIComponent(id)}`,
  aiActionConfirm: (id: string) => `/api/actions/${encodeURIComponent(id)}/confirm`,
  aiActionCancel: (id: string) => `/api/actions/${encodeURIComponent(id)}/cancel`,
  aiBatchConfirm: (batchId: string) =>
    `/api/ai/actions/batch/${encodeURIComponent(batchId)}/confirm`,
  aiBatchCancel: (batchId: string) =>
    `/api/ai/actions/batch/${encodeURIComponent(batchId)}/cancel`,
  funnelStageRecords: '/api/pipeline/stages',
  attentionQueue: '/api/attention-queue',
  globalSearch: '/api/search',
} as const;

export interface NavItemDefinition {
  id: NavSectionId;
  label: string;
  group: NavGroupId;
  groupLabel: string;
  description: string;
}

export const SIDEBAR_NAV_GROUPS: ReadonlyArray<{
  id: NavGroupId;
  label: string;
  items: ReadonlyArray<NavItemDefinition>;
}> = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      {
        id: 'overview',
        label: 'Overview',
        group: 'workspace',
        groupLabel: 'Workspace',
        description:
          'Sponsorship performance, pacing, bottlenecks, and priority actions.',
      },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    items: [
      {
        id: 'campaigns',
        label: 'Campaigns',
        group: 'manage',
        groupLabel: 'Manage',
        description: 'Campaign portfolios, ownership, targets, and deliverables.',
      },
      {
        id: 'sponsors',
        label: 'Sponsors',
        group: 'manage',
        groupLabel: 'Manage',
        description: 'Brand directory, relationship history, and key contacts.',
      },
      {
        id: 'pipeline',
        label: 'Pipeline',
        group: 'manage',
        groupLabel: 'Manage',
        description:
          'Active sponsorship opportunities across progression stages.',
      },
      {
        id: 'tasks',
        label: 'Tasks',
        group: 'manage',
        groupLabel: 'Manage',
        description: 'Follow-ups, proposal deadlines, and team assignments.',
      },
    ],
  },
  {
    id: 'monitor',
    label: 'Monitor',
    items: [
      {
        id: 'collections',
        label: 'Collections',
        group: 'monitor',
        groupLabel: 'Monitor',
        description:
          'Invoicing, cash receipts, and collection gate tracking.',
      },
      {
        id: 'analytics',
        label: 'Analytics',
        group: 'monitor',
        groupLabel: 'Monitor',
        description:
          'Conversion diagnostics, cohort trends, and category yields.',
      },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      {
        id: 'growth-analyst',
        label: 'Growth Analyst',
        group: 'intelligence',
        groupLabel: 'Intelligence',
        description:
          'Guided performance investigation and decision support.',
      },
    ],
  },
];

export const SETTINGS_NAV_ITEM: NavItemDefinition = {
  id: 'team-settings',
  label: 'Team & Settings',
  group: 'workspace',
  groupLabel: 'Workspace',
  description: 'Team roles, festival edition configuration, and approval rules.',
};

export function findNavItem(sectionId: NavSectionId): NavItemDefinition {
  if (sectionId === 'team-settings') {
    return SETTINGS_NAV_ITEM;
  }
  for (const group of SIDEBAR_NAV_GROUPS) {
    const found = group.items.find((item) => item.id === sectionId);
    if (found) return found;
  }
  return SIDEBAR_NAV_GROUPS[0].items[0];
}

export const DEFAULT_FILTER_OPTIONS: {
  dataClasses: FilterOption[];
  campaigns: FilterOption[];
} = {
  dataClasses: [
    { value: 'all', label: 'All (Cash & In-kind separate)' },
    { value: 'cash', label: 'Cash only' },
    { value: 'in_kind', label: 'In-kind only' },
  ],
  campaigns: [{ value: 'all', label: 'All campaigns' }],
};

export const ATTENTION_CATEGORY_OPTIONS: ReadonlyArray<{
  id: AttentionCategory;
  label: string;
}> = [
  { id: 'all', label: 'All' },
  { id: 'stalled_opportunities', label: 'Stalled opportunities' },
  { id: 'overdue_follow_ups', label: 'Overdue follow-ups' },
  { id: 'collection_risks', label: 'Collection risks' },
  { id: 'campaign_warnings', label: 'Campaign warnings' },
  { id: 'execution_issues', label: 'Execution issues' },
];

export const PULSE_METRIC_DEFINITIONS: ReadonlyArray<GrowthPulseMetric> = [
  {
    id: 'active_opportunities',
    metricId: 'M-21',
    label: 'Open pipeline value',
    formattedValue: null,
    computable: false,
    reason: null,
    comparisonText: null,
    supportingLabel: 'M-21 unweighted proposed face value of open opportunities (not a forecast).',
    secondaryBreakdownLabel: 'Unweighted proposed face value',
  },
  {
    id: 'signed_value',
    metricId: 'M-02',
    label: 'Signed sponsorship value',
    formattedValue: null,
    computable: false,
    reason: null,
    comparisonText: null,
    supportingLabel:
      'M-02 confirmed value. Cash (M-03) and in-kind (M-04) are always kept separate.',
    secondaryBreakdownLabel: 'Cash & in-kind separated',
  },
  {
    id: 'cash_collected',
    metricId: 'M-01',
    label: 'Cash collected before fest',
    isNorthStar: true,
    formattedValue: null,
    computable: false,
    reason: null,
    comparisonText: null,
    supportingLabel:
      'M-01 reconciled & allocated cash receipts before fest. Excludes pledges and in-kind.',
    secondaryBreakdownLabel: 'Cash receipts only',
  },
  {
    id: 'outstanding_collections',
    metricId: 'M-07',
    label: 'Outstanding cash',
    formattedValue: null,
    computable: false,
    reason: null,
    comparisonText: null,
    supportingLabel: 'M-07 signed cash commitments awaiting reconciled receipt settlement.',
    secondaryBreakdownLabel: 'Cash commitments',
  },
];

export const FUNNEL_STAGE_DEFINITIONS: ReadonlyArray<FunnelStageRecord> = [
  {
    key: 'prospects',
    label: 'Touches by campaign',
    metricId: 'M-23',
    count: null,
    rateFormatted: null,
    conversionFromPreviousPct: null,
    cashValueFormatted: null,
    inKindValueFormatted: null,
    description:
      'Outreach counts summed over campaigns (M-23 denominator). A brand contacted by two campaigns counts in each.',
  },
  {
    key: 'conversations',
    label: 'Responses by campaign',
    metricId: 'M-23',
    count: null,
    rateFormatted: null,
    conversionFromPreviousPct: null,
    cashValueFormatted: null,
    inKindValueFormatted: null,
    description:
      'Responses summed over campaigns (M-23 numerator / response rate). A brand responding across two campaigns counts in each.',
  },
  {
    key: 'qualified',
    label: 'Meetings held',
    metricId: 'M-11',
    count: null,
    rateFormatted: null,
    conversionFromPreviousPct: null,
    cashValueFormatted: null,
    inKindValueFormatted: null,
    description: 'Brands with meeting_held (M-11 numerator / meeting rate).',
  },
  {
    key: 'proposals',
    label: 'Proposals sent',
    metricId: 'M-13',
    count: null,
    rateFormatted: null,
    conversionFromPreviousPct: null,
    cashValueFormatted: null,
    inKindValueFormatted: null,
    description: 'Opportunities reaching proposal_sent (M-13 denominator).',
  },
  {
    key: 'confirmed_partnerships',
    label: 'Confirmed partnerships',
    metricId: 'M-09',
    count: null,
    rateFormatted: null,
    conversionFromPreviousPct: null,
    cashValueFormatted: null,
    inKindValueFormatted: null,
    description: 'Latest stage = partner_confirmed (M-09 & M-13 win rate).',
  },
];

export const DEFAULT_CASH_OUTCOME: CashOutcomeSummary = {
  collectedCashFormatted: null,
  confirmedCashBasisFormatted: null,
  collectionRateFormatted: null,
  inKindValueSeparateFormatted: null,
  definitionNote:
    'Cleared & allocated cash receipts (M-01) and collection ratio (M-06). In-kind value (M-04) is strictly separate.',
};

export function createEmptyTargetPacing(
  selectedScenario: ScenarioKey = 'base'
): TargetPacingSnapshot {
  return {
    selectedScenario,
    actualSignedFormatted: null,
    latestGateStatusLabel: null,
    latestGateWeekLabel: null,
    scenarioTargets: {
      base: {
        scenarioId: 'SC-01',
        label: 'Base cash target (SC-01)',
        shortLabel: 'Base (SC-01)',
        targetFormatted: null,
        p50Formatted: null,
        cashCollectedFormatted: null,
      },
      plan: {
        scenarioId: 'SC-02',
        label: 'Plan cash target (SC-02)',
        shortLabel: 'Plan (SC-02)',
        targetFormatted: null,
        p50Formatted: null,
        cashCollectedFormatted: null,
      },
      stretch: {
        scenarioId: 'SC-03',
        label: 'Stretch cash target (SC-03)',
        shortLabel: 'Stretch (SC-03)',
        targetFormatted: null,
        p50Formatted: null,
        cashCollectedFormatted: null,
      },
    },
    weeklyMilestones: [],
    cashCollectionGate: {
      gateLabel: 'T−7 cash collection gate',
      collectedFormatted: null,
      collectionRateFormatted: null,
      outstandingFormatted: null,
      gateTargetFormatted: null,
      gateStatusLabel: null,
    },
  };
}

export const STRATEGIC_BET_SLOTS: ReadonlyArray<StrategicBetSlot> = [];

export function createEmptyOverviewPayload(
  scenario: ScenarioKey = 'base',
  filters?: Partial<OverviewFilterState>
): OverviewDashboardPayload {
  return {
    editionId: filters?.editionId ?? 'ED-2026-DEMO',
    recordClass: filters?.recordClass ?? 'simulated',
    asOfTimestamp: filters?.asOf ?? '',
    campaignOptions: DEFAULT_FILTER_OPTIONS.campaigns,
    pulseMetrics: [...PULSE_METRIC_DEFINITIONS],
    funnelStages: [...FUNNEL_STAGE_DEFINITIONS],
    cashOutcome: { ...DEFAULT_CASH_OUTCOME },
    targetPacing: createEmptyTargetPacing(scenario),
    campaigns: [],
    attentionItems: [],
    strategicBets: [],
    teamExecution: {
      openTasksCount: null,
      overdueTasksCount: null,
      activeOwnersCount: null,
      capacityStatusLabel: null,
      nextDueSummary: null,
    },
  };
}

export interface OverviewQueryResult {
  status: DataLoadStatus;
  payload: OverviewDashboardPayload;
  error: ApiErrorInfo | null;
}

interface RawMetricRow {
  metric_id: string;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  unit: string | null;
  computable: boolean;
  reason: string | null;
  record_class: string;
  as_of: string;
  applied_filters?: Record<string, unknown>;
  filters_applied?: Record<string, unknown>;
  series_key?: string | null;
  data_version?: string | number | null;
}

interface RawGateWeek {
  period: string;
  week_no: number;
  week_end: string;
  passed: boolean;
}

interface RawGatePacing {
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

interface RawGatesResponse {
  edition_id: string;
  record_class: 'simulated' | 'historical_synthetic' | 'live';
  as_of: string;
  weeks: RawGateWeek[];
  weekly_pacing: RawGatePacing[];
  latest_passed_week: RawGatePacing | null;
  cash_gate: {
    kpi_id: string;
    metric_id: string;
    threshold: number;
    actual_value: number | null;
    computable: boolean;
    reason: string | null;
    status: string;
  };
}

interface RawRuleRow {
  rule_id: string;
  kpi_id: string;
  kpi_name: string | null;
  bet_id: string | null;
  metric_id: string | null;
  evaluate_at: string;
  keep_if: string | null;
  change_if: string | null;
  escalate_if: string;
  response: string;
  current_value: number | null;
  current_unit: string | null;
  computable: boolean;
  reason: string | null;
  band: string;
  status_label: string;
  severity: string;
}

class OverviewFetchError extends Error {
  readonly status: number;
  readonly code: string;
  readonly endpoint: string;

  constructor(message: string, status: number, code: string, endpoint: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.endpoint = endpoint;
  }
}

async function fetchApiJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await apiFetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const ct = response.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    throw new OverviewFetchError(
      `API endpoint returned non-JSON (${response.status})`,
      response.status,
      'SERVICE_UNAVAILABLE',
      url
    );
  }
  const body = (await response.json()) as T & {
    message?: string;
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new OverviewFetchError(
      body.message || body.error || `Request failed (HTTP ${response.status})`,
      response.status,
      body.code || `HTTP_${response.status}`,
      url
    );
  }
  return body;
}

function formatInrDisplay(val: number | null | undefined): string | null {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  if (Math.abs(val) >= 100000) {
    return `₹${(val / 100000).toFixed(2)}L`;
  }
  return `₹${Math.round(val).toLocaleString('en-IN')}`;
}

function formatLakhTarget(val: number | null | undefined): string | null {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  return `₹${val.toFixed(1)}L`;
}

function formatServerMetric(row: RawMetricRow | undefined | null): string | null {
  if (!row || !row.computable || row.value === null || row.value === undefined) {
    return null;
  }
  if (row.unit === 'ratio') {
    return `${(row.value * 100).toFixed(1)}%`;
  }
  if (row.unit === '₹ lakh' || row.unit === 'lakh') {
    return `₹${row.value.toFixed(2)}L`;
  }
  if (row.unit === '₹') {
    return formatInrDisplay(row.value);
  }
  if (row.unit === 'days') {
    return `${row.value.toFixed(1)} d`;
  }
  return Number.isInteger(row.value)
    ? row.value.toLocaleString('en-IN')
    : row.value.toFixed(1);
}

function formatPercentDirect(ratio: number | null | undefined): string | null {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
    return null;
  }
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatRuleValue(
  value: number | null | undefined,
  unit: string | null | undefined
): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  if (unit === 'ratio') {
    return formatPercentDirect(value);
  }
  if (unit === '₹ lakh' || unit === 'lakh') {
    return `₹${value.toFixed(2)}L`;
  }
  if (unit === '₹') {
    return formatInrDisplay(value);
  }
  if (unit === 'days') {
    return `${value.toFixed(1)} d`;
  }
  return Number.isInteger(value) ? value.toLocaleString('en-IN') : value.toFixed(1);
}

const BROAD_OVERVIEW_METRICS = [
  'M-02',
  'M-03',
  'M-04',
  'M-08',
  'M-09',
  'M-11',
  'M-12',
  'M-13',
  'M-17',
  'M-18',
  'M-20',
  'M-21',
  'M-23',
  'M-30',
] as const;

const RESTRICTED_FINANCE_METRICS = ['M-01', 'M-06', 'M-07', 'M-27'] as const;

export async function fetchOverviewSnapshot(
  filters: OverviewFilterState,
  scenario: ScenarioKey,
  requestedMode: 'default' | 'loading' | 'error' = 'default',
  signal?: AbortSignal
): Promise<OverviewQueryResult> {
  if (requestedMode === 'loading') {
    return {
      status: 'loading',
      payload: createEmptyOverviewPayload(scenario, filters),
      error: null,
    };
  }

  if (requestedMode === 'error') {
    return {
      status: 'error',
      payload: createEmptyOverviewPayload(scenario, filters),
      error: {
        code: 'PREVIEW_ERROR',
        message: 'Simulated preview error state.',
        endpoint: OVERVIEW_API_ENDPOINTS.metricsQuery,
      },
    };
  }

  const metricFilters: Record<string, string> = {};
  if (filters.campaignId && filters.campaignId !== 'all') {
    metricFilters.campaign_id = filters.campaignId;
  }

  const qs = new URLSearchParams({
    editionId: filters.editionId,
    edition_id: filters.editionId,
    record_class: filters.recordClass,
    asOf: filters.asOf,
  }).toString();

  // 1. Core parallel fetches
  const [
    broadMetricsRes,
    financeMetricsOutcome,
    gatesRes,
    rulesRes,
    scenariosRes,
    betsRes,
    campaignsRes,
    tasksRes,
    escalationsRes,
    teamRes,
    receiptsOutcome,
  ] = await Promise.all([
    fetchApiJson<{ results: RawMetricRow[] }>(OVERVIEW_API_ENDPOINTS.metricsQuery, {
      method: 'POST',
      signal,
      body: JSON.stringify({
        metricIds: [...BROAD_OVERVIEW_METRICS],
        editionId: filters.editionId,
        recordClass: filters.recordClass,
        asOf: filters.asOf,
        filters: metricFilters,
      }),
    }),
    fetchApiJson<{ results: RawMetricRow[] }>(OVERVIEW_API_ENDPOINTS.metricsQuery, {
      method: 'POST',
      signal,
      body: JSON.stringify({
        metricIds: [...RESTRICTED_FINANCE_METRICS],
        editionId: filters.editionId,
        recordClass: filters.recordClass,
        asOf: filters.asOf,
        filters: metricFilters,
      }),
    })
      .then((res) => ({ restricted: false, results: res.results }))
      .catch((err: unknown) => {
        if (err instanceof OverviewFetchError && err.status === 403) {
          return { restricted: true, results: [] as RawMetricRow[] };
        }
        throw err;
      }),
    fetchApiJson<RawGatesResponse>(`${OVERVIEW_API_ENDPOINTS.gates}?${qs}`, { signal }),
    fetchApiJson<{ rules: RawRuleRow[] }>(`${OVERVIEW_API_ENDPOINTS.rules}?${qs}`, {
      signal,
    }),
    fetchApiJson<{ scenarios: Array<Record<string, unknown>> }>(
      OVERVIEW_API_ENDPOINTS.referenceScenarios,
      { signal }
    ),
    fetchApiJson<{ bets: Array<Record<string, unknown>> }>(
      OVERVIEW_API_ENDPOINTS.referenceBets,
      { signal }
    ),
    fetchApiJson<{ campaigns: Array<Record<string, unknown>> }>(
      `${OVERVIEW_API_ENDPOINTS.campaigns}?edition_id=${encodeURIComponent(
        filters.editionId
      )}&record_class=${encodeURIComponent(filters.recordClass)}`,
      { signal }
    ),
    fetchApiJson<{ tasks: Array<Record<string, unknown>> }>(
      `${OVERVIEW_API_ENDPOINTS.tasks}?edition_id=${encodeURIComponent(
        filters.editionId
      )}&record_class=${encodeURIComponent(filters.recordClass)}`,
      { signal }
    ),
    fetchApiJson<{ escalations: Array<Record<string, unknown>> }>(
      `${OVERVIEW_API_ENDPOINTS.escalations}?edition_id=${encodeURIComponent(
        filters.editionId
      )}&record_class=${encodeURIComponent(filters.recordClass)}`,
      { signal }
    ).catch((err: unknown) => {
      if (err instanceof OverviewFetchError && err.status === 403) {
        return { escalations: [] as Array<Record<string, unknown>> };
      }
      throw err;
    }),
    fetchApiJson<{ members?: Array<Record<string, unknown>>; team?: Array<Record<string, unknown>> }>(
      `${OVERVIEW_API_ENDPOINTS.team}?edition_id=${encodeURIComponent(filters.editionId)}`,
      { signal }
    ),
    fetchApiJson<{ receipts: Array<Record<string, unknown>> }>(
      `${OVERVIEW_API_ENDPOINTS.collectionsReceipts}?${qs}`,
      { signal }
    )
      .then((r) => ({ restricted: false, receipts: r.receipts ?? [] }))
      .catch((err: unknown) => {
        if (err instanceof OverviewFetchError && err.status === 403) {
          return { restricted: true, receipts: [] as Array<Record<string, unknown>> };
        }
        throw err;
      }),
  ]);

  // 2. Weekly pacing series via POST /api/metrics/series (M-08 over W1..W10 week_end dates)
  const weekDates = (gatesRes.weeks ?? [])
    .slice(0, 10)
    .map((w) => w.week_end)
    .filter(Boolean);

  const seriesRes =
    weekDates.length > 0
      ? await fetchApiJson<{
          series: Array<{ as_of: string; rows: RawMetricRow[] }>;
        }>(OVERVIEW_API_ENDPOINTS.metricsSeries, {
          method: 'POST',
          signal,
          body: JSON.stringify({
            metricId: 'M-08',
            editionId: filters.editionId,
            recordClass: filters.recordClass,
            asOfDates: weekDates,
            filters: metricFilters,
          }),
        })
      : { series: [] as Array<{ as_of: string; rows: RawMetricRow[] }> };

  // Index metrics by metric_id (keep M-30 multi-row array separately)
  const metricMap = new Map<string, RawMetricRow>();
  const m30Rows: RawMetricRow[] = [];
  for (const row of broadMetricsRes.results ?? []) {
    if (row.metric_id === 'M-30') {
      m30Rows.push(row);
    } else if (!metricMap.has(row.metric_id)) {
      metricMap.set(row.metric_id, row);
    }
  }
  for (const row of financeMetricsOutcome.results ?? []) {
    if (!metricMap.has(row.metric_id)) {
      metricMap.set(row.metric_id, row);
    }
  }

  const m01 = metricMap.get('M-01');
  const m02 = metricMap.get('M-02');
  const m03 = metricMap.get('M-03');
  const m04 = metricMap.get('M-04');
  const m06 = metricMap.get('M-06');
  const m07 = metricMap.get('M-07');
  const m09 = metricMap.get('M-09');
  const m11 = metricMap.get('M-11');
  const m12 = metricMap.get('M-12');
  const m13 = metricMap.get('M-13');
  const m21 = metricMap.get('M-21');
  const m23 = metricMap.get('M-23');
  const m27 = metricMap.get('M-27');

  const viewerFinanceMessage = financeMetricsOutcome.restricted
    ? 'Restricted by viewer role'
    : null;

  // Build Growth Pulse cards (never mixing cash & in-kind, always labelling recordClass + asOf)
  const signedBreakdown =
    filters.dataClass === 'cash'
      ? `Cash signed (M-03): ${formatServerMetric(m03) ?? m03?.reason ?? '—'}`
      : filters.dataClass === 'in_kind'
        ? `In-kind value (M-04): ${formatServerMetric(m04) ?? m04?.reason ?? '—'}`
        : `Cash (M-03): ${formatServerMetric(m03) ?? '—'} · In-kind (M-04): ${formatServerMetric(m04) ?? '—'}`;

  const primarySignedMetric =
    filters.dataClass === 'cash'
      ? m03
      : filters.dataClass === 'in_kind'
        ? m04
        : m02;

  const pulseMetrics: GrowthPulseMetric[] = [
    {
      id: 'active_opportunities',
      metricId: 'M-21',
      label: 'Open pipeline value',
      formattedValue: formatServerMetric(m21),
      computable: Boolean(m21?.computable),
      reason: m21 && !m21.computable ? m21.reason : null,
      comparisonText: null,
      supportingLabel:
        'M-21 unweighted proposed face value of currently open opportunities (not a forecast).',
      secondaryBreakdownLabel: 'Unweighted proposed face value',
      recordClassLabel: filters.recordClass,
      asOfDate: filters.asOf,
    },
    {
      id: 'signed_value',
      metricId: primarySignedMetric?.metric_id ?? 'M-02',
      label:
        filters.dataClass === 'cash'
          ? 'Signed cash value'
          : filters.dataClass === 'in_kind'
            ? 'In-kind value'
            : 'Signed sponsorship value',
      formattedValue: formatServerMetric(primarySignedMetric),
      computable: Boolean(primarySignedMetric?.computable),
      reason:
        primarySignedMetric && !primarySignedMetric.computable
          ? primarySignedMetric.reason
          : null,
      comparisonText: m09?.computable
        ? `${formatServerMetric(m09)} confirmed`
        : null,
      supportingLabel:
        'M-02 confirmed partnerships. Cash (M-03) and in-kind (M-04) are never combined into cash totals.',
      secondaryBreakdownLabel: signedBreakdown,
      recordClassLabel: filters.recordClass,
      asOfDate: filters.asOf,
    },
    {
      id: 'cash_collected',
      metricId: 'M-01',
      label: 'Cash collected before fest',
      isNorthStar: true,
      formattedValue: viewerFinanceMessage ? null : formatServerMetric(m01),
      computable: !viewerFinanceMessage && Boolean(m01?.computable),
      reason:
        viewerFinanceMessage ??
        (m01 && !m01.computable ? m01.reason : null),
      comparisonText: viewerFinanceMessage
        ? null
        : formatServerMetric(m06)
          ? `${formatServerMetric(m06)} collected`
          : null,
      supportingLabel:
        'M-01 reconciled & allocated cash receipts before festival start. Excludes unreconciled receipts and in-kind.',
      secondaryBreakdownLabel:
        gatesRes.cash_gate?.threshold !== undefined
          ? `T−7 gate (M-06): ≥ ${(gatesRes.cash_gate.threshold * 100).toFixed(0)}% · ${gatesRes.cash_gate.status}`
          : 'Cleared & allocated cash only',
      recordClassLabel: filters.recordClass,
      asOfDate: filters.asOf,
    },
    {
      id: 'outstanding_collections',
      metricId: 'M-07',
      label: 'Outstanding cash',
      formattedValue: viewerFinanceMessage ? null : formatServerMetric(m07),
      computable: !viewerFinanceMessage && Boolean(m07?.computable),
      reason:
        viewerFinanceMessage ??
        (m07 && !m07.computable ? m07.reason : null),
      comparisonText: m03?.computable
        ? `of ${formatServerMetric(m03)} cash`
        : null,
      supportingLabel:
        'M-07 signed cash-type value minus cleared & allocated cash collected.',
      secondaryBreakdownLabel: 'Cash deals only (excludes in-kind)',
      recordClassLabel: filters.recordClass,
      asOfDate: filters.asOf,
    },
  ];

  // Build Funnel Stages strictly from server metric rows (no React arithmetic)
  const funnelStages: FunnelStageRecord[] = [
    {
      key: 'prospects',
      label: 'Touches by campaign',
      metricId: 'M-23',
      count: m23?.denominator ?? m11?.denominator ?? null,
      rateFormatted: null,
      conversionFromPreviousPct: null,
      cashValueFormatted: null,
      inKindValueFormatted: null,
      reason: m23 && !m23.computable ? m23.reason : null,
      description:
        'Outreach counts summed over campaigns (M-23 denominator). A brand contacted by two campaigns counts in each.',
    },
    {
      key: 'conversations',
      label: 'Responses by campaign',
      metricId: 'M-23',
      count: m23?.numerator ?? null,
      rateFormatted: formatServerMetric(m23),
      conversionFromPreviousPct:
        m23?.computable && m23.value !== null
          ? Math.round(m23.value * 1000) / 10
          : null,
      cashValueFormatted: null,
      inKindValueFormatted: null,
      reason: m23 && !m23.computable ? m23.reason : null,
      description:
        'Responses summed over campaigns (M-23 numerator / response rate). A brand responding across two campaigns counts in each.',
    },
    {
      key: 'qualified',
      label: 'Meetings held',
      metricId: 'M-11',
      count: m11?.numerator ?? null,
      rateFormatted: formatServerMetric(m11),
      conversionFromPreviousPct:
        m11?.computable && m11.value !== null
          ? Math.round(m11.value * 1000) / 10
          : null,
      cashValueFormatted: null,
      inKindValueFormatted: m12?.computable
        ? `Qual → Opp (M-12): ${formatServerMetric(m12)}`
        : null,
      reason: m11 && !m11.computable ? m11.reason : null,
      description: 'Brands with meeting_held before fest (M-11 numerator).',
    },
    {
      key: 'proposals',
      label: 'Proposals sent',
      metricId: 'M-13',
      count: m13?.denominator ?? null,
      rateFormatted: formatServerMetric(m12),
      conversionFromPreviousPct:
        m12?.computable && m12.value !== null
          ? Math.round(m12.value * 1000) / 10
          : null,
      cashValueFormatted: formatServerMetric(m21)
        ? `Open face ${formatServerMetric(m21)}`
        : null,
      inKindValueFormatted: null,
      reason: m13 && !m13.computable ? m13.reason : null,
      description: 'Opportunities reaching proposal_sent (M-13 denominator).',
    },
    {
      key: 'confirmed_partnerships',
      label: 'Confirmed partnerships',
      metricId: 'M-09',
      count: m09?.computable ? m09.value : m13?.numerator ?? null,
      rateFormatted: formatServerMetric(m13),
      conversionFromPreviousPct:
        m13?.computable && m13.value !== null
          ? Math.round(m13.value * 1000) / 10
          : null,
      cashValueFormatted: formatServerMetric(m03),
      inKindValueFormatted: formatServerMetric(m04),
      reason: m09 && !m09.computable ? m09.reason : null,
      description: 'Confirmed opportunities (M-09 count, M-13 win rate).',
    },
  ];

  const cashOutcome: CashOutcomeSummary = {
    collectedCashFormatted: viewerFinanceMessage ? null : formatServerMetric(m01),
    collectedReason:
      viewerFinanceMessage ?? (m01 && !m01.computable ? m01.reason : null),
    confirmedCashBasisFormatted: formatServerMetric(m03),
    collectionRateFormatted: viewerFinanceMessage ? null : formatServerMetric(m06),
    collectionRateReason:
      viewerFinanceMessage ?? (m06 && !m06.computable ? m06.reason : null),
    inKindValueSeparateFormatted: formatServerMetric(m04),
    definitionNote:
      'M-01 cleared & allocated cash divided by M-03 signed cash-type commitments (M-06). In-kind value (M-04) is strictly separate.',
    recordClassLabel: filters.recordClass,
    asOfDate: filters.asOf,
  };

  // Build Target Pacing from /api/gates + /api/metrics/series (M-08) + /api/reference/scenarios + M-30
  const pacingByPeriod = new Map<string, RawGatePacing>();
  for (const row of gatesRes.weekly_pacing ?? []) {
    pacingByPeriod.set(row.period.toUpperCase(), row);
  }
  const seriesByDate = new Map<string, RawMetricRow>();
  for (const entry of seriesRes.series ?? []) {
    if (entry.rows[0]) {
      seriesByDate.set(entry.as_of, entry.rows[0]);
    }
  }

  const weeklyMilestones: WeeklyMilestonePoint[] = (gatesRes.weeks ?? [])
    .slice(0, 10)
    .map((wk) => {
      const gateRow = pacingByPeriod.get(wk.period.toUpperCase());
      const seriesRow = seriesByDate.get(wk.week_end);
      const actualVal =
        seriesRow && seriesRow.computable
          ? seriesRow.value
          : gateRow?.computable
            ? gateRow.actual_value
            : null;
      const targetRef =
        scenario === 'plan'
          ? gateRow?.plan_target ?? null
          : gateRow?.base_target ?? null;
      const ratio =
        wk.passed && actualVal !== null && targetRef && targetRef > 0
          ? actualVal / targetRef
          : null;

      return {
        weekId: wk.period.toLowerCase(),
        label: wk.period,
        weekEnd: wk.week_end,
        passed: wk.passed,
        actualValue: wk.passed ? actualVal : null,
        actualFormatted: wk.passed ? formatInrDisplay(actualVal) : 'Upcoming',
        baseTargetValue: gateRow?.base_target ?? null,
        baseTargetFormatted: formatInrDisplay(gateRow?.base_target ?? null),
        planTargetValue: gateRow?.plan_target ?? null,
        planTargetFormatted: formatInrDisplay(gateRow?.plan_target ?? null),
        gateStatus: gateRow?.status ?? null,
        reason: seriesRow && !seriesRow.computable ? seriesRow.reason : gateRow?.reason ?? null,
        progressRatio: ratio,
      };
    });

  const findM30Row = (scenarioId: string): RawMetricRow | undefined =>
    m30Rows.find((r) => {
      const key =
        r.series_key ??
        r.applied_filters?.scenario_id ??
        r.filters_applied?.scenario_id ??
        '';
      return String(key) === scenarioId;
    });

  const findScenarioInfo = (scenarioId: string) => {
    const row = (scenariosRes.scenarios ?? []).find(
      (s) => String(s.scenario_id) === scenarioId
    );
    const m30Row = findM30Row(scenarioId);
    const expectedCash =
      m30Row?.computable && m30Row.value !== null
        ? m30Row.value
        : typeof row?.expected_cash === 'number'
          ? row.expected_cash
          : null;
    const p50 = typeof row?.p50 === 'number' ? row.p50 : null;
    return { expectedCash, p50 };
  };

  const sc01Info = findScenarioInfo('SC-01');
  const sc02Info = findScenarioInfo('SC-02');
  const sc03Info = findScenarioInfo('SC-03');

  const cashCollectedLabel = viewerFinanceMessage
    ? 'Restricted'
    : formatServerMetric(m01) ?? null;
  const cashCollectedReason =
    viewerFinanceMessage ?? (m01 && !m01.computable ? m01.reason : null);

  const targetPacing: TargetPacingSnapshot = {
    selectedScenario: scenario,
    actualSignedFormatted: formatServerMetric(m02),
    actualSignedReason: m02 && !m02.computable ? m02.reason : null,
    latestGateStatusLabel: gatesRes.latest_passed_week?.status ?? null,
    latestGateWeekLabel: gatesRes.latest_passed_week
      ? `${gatesRes.latest_passed_week.period} (${gatesRes.latest_passed_week.week_end})`
      : null,
    scenarioTargets: {
      base: {
        scenarioId: 'SC-01',
        label: 'Base cash target (SC-01)',
        shortLabel: 'Base (SC-01)',
        targetFormatted: formatLakhTarget(sc01Info.expectedCash),
        p50Formatted: sc01Info.p50 !== null ? `P50: ${formatLakhTarget(sc01Info.p50)}` : null,
        cashCollectedFormatted: cashCollectedLabel,
        cashCollectedReason,
      },
      plan: {
        scenarioId: 'SC-02',
        label: 'Plan cash target (SC-02)',
        shortLabel: 'Plan (SC-02)',
        targetFormatted: formatLakhTarget(sc02Info.expectedCash),
        p50Formatted: sc02Info.p50 !== null ? `P50: ${formatLakhTarget(sc02Info.p50)}` : null,
        cashCollectedFormatted: cashCollectedLabel,
        cashCollectedReason,
      },
      stretch: {
        scenarioId: 'SC-03',
        label: 'Stretch cash target (SC-03)',
        shortLabel: 'Stretch (SC-03)',
        targetFormatted: formatLakhTarget(sc03Info.expectedCash),
        p50Formatted: sc03Info.p50 !== null ? `P50: ${formatLakhTarget(sc03Info.p50)}` : null,
        cashCollectedFormatted: cashCollectedLabel,
        cashCollectedReason,
      },
    },
    weeklyMilestones,
    cashCollectionGate: {
      gateLabel: 'T−7 cash collection gate (K-G-02)',
      collectedFormatted: viewerFinanceMessage
        ? 'Restricted'
        : formatServerMetric(m01) ?? m01?.reason ?? 'Not computable',
      collectionRateFormatted: viewerFinanceMessage
        ? 'Restricted'
        : formatServerMetric(m06) ?? m06?.reason ?? 'Not computable',
      outstandingFormatted: viewerFinanceMessage
        ? 'Restricted'
        : formatServerMetric(m07) ?? m07?.reason ?? 'Not computable',
      gateTargetFormatted:
        gatesRes.cash_gate?.threshold !== undefined
          ? `≥ ${(gatesRes.cash_gate.threshold * 100).toFixed(0)}% of signed cash`
          : '≥ 85% of signed cash',
      gateStatusLabel:
        viewerFinanceMessage ??
        (gatesRes.cash_gate?.status ||
          (gatesRes.cash_gate?.computable
            ? gatesRes.cash_gate.status
            : gatesRes.cash_gate?.reason || 'unavailable')),
      reason: viewerFinanceMessage ?? gatesRes.cash_gate?.reason ?? null,
    },
  };

  // 3. Campaign performance rows (from GET /api/campaigns + per-campaign server metrics)
  const rawCampaigns = campaignsRes.campaigns ?? [];
  const campaignOptions: FilterOption[] = [
    { value: 'all', label: 'All campaigns' },
    ...rawCampaigns.map((c) => ({
      value: String(c.campaign_id),
      label: String(c.name ?? c.campaign_id),
    })),
  ];

  const filteredRawCampaigns =
    filters.campaignId !== 'all'
      ? rawCampaigns.filter((c) => String(c.campaign_id) === filters.campaignId)
      : rawCampaigns;

  const isHistoricalEdition =
    filters.recordClass === 'historical_synthetic' || filters.editionId === 'ED-2025';

  const campaignMetricRows = await Promise.all(
    filteredRawCampaigns.map(async (c) => {
      const cid = String(c.campaign_id);
      const [broadRes, collectedOutcome] = await Promise.all([
        fetchApiJson<{ results: RawMetricRow[] }>(
          OVERVIEW_API_ENDPOINTS.metricsQuery,
          {
            method: 'POST',
            signal,
            body: JSON.stringify({
              metricIds: ['M-21', 'M-13', 'M-02', 'M-03', 'M-18'],
              editionId: filters.editionId,
              recordClass: filters.recordClass,
              asOf: filters.asOf,
              filters: { campaign_id: cid },
            }),
          }
        ),
        financeMetricsOutcome.restricted
          ? Promise.resolve({ restricted: true, row: null as RawMetricRow | null })
          : fetchApiJson<{ results: RawMetricRow[] }>(
              OVERVIEW_API_ENDPOINTS.metricsQuery,
              {
                method: 'POST',
                signal,
                body: JSON.stringify({
                  metricIds: ['M-01'],
                  editionId: filters.editionId,
                  recordClass: filters.recordClass,
                  asOf: filters.asOf,
                  filters: { campaign_id: cid },
                }),
              }
            )
              .then((r) => ({ restricted: false, row: r.results?.[0] ?? null }))
              .catch((err: unknown) => {
                if (err instanceof OverviewFetchError && err.status === 403) {
                  return { restricted: true, row: null as RawMetricRow | null };
                }
                throw err;
              }),
      ]);
      const map = new Map<string, RawMetricRow>();
      for (const item of broadRes.results ?? []) {
        map.set(item.metric_id, item);
      }
      if (collectedOutcome.row) {
        map.set('M-01', collectedOutcome.row);
      }
      return {
        campaign: c,
        metrics: map,
        collectedRestricted: collectedOutcome.restricted,
      };
    })
  );

  const campaigns: CampaignPerformanceRow[] = campaignMetricRows.map(
    ({ campaign: c, metrics, collectedRestricted }) => {
      const cm21 = metrics.get('M-21');
      const cm13 = metrics.get('M-13');
      const cm02 = metrics.get('M-02');
      const cm03 = metrics.get('M-03');
      const cm01 = metrics.get('M-01');
      const statusStr = String(c.status ?? 'planned');
      const health: CampaignHealthStatus =
        statusStr === 'stopped'
          ? 'at_risk'
          : statusStr === 'active'
            ? 'nominal'
            : statusStr === 'closed'
              ? 'watch'
              : 'unassigned';

      const collectedCashFormatted = collectedRestricted
        ? 'Restricted'
        : isHistoricalEdition
          ? 'Not computable'
          : cm01?.computable
            ? formatServerMetric(cm01) ?? '—'
            : cm01?.reason || 'Not computable';

      return {
        id: String(c.campaign_id),
        campaignName: String(c.name ?? c.campaign_id),
        ownerName: String(c.owner_name ?? c.owner_member_id ?? 'Unassigned'),
        pipelineValue: cm21?.computable ? cm21.value : null,
        pipelineFormatted:
          formatServerMetric(cm21) ?? cm21?.reason ?? 'Not computable',
        proposalCount: cm13?.denominator ?? null,
        signedValue: cm02?.computable ? cm02.value : null,
        signedFormatted:
          formatServerMetric(cm02) ?? cm02?.reason ?? 'Not computable',
        signedCash: cm03?.computable ? cm03.value : null,
        signedCashFormatted:
          formatServerMetric(cm03) ?? cm03?.reason ?? '—',
        collectedCash:
          !collectedRestricted && !isHistoricalEdition && cm01?.computable
            ? cm01.value
            : null,
        collectedCashFormatted,
        health,
        healthLabel: statusStr,
      };
    }
  );

  // 4. Strategic Bets & Rules (from /api/reference/bets + /api/rules)
  const rulesByBetId = new Map<string, RawRuleRow>();
  for (const r of rulesRes.rules ?? []) {
    if (r.bet_id && !rulesByBetId.has(r.bet_id)) {
      rulesByBetId.set(r.bet_id, r);
    }
  }

  const strategicBets: StrategicBetSlot[] = (betsRes.bets ?? []).map((b, idx) => {
    const betId = String(b.bet_id);
    const matchingRules = (rulesRes.rules ?? []).filter(
      (r) => r.bet_id === betId
    );
    const primaryRule =
      matchingRules.find((r) => r.computable) ?? matchingRules[0] ?? null;

    let metricSummary: string | null = null;
    let progressPct: number | null = null;
    if (primaryRule) {
      if (primaryRule.computable && primaryRule.current_value !== null) {
        const formatted = formatRuleValue(
          primaryRule.current_value,
          primaryRule.current_unit
        );
        metricSummary = `${primaryRule.rule_id} (${primaryRule.metric_id ?? 'KPI'}): ${formatted ?? '—'} · ${primaryRule.evaluate_at}`;
        if (primaryRule.current_unit === 'ratio') {
          progressPct = Math.round(primaryRule.current_value * 100);
        }
      } else {
        metricSummary = `${primaryRule.rule_id}: ${primaryRule.reason || 'Manual review'}`;
      }
    }

    return {
      id: betId,
      indexLabel: `${betId} · #${b.rank ?? idx + 1}`,
      title: String(b.name ?? betId),
      ruleId: primaryRule?.rule_id ?? null,
      progressPct,
      thresholdStatus: primaryRule?.status_label ?? 'no threshold rule',
      band: primaryRule?.band ?? null,
      metricSummary,
      keepIf: primaryRule?.keep_if ?? null,
      changeIf: primaryRule?.change_if ?? null,
      escalateIf: primaryRule?.escalate_if ?? null,
      evaluateAt: primaryRule?.evaluate_at ?? null,
    };
  });

  // 5. Team execution (from /api/tasks + /api/team + M-27)
  const rawTasks = tasksRes.tasks ?? [];
  const openTasks = rawTasks.filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled'
  );
  const overdueTasks = openTasks.filter((t) => {
    const due = t.due_at ? String(t.due_at).slice(0, 10) : '';
    return Boolean(t.overdue) || (Boolean(due) && due < filters.asOf);
  });
  const activeMembers = (teamRes.members ?? teamRes.team ?? []).filter(
    (m) => m.is_active !== false
  );

  const teamExecution = {
    openTasksCount: openTasks.length,
    overdueTasksCount: overdueTasks.length,
    activeOwnersCount: activeMembers.length,
    capacityStatusLabel: viewerFinanceMessage
      ? 'Restricted'
      : m27?.computable
        ? `${formatServerMetric(m27)} / owner`
        : m27?.reason ?? '—',
    capacityReason: m27 && !m27.computable ? m27.reason : null,
    nextDueSummary: overdueTasks[0]?.title
      ? String(overdueTasks[0].title)
      : openTasks[0]?.title
        ? String(openTasks[0].title)
        : null,
  };

  // 6. Adaptive Needs-Attention Queue from real alerts
  const attentionItems: NeedsAttentionItem[] = [];

  if (
    !isHistoricalEdition &&
    gatesRes.latest_passed_week &&
    gatesRes.latest_passed_week.status !== 'on plan'
  ) {
    attentionItems.push({
      id: `gate-${gatesRes.latest_passed_week.period}`,
      category: 'campaign_warnings',
      categoryLabel: 'Pacing gate',
      severity:
        gatesRes.latest_passed_week.status.includes('re-plan') ||
        gatesRes.latest_passed_week.status.includes('below')
          ? 'high'
          : 'medium',
      title: `${gatesRes.latest_passed_week.period} pacing: ${gatesRes.latest_passed_week.status}`,
      whatHappened: `Signed value as of ${gatesRes.latest_passed_week.week_end} is ${
        formatInrDisplay(gatesRes.latest_passed_week.actual_value) ?? '—'
      } vs base ${
        formatInrDisplay(gatesRes.latest_passed_week.base_target) ?? '—'
      } and plan ${
        formatInrDisplay(gatesRes.latest_passed_week.plan_target) ?? '—'
      }.`,
      whyItMatters:
        'Server K-G-01 checkpoint evaluation triggers bet contingencies when trailing base or plan gates.',
      relevantEvidence: `K-G-01 (${gatesRes.latest_passed_week.period})`,
      responsibleOwner: 'Coordination lead',
      recommendedNextStep: 'Inspect weekly pacing in Analytics',
      timestampLabel: gatesRes.latest_passed_week.week_end ?? filters.asOf,
      targetEntityType: 'analytics',
    });
  }

  if (!isHistoricalEdition) {
    for (const r of rulesRes.rules ?? []) {
      if (r.band === 'escalate' || r.band === 'stop' || r.band === 'change') {
        const formattedRuleVal =
          r.computable && r.current_value !== null
            ? formatRuleValue(r.current_value, r.current_unit)
            : r.reason ?? '—';
        attentionItems.push({
          id: `rule-${r.rule_id}`,
          category:
            r.rule_id === 'EX-B2 (gate)' || r.rule_id === 'EX-B2'
              ? 'collection_risks'
              : 'campaign_warnings',
          categoryLabel: 'Threshold rule',
          severity: r.band === 'change' ? 'medium' : 'high',
          title: `${r.rule_id}: ${r.status_label}`,
          whatHappened: `${r.kpi_name ?? r.kpi_id} (${r.metric_id ?? 'KPI'}) = ${
            formattedRuleVal ?? '—'
          }`,
          whyItMatters: `Response: ${r.response}`,
          relevantEvidence: `Evaluate at ${r.evaluate_at}`,
          responsibleOwner: r.bet_id ?? 'Owner',
          recommendedNextStep: r.response,
          timestampLabel: filters.asOf,
          targetEntityType: 'analytics',
        });
      }
    }
  }

  for (const rec of receiptsOutcome.receipts ?? []) {
    if (rec.unreconciled === true || rec.reconciled === false) {
      attentionItems.push({
        id: `receipt-${String(rec.receipt_id)}`,
        category: 'collection_risks',
        categoryLabel: 'Collection risk',
        severity: 'high',
        title: `Unreconciled receipt ${String(rec.receipt_id)} (${String(
          rec.sponsor_name ?? rec.sponsor_id
        )})`,
        whatHappened: `${
          formatInrDisplay(typeof rec.amount === 'number' ? rec.amount : Number(rec.amount)) ??
          '—'
        } received on ${String(rec.received_at ?? '').slice(0, 10)} is not reconciled.`,
        whyItMatters:
          'Unreconciled or unallocated receipts do not count toward M-01 cash collected or M-06.',
        relevantEvidence: `Receipt ${String(rec.receipt_id)}`,
        responsibleOwner: String(rec.recorded_by_name ?? rec.recorded_by ?? 'Finance'),
        recommendedNextStep: 'Verify bank clearance & allocate in Collections',
        timestampLabel: String(rec.received_at ?? filters.asOf).slice(0, 10),
        targetEntityType: 'collections',
        targetEntityId: String(rec.sponsor_id ?? ''),
      });
    }
  }

  for (const esc of escalationsRes.escalations ?? []) {
    if (esc.status === 'open' || esc.status === 'acknowledged') {
      attentionItems.push({
        id: `esc-${String(esc.escalation_id)}`,
        category: 'execution_issues',
        categoryLabel: 'Escalation',
        severity: 'high',
        title: String(esc.summary ?? esc.reason_code ?? esc.escalation_id),
        whatHappened: `Escalation ${String(esc.escalation_id)} (${String(
          esc.reason_code ?? 'open'
        )}) on ${String(esc.subject_type ?? 'record')} ${String(
          esc.subject_id ?? ''
        )}.`,
        whyItMatters: 'Open escalations require lead review.',
        relevantEvidence: String(esc.escalation_id),
        responsibleOwner: String(esc.escalated_to ?? esc.owner_member_id ?? 'Lead'),
        recommendedNextStep: 'Review escalation and resolve blocker',
        timestampLabel: String(esc.created_at ?? filters.asOf).slice(0, 10),
        targetEntityType:
          esc.subject_type === 'opportunity' ||
          esc.subject_type === 'sponsor' ||
          esc.subject_type === 'campaign' ||
          esc.subject_type === 'task'
            ? (esc.subject_type as 'opportunity' | 'sponsor' | 'campaign' | 'task')
            : undefined,
        targetEntityId: esc.subject_id ? String(esc.subject_id) : undefined,
      });
    }
  }

  for (const task of overdueTasks.slice(0, 6)) {
    attentionItems.push({
      id: `task-${String(task.task_id)}`,
      category: 'overdue_follow_ups',
      categoryLabel: 'Overdue task',
      severity: 'medium',
      title: String(task.title ?? task.task_id),
      whatHappened: `Task due ${String(task.due_at ?? '').slice(0, 10)} is still ${String(
        task.status
      )}.`,
      whyItMatters: 'Overdue follow-ups slow stage progression and contract close.',
      relevantEvidence: String(task.task_id),
      responsibleOwner: String(task.owner_name ?? task.owner_member_id ?? 'Owner'),
      recommendedNextStep: 'Open task and update status or follow-up',
      timestampLabel: String(task.due_at ?? filters.asOf).slice(0, 10),
      targetEntityType: 'task',
      targetEntityId: String(task.task_id),
    });
  }

  return {
    status: 'ready',
    payload: {
      editionId: gatesRes.edition_id ?? filters.editionId,
      recordClass: gatesRes.record_class ?? filters.recordClass,
      asOfTimestamp: filters.asOf,
      campaignOptions,
      pulseMetrics,
      funnelStages,
      cashOutcome,
      targetPacing,
      campaigns,
      attentionItems,
      strategicBets,
      teamExecution,
    },
    error: null,
  };
}
