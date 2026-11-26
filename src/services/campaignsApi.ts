import { apiFetch } from './authSession';
import {
  CAMPAIGN_METRIC_IDS,
  PORTFOLIO_SUMMARY_METRIC_IDS,
  type BetReference,
  type CampaignEntity,
  type CampaignMetricDefinitionMeta,
  type CampaignMetricId,
  type CampaignOpportunityRecord,
  type CampaignPortfolioFilters,
  type CampaignPortfolioRow,
  type CampaignPortfolioSummary,
  type CampaignRecordClass,
  type CampaignSponsorAssociation,
  type CampaignStatus,
  type CampaignTaskRecord,
  type CampaignWritePayload,
  type CanonicalTaskStatus,
  type ChannelReference,
  type CreateCampaignTaskPayload,
  type InteractionRecord,
  type MetricQueryResult,
  type OutreachAttemptRecord,
} from '../types/campaigns';
import type { FilterOption } from '../types/overview';
import { OVERVIEW_API_ENDPOINTS } from './overviewApi';

export class CampaignApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = 'API_ERROR') {
    super(message);
    this.name = 'CampaignApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Exact metric definitions from 05_metric_dictionary.csv
 */
export const CAMPAIGN_METRIC_DICTIONARY: Record<
  CampaignMetricId | 'M-21',
  CampaignMetricDefinitionMeta
> = {
  'M-23': {
    metric_id: 'M-23',
    name: 'Response rate (brand level)',
    kpi_id: null,
    formula: 'brands responded ÷ brands touched',
    numerator_label: 'brands responded',
    denominator_label: 'brands touched',
    unit: 'ratio',
    inclusion_exclusion:
      'Introductions and form submissions count as responses (no delivery step). Season to date.',
  },
  'M-11': {
    metric_id: 'M-11',
    name: 'Meeting rate',
    kpi_id: 'K-F-01',
    formula: 'brands met ÷ brands touched',
    numerator_label: 'brands with meeting_held',
    denominator_label: 'brands touched',
    unit: 'ratio',
    inclusion_exclusion: 'Attempts before festival start; brand level.',
  },
  'M-13': {
    metric_id: 'M-13',
    name: 'Win rate per proposal',
    kpi_id: 'K-F-03',
    formula: 'won opportunities ÷ opportunities that reached proposal_sent',
    numerator_label: 'won',
    denominator_label: 'proposals',
    unit: 'ratio',
    inclusion_exclusion:
      'Opportunity level; withdrawn after confirmation counts as not won.',
  },
  'M-09': {
    metric_id: 'M-09',
    name: 'Confirmed partnerships',
    kpi_id: null,
    formula: 'COUNT(opportunity) with latest stage = partner_confirmed',
    numerator_label: 'confirmed opportunities',
    denominator_label: '—',
    unit: 'opportunities',
    inclusion_exclusion: 'One brand can have several opportunities.',
  },
  'M-02': {
    metric_id: 'M-02',
    name: 'Signed (confirmed) value',
    kpi_id: 'K-G-01',
    formula: 'SUM(confirmed_value_inr) with stage = partner_confirmed, as of D',
    numerator_label: 'confirmed value',
    denominator_label: '—',
    unit: '₹',
    inclusion_exclusion:
      'Includes in-kind; excludes withdrawn/lost; never call it cash.',
  },
  'M-17': {
    metric_id: 'M-17',
    name: 'Handoff leak rate',
    kpi_id: 'K-F-05',
    formula: 'qualified brands with no opportunity ÷ qualified brands',
    numerator_label: 'handoff_status = A_no_opportunity',
    denominator_label: 'qualified brands',
    unit: 'ratio',
    inclusion_exclusion: 'Warm + inbound unless stated (cold: 6 of 24).',
  },
  'M-21': {
    metric_id: 'M-21',
    name: 'Open pipeline value',
    kpi_id: null,
    formula: 'SUM(proposed_value_inr) of latest versions with stage_class = open',
    numerator_label: 'proposed value',
    denominator_label: '—',
    unit: '₹',
    inclusion_exclusion: 'Face value of opportunities still open (not a forecast).',
  },
};

/**
 * Canonical CHANNEL reference list (01_conceptual_data_model.md §4B & 06_campaign_performance_historical_synthetic.csv)
 */
export const CANONICAL_CHANNELS: ReadonlyArray<ChannelReference> = [
  {
    channel_id: 'CH-INTRO',
    name: 'introduction',
    label: 'Introduction',
    channel_group: 'warm',
    is_active: true,
  },
  {
    channel_id: 'CH-CREATOR',
    name: 'creator_referral',
    label: 'Creator referral',
    channel_group: 'warm',
    is_active: true,
  },
  {
    channel_id: 'CH-INBOUND',
    name: 'web_inbound',
    label: 'Web inbound',
    channel_group: 'inbound',
    is_active: true,
  },
  {
    channel_id: 'CH-RENEWAL',
    name: 'renewal',
    label: 'Renewal',
    channel_group: 'renewal',
    is_active: true,
  },
  {
    channel_id: 'CH-PREMIUM',
    name: 'premium_pitch',
    label: 'Premium pitch',
    channel_group: 'premium',
    is_active: true,
  },
  {
    channel_id: 'CH-EMAIL',
    name: 'email',
    label: 'Email (cold)',
    channel_group: 'cold',
    is_active: false,
  },
  {
    channel_id: 'CH-LINKEDIN',
    name: 'linkedin',
    label: 'LinkedIn (cold)',
    channel_group: 'cold',
    is_active: false,
  },
];

/**
 * Canonical BET reference list (01_conceptual_data_model.md §4F & 09_D010_approved_strategy.md)
 */
export const CANONICAL_BETS: ReadonlyArray<BetReference> = [
  { bet_id: 'B1', name: 'Fix the funnel', rank: 1 },
  { bet_id: 'B2', name: 'Cash discipline', rank: 2 },
  { bet_id: 'B4a', name: 'Gated renewals', rank: 3 },
  { bet_id: 'B4b', name: 'Creator network scale-up', rank: 3 },
  { bet_id: 'B3', name: 'Gated VC/alumni introductions', rank: 4 },
  { bet_id: 'B5', name: 'Pre-season premium inventory', rank: 5 },
];

export const CAMPAIGN_STATUS_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Active' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'closed', label: 'Closed' },
];

export const CAMPAIGN_RECORD_CLASS_OPTIONS: FilterOption[] = [
  { value: 'simulated', label: 'Simulated (2026 demo)' },
  { value: 'historical_synthetic', label: 'Historical synthetic (2025, read-only)' },
  { value: 'live', label: 'Live' },
];

export const CAMPAIGN_EDITION_BY_CLASS: Record<CampaignRecordClass, FilterOption[]> = {
  simulated: [{ value: 'ED-2026-DEMO', label: 'ED-2026-DEMO' }],
  historical_synthetic: [{ value: 'ED-2025', label: 'ED-2025 (CampusFest 2025)' }],
  live: [{ value: 'ED-2026-LIVE', label: 'ED-2026-LIVE' }],
};

export function getDefaultEditionForClass(recordClass: CampaignRecordClass): string {
  return CAMPAIGN_EDITION_BY_CLASS[recordClass][0].value;
}

export function formatCampaignStatus(status: CampaignStatus): string {
  switch (status) {
    case 'planned':
      return 'Planned';
    case 'active':
      return 'Active';
    case 'stopped':
      return 'Stopped';
    case 'closed':
      return 'Closed';
    default:
      return status;
  }
}

export function formatChannelDisplay(
  channelId: string,
  channelName?: string | null
): string {
  const match = CANONICAL_CHANNELS.find(
    (c) => c.channel_id === channelId || c.name === channelId
  );
  if (match) return match.label;
  return channelName || channelId;
}

export function formatBetDisplay(betId?: string | null, betName?: string | null): string {
  if (!betId) return '—';
  const match = CANONICAL_BETS.find((b) => b.bet_id === betId);
  if (match) return `${match.bet_id} · ${match.name}`;
  return betName ? `${betId} · ${betName}` : betId;
}

export const CANONICAL_TASK_TYPE_OPTIONS: FilterOption[] = [
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'pitch', label: 'Pitch' },
  { value: 'call', label: 'Call' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'admin', label: 'Admin' },
];

export function formatRecordClassLabel(recordClass: CampaignRecordClass): string {
  switch (recordClass) {
    case 'historical_synthetic':
      return 'Historical synthetic';
    case 'simulated':
      return 'Simulated';
    case 'live':
      return 'Live';
  }
}

export function formatOpportunityStage(stage?: string | null): string {
  if (!stage) return '—';
  switch (stage) {
    case 'prospecting':
      return 'Prospecting';
    case 'contacted':
      return 'Contacted';
    case 'proposal_sent':
      return 'Proposal sent';
    case 'negotiating':
      return 'Negotiating';
    case 'partner_confirmed':
      return 'Confirmed partnership';
    case 'lost':
      return 'Lost';
    case 'withdrawn':
      return 'Withdrawn';
    default:
      return stage.replace(/_/g, ' ');
  }
}

export function formatSupportType(supportType?: string | null): string {
  if (!supportType) return '—';
  switch (supportType) {
    case 'cash':
      return 'Cash';
    case 'in_kind':
      return 'In-kind';
    case 'mixed':
      return 'Mixed (cash + in-kind)';
    default:
      return supportType.replace(/_/g, ' ');
  }
}

export function isCampaignReadOnly(campaign: CampaignEntity): boolean {
  return (
    campaign.record_class === 'historical_synthetic' ||
    campaign.edition_id === 'ED-2025'
  );
}

/**
 * Formats server-computed MetricQueryResult values strictly without performing
 * any arithmetic on business data.
 */
export function formatMetricValue(result: MetricQueryResult | null | undefined): string {
  if (!result) return '—';
  if (!result.computable || result.value === null || result.value === undefined) {
    return 'Not computable';
  }
  if (result.unit === 'ratio') {
    return `${(result.value * 100).toFixed(1)}%`;
  }
  if (result.unit === '₹ lakh' || result.unit === 'lakh') {
    return `₹${result.value.toFixed(2)}L`;
  }
  if (result.unit === '₹') {
    if (Math.abs(result.value) >= 100000) {
      return `₹${(result.value / 100000).toFixed(2)}L`;
    }
    return `₹${Math.round(result.value).toLocaleString('en-IN')}`;
  }
  if (result.unit === 'days') {
    return `${result.value.toFixed(1)} d`;
  }
  return Number.isInteger(result.value)
    ? result.value.toLocaleString('en-IN')
    : result.value.toFixed(1);
}

export function formatCurrencyInr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  if (Math.abs(amount) >= 100000) {
    return `₹${(amount / 100000).toFixed(2)}L`;
  }
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
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
    let message = 'Unable to complete the request.';
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
      message = 'You do not have permission to perform this action.';
    } else if (response.status === 404) {
      message = 'Campaign data is currently unavailable.';
    }

    throw new CampaignApiError(message, response.status, code);
  }

  if (!isJson) {
    throw new CampaignApiError(
      'Campaign service is currently unavailable.',
      503,
      'SERVICE_UNAVAILABLE'
    );
  }

  return (await response.json()) as T;
}

/**
 * Calls POST /api/metrics/query with the documented contract signature:
 * (metric_ids, record_class, edition_id, as_of, filters) -> MetricQueryResult[]
 */
export async function queryMetrics(
  params: {
    metric_ids: ReadonlyArray<string>;
    record_class: CampaignRecordClass;
    edition_id: string;
    as_of: string;
    filters?: Record<string, string | undefined>;
  },
  signal?: AbortSignal
): Promise<MetricQueryResult[]> {
  const cleanFilters: Record<string, string> = {};
  if (params.filters) {
    for (const [k, v] of Object.entries(params.filters)) {
      if (v && v !== 'all') {
        cleanFilters[k] = v;
      }
    }
  }

  const res = await requestJson<
    MetricQueryResult[] | { results?: MetricQueryResult[]; metrics?: MetricQueryResult[] }
  >(OVERVIEW_API_ENDPOINTS.metricsQuery, {
    method: 'POST',
    signal,
    body: JSON.stringify({
      metric_ids: [...params.metric_ids],
      record_class: params.record_class,
      edition_id: params.edition_id,
      as_of: params.as_of,
      filters: cleanFilters,
    }),
  });

  return Array.isArray(res) ? res : res.results ?? res.metrics ?? [];
}

function normalizeCampaign(raw: Record<string, unknown>): CampaignEntity {
  return {
    campaign_id: String(raw.campaign_id ?? raw.id ?? ''),
    edition_id: String(raw.edition_id ?? ''),
    name: String(raw.name ?? ''),
    channel_id: String(raw.channel_id ?? raw.channel ?? ''),
    bet_id: (raw.bet_id as string | null | undefined) ?? null,
    owner_member_id: (raw.owner_member_id as string | null | undefined) ?? null,
    planned_start: (raw.planned_start as string | null | undefined) ?? null,
    planned_end: (raw.planned_end as string | null | undefined) ?? null,
    objective: (raw.objective as string | null | undefined) ?? null,
    status: (raw.status as CampaignEntity['status']) ?? 'planned',
    record_class: (raw.record_class as CampaignRecordClass) ?? 'simulated',
    channel_name: (raw.channel_name as string | null | undefined) ?? null,
    channel_group: (raw.channel_group as CampaignEntity['channel_group']) ?? null,
    owner_name: (raw.owner_name as string | null | undefined) ?? null,
    bet_name: (raw.bet_name as string | null | undefined) ?? null,
    created_at: (raw.created_at as string | null | undefined) ?? null,
  };
}

export interface CampaignPortfolioResponse {
  rows: CampaignPortfolioRow[];
  summary: CampaignPortfolioSummary;
  owners: FilterOption[];
}

export async function fetchCampaignPortfolio(
  filters: CampaignPortfolioFilters,
  signal?: AbortSignal
): Promise<CampaignPortfolioResponse> {
  const params = new URLSearchParams({
    record_class: filters.record_class,
    edition_id: filters.edition_id,
  });
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.channel_id !== 'all') params.set('channel_id', filters.channel_id);
  if (filters.bet_id !== 'all') params.set('bet_id', filters.bet_id);
  if (filters.owner_member_id !== 'all') {
    params.set('owner_member_id', filters.owner_member_id);
  }
  if (filters.status !== 'all') params.set('status', filters.status);

  const listData = await requestJson<
    | Array<Record<string, unknown>>
    | { campaigns?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }
  >(`${OVERVIEW_API_ENDPOINTS.campaigns}?${params.toString()}`, { signal });

  const rawList = Array.isArray(listData)
    ? listData
    : listData.campaigns ?? listData.items ?? [];

  const campaigns = rawList.map(normalizeCampaign);

  const ownerMap = new Map<string, string>();
  for (const c of campaigns) {
    const id = c.owner_member_id;
    if (id) {
      ownerMap.set(id, c.owner_name || id);
    }
  }
  const owners: FilterOption[] = [
    { value: 'all', label: 'All owners' },
    ...Array.from(ownerMap.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label })),
  ];

  const activeCount = campaigns.filter((c) => c.status === 'active').length;

  let summary: CampaignPortfolioSummary = {
    active_campaigns_count: activeCount,
    open_pipeline_metric: null,
    signed_value_metric: null,
    data_version: null,
  };

  if (campaigns.length === 0) {
    return {
      rows: [],
      summary: {
        ...summary,
        active_campaigns_count: 0,
      },
      owners,
    };
  }

  // Query portfolio-level summary metrics (M-21, M-02) with active allowed filters
  const selectedChannelGroup =
    filters.channel_id !== 'all'
      ? CANONICAL_CHANNELS.find((ch) => ch.channel_id === filters.channel_id)
          ?.channel_group
      : undefined;

  try {
    const summaryResults = await queryMetrics(
      {
        metric_ids: PORTFOLIO_SUMMARY_METRIC_IDS,
        record_class: filters.record_class,
        edition_id: filters.edition_id,
        as_of: filters.as_of,
        filters: {
          channel_group: selectedChannelGroup,
          bet_id: filters.bet_id,
        },
      },
      signal
    );
    const m21 = summaryResults.find((m) => m.metric_id === 'M-21') ?? null;
    const m02 = summaryResults.find((m) => m.metric_id === 'M-02') ?? null;
    summary = {
      active_campaigns_count: activeCount,
      open_pipeline_metric: m21,
      signed_value_metric: m02,
      data_version: m02?.data_version ?? m21?.data_version ?? null,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
  }

  // Query per-campaign metrics (M-23, M-11, M-13, M-09, M-02, M-17) via POST /api/metrics/query
  const rows: CampaignPortfolioRow[] = await Promise.all(
    campaigns.map(async (campaign) => {
      try {
        const results = await queryMetrics(
          {
            metric_ids: CAMPAIGN_METRIC_IDS,
            record_class: filters.record_class,
            edition_id: filters.edition_id,
            as_of: filters.as_of,
            filters: {
              campaign_id: campaign.campaign_id,
            },
          },
          signal
        );
        const map: Partial<Record<CampaignMetricId, MetricQueryResult>> = {};
        for (const item of results) {
          if (CAMPAIGN_METRIC_IDS.includes(item.metric_id as CampaignMetricId)) {
            map[item.metric_id as CampaignMetricId] = item;
          }
        }
        return { campaign, metrics: map };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        return { campaign, metrics: {}, metrics_error: true };
      }
    })
  );

  return { rows, summary, owners };
}

export async function fetchCampaignById(
  campaignId: string,
  recordClass?: CampaignRecordClass,
  editionId?: string,
  signal?: AbortSignal
): Promise<CampaignEntity> {
  const params = new URLSearchParams({ campaign_id: campaignId });
  if (recordClass) params.set('record_class', recordClass);
  if (editionId) params.set('edition_id', editionId);

  const listData = await requestJson<
    | Array<Record<string, unknown>>
    | (Record<string, unknown> & {
        campaign?: Record<string, unknown>;
        campaigns?: Array<Record<string, unknown>>;
        items?: Array<Record<string, unknown>>;
      })
  >(`${OVERVIEW_API_ENDPOINTS.campaigns}?${params.toString()}`, { signal });

  if (Array.isArray(listData)) {
    const match =
      listData.find((r) => String(r.campaign_id ?? r.id ?? '') === campaignId) ??
      listData[0];
    if (!match) {
      throw new CampaignApiError('Campaign not found.', 404, 'NOT_FOUND');
    }
    return normalizeCampaign(match);
  }
  if (listData.campaign) {
    return normalizeCampaign(listData.campaign);
  }
  const arr = listData.campaigns ?? listData.items;
  if (Array.isArray(arr)) {
    const match =
      arr.find((r) => String(r.campaign_id ?? r.id ?? '') === campaignId) ??
      arr[0];
    if (!match) {
      throw new CampaignApiError('Campaign not found.', 404, 'NOT_FOUND');
    }
    return normalizeCampaign(match);
  }
  return normalizeCampaign(listData);
}

export async function createCampaign(
  payload: CampaignWritePayload
): Promise<{ campaign: CampaignEntity; data_version?: string | number }> {
  const res = await requestJson<
    Record<string, unknown> & {
      campaign?: Record<string, unknown>;
      data_version?: string | number;
    }
  >(OVERVIEW_API_ENDPOINTS.campaigns, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const entity = res.campaign ? normalizeCampaign(res.campaign) : normalizeCampaign(res);
  return { campaign: entity, data_version: res.data_version };
}

export async function updateCampaign(
  campaignId: string,
  payload: Partial<CampaignWritePayload>,
  currentRecord?: CampaignEntity
): Promise<{ campaign: CampaignEntity; data_version?: string | number }> {
  if (currentRecord && isCampaignReadOnly(currentRecord)) {
    throw new CampaignApiError(
      'Historical synthetic records are read-only and cannot be modified.',
      403,
      'READ_ONLY_RECORD'
    );
  }

  const res = await requestJson<
    Record<string, unknown> & {
      campaign?: Record<string, unknown>;
      data_version?: string | number;
    }
  >(`${OVERVIEW_API_ENDPOINTS.campaigns}/${encodeURIComponent(campaignId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  const entity = res.campaign ? normalizeCampaign(res.campaign) : normalizeCampaign(res);
  return { campaign: entity, data_version: res.data_version };
}

export async function fetchCampaignOutreach(
  campaignId: string,
  recordClass: CampaignRecordClass,
  editionId: string,
  signal?: AbortSignal
): Promise<OutreachAttemptRecord[]> {
  const params = new URLSearchParams({
    campaign_id: campaignId,
    record_class: recordClass,
    edition_id: editionId,
  });
  const res = await requestJson<
    OutreachAttemptRecord[] | { outreach?: OutreachAttemptRecord[]; items?: OutreachAttemptRecord[] }
  >(`${OVERVIEW_API_ENDPOINTS.outreach}?${params.toString()}`, { signal });

  return Array.isArray(res) ? res : res.outreach ?? res.items ?? [];
}

export async function fetchCampaignInteractions(
  campaignId: string,
  recordClass: CampaignRecordClass,
  editionId: string,
  signal?: AbortSignal
): Promise<InteractionRecord[]> {
  const params = new URLSearchParams({
    campaign_id: campaignId,
    record_class: recordClass,
    edition_id: editionId,
  });
  const res = await requestJson<
    InteractionRecord[] | { interactions?: InteractionRecord[]; items?: InteractionRecord[] }
  >(`${OVERVIEW_API_ENDPOINTS.interactions}?${params.toString()}`, { signal });

  const list = Array.isArray(res) ? res : res.interactions ?? res.items ?? [];
  return [...list].sort((a, b) =>
    (b.occurred_at || '').localeCompare(a.occurred_at || '')
  );
}

export async function fetchCampaignOpportunities(
  campaignId: string,
  recordClass: CampaignRecordClass,
  editionId: string,
  signal?: AbortSignal
): Promise<CampaignOpportunityRecord[]> {
  const params = new URLSearchParams({
    originating_campaign_id: campaignId,
    record_class: recordClass,
    edition_id: editionId,
  });
  const res = await requestJson<
    | CampaignOpportunityRecord[]
    | { opportunities?: CampaignOpportunityRecord[]; items?: CampaignOpportunityRecord[] }
  >(`${OVERVIEW_API_ENDPOINTS.opportunities}?${params.toString()}`, { signal });

  return Array.isArray(res) ? res : res.opportunities ?? res.items ?? [];
}

export async function fetchCampaignTasks(
  campaignId: string,
  recordClass: CampaignRecordClass,
  editionId: string,
  signal?: AbortSignal
): Promise<CampaignTaskRecord[]> {
  const params = new URLSearchParams({
    linked_type: 'campaign',
    linked_id: campaignId,
    record_class: recordClass,
    edition_id: editionId,
  });
  const res = await requestJson<
    CampaignTaskRecord[] | { tasks?: CampaignTaskRecord[]; items?: CampaignTaskRecord[] }
  >(`${OVERVIEW_API_ENDPOINTS.tasks}?${params.toString()}`, { signal });

  return Array.isArray(res) ? res : res.tasks ?? res.items ?? [];
}

export async function createCampaignTask(
  payload: CreateCampaignTaskPayload
): Promise<CampaignTaskRecord> {
  const res = await requestJson<CampaignTaskRecord | { task: CampaignTaskRecord }>(
    OVERVIEW_API_ENDPOINTS.tasks,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
  return 'task' in res ? res.task : res;
}

export async function updateCampaignTaskStatus(
  taskId: string,
  status: CanonicalTaskStatus
): Promise<CampaignTaskRecord> {
  const res = await requestJson<CampaignTaskRecord | { task: CampaignTaskRecord }>(
    `${OVERVIEW_API_ENDPOINTS.tasks}/${encodeURIComponent(taskId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }
  );
  return 'task' in res ? res.task : res;
}

export function deriveCampaignSponsors(
  outreach: OutreachAttemptRecord[],
  interactions: InteractionRecord[],
  opportunities: CampaignOpportunityRecord[]
): CampaignSponsorAssociation[] {
  const map = new Map<string, CampaignSponsorAssociation>();
  const attemptToSponsor = new Map<string, string>();

  for (const att of outreach) {
    const sponsorName = att.sponsor_name?.trim() || att.sponsor_id;
    if (!sponsorName) continue;
    const key = att.sponsor_id || sponsorName.toLowerCase();
    attemptToSponsor.set(att.attempt_id, key);

    const existing = map.get(key) ?? {
      sponsor_key: key,
      sponsor_id: att.sponsor_id ?? null,
      sponsor_name: sponsorName,
      contacts: [],
      attempt_count: 0,
      interaction_count: 0,
      latest_activity_at: null,
    };

    existing.attempt_count += 1;
    if (
      att.started_at &&
      (!existing.latest_activity_at || att.started_at > existing.latest_activity_at)
    ) {
      existing.latest_activity_at = att.started_at;
    }

    if (att.contact_name?.trim()) {
      const cName = att.contact_name.trim();
      if (!existing.contacts.some((c) => c.name.toLowerCase() === cName.toLowerCase())) {
        existing.contacts.push({
          name: cName,
          role: att.contact_role ?? null,
        });
      }
    }

    map.set(key, existing);
  }

  for (const item of interactions) {
    const key =
      item.sponsor_id ||
      attemptToSponsor.get(item.attempt_id) ||
      item.sponsor_name?.trim().toLowerCase();
    if (!key) continue;

    const existing = map.get(key) ?? {
      sponsor_key: key,
      sponsor_id: item.sponsor_id ?? null,
      sponsor_name: item.sponsor_name?.trim() || key,
      contacts: [],
      attempt_count: 0,
      interaction_count: 0,
      latest_activity_at: null,
    };

    existing.interaction_count += 1;
    if (
      item.occurred_at &&
      (!existing.latest_activity_at || item.occurred_at > existing.latest_activity_at)
    ) {
      existing.latest_activity_at = item.occurred_at;
    }

    if (item.contact_name?.trim()) {
      const cName = item.contact_name.trim();
      if (!existing.contacts.some((c) => c.name.toLowerCase() === cName.toLowerCase())) {
        existing.contacts.push({
          name: cName,
          role: item.contact_role ?? null,
        });
      }
    }

    map.set(key, existing);
  }

  for (const opp of opportunities) {
    const key = opp.sponsor_id || opp.sponsor_name?.trim().toLowerCase();
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, {
        sponsor_key: key,
        sponsor_id: opp.sponsor_id ?? null,
        sponsor_name: opp.sponsor_name?.trim() || opp.sponsor_id,
        contacts: [],
        attempt_count: 0,
        interaction_count: 0,
        latest_activity_at: null,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.sponsor_name.localeCompare(b.sponsor_name)
  );
}
