import { apiFetch } from './authSession';
import type {
  CampaignEntity,
  CampaignTaskRecord,
  CanonicalTaskStatus,
  InteractionRecord,
  MetricQueryResult,
} from '../types/campaigns';
import type { FilterOption } from '../types/overview';
import {
  ALL_OPPORTUNITY_STAGES,
  CLOSED_OPPORTUNITY_STAGES,
  OPEN_OPPORTUNITY_STAGES,
  PIPELINE_SUMMARY_METRIC_IDS,
  type CreateOpportunityTaskPayload,
  type MeetingRecord,
  type OpportunityCreatePayload,
  type OpportunityEntity,
  type OpportunityMetadataUpdatePayload,
  type OpportunityRecordClass,
  type OpportunityStage,
  type OpportunityStageTransitionPayload,
  type OpportunityStageVersionRecord,
  type OpportunitySupportType,
  type PipelineFilters,
  type PipelineMetricMeta,
  type PipelineSummaryMetricId,
  type PipelineSummaryState,
  type ProposalRecord,
  type ProposalStatus,
} from '../types/pipeline';
import type {
  SponsorContractRecord,
  UserPermissionContext,
} from '../types/sponsors';
import {
  formatOpportunityStage,
  formatSupportType,
  queryMetrics,
} from './campaignsApi';
import { OVERVIEW_API_ENDPOINTS } from './overviewApi';

export class PipelineApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = 'API_ERROR') {
    super(message);
    this.name = 'PipelineApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Exact metric definitions from 05_metric_dictionary.csv for Pipeline summary.
 */
export const PIPELINE_METRIC_DICTIONARY: Record<
  PipelineSummaryMetricId,
  PipelineMetricMeta
> = {
  'M-21': {
    metric_id: 'M-21',
    name: 'Open pipeline value',
    kpi_id: null,
    formula: 'SUM(proposed_value_inr) of latest versions with stage_class = open',
    unit: '₹',
    inclusion_exclusion:
      'Proposed face value of open opportunities; never a probability-weighted forecast.',
    computable_2025: true,
  },
  'M-09': {
    metric_id: 'M-09',
    name: 'Confirmed partnerships',
    kpi_id: null,
    formula: 'COUNT(opportunity) with latest stage = partner_confirmed',
    unit: 'opportunities',
    inclusion_exclusion: 'One sponsor can have several opportunities.',
    computable_2025: true,
  },
  'M-02': {
    metric_id: 'M-02',
    name: 'Signed (confirmed) value',
    kpi_id: 'K-G-01',
    formula: 'SUM(confirmed_value_inr) of latest version with stage = partner_confirmed',
    unit: '₹',
    inclusion_exclusion:
      'Includes in-kind; excludes withdrawn and lost; never call it cash collected.',
    computable_2025: true,
  },
  'M-03': {
    metric_id: 'M-03',
    name: 'Signed cash-type value',
    kpi_id: 'K-G-01',
    formula: 'SUM(confirmed_value_inr) where support_type = cash',
    unit: '₹',
    inclusion_exclusion: 'Excludes in-kind deals.',
    computable_2025: true,
  },
  'M-04': {
    metric_id: 'M-04',
    name: 'In-kind value',
    kpi_id: null,
    formula: 'SUM(confirmed_value_inr) where support_type = in_kind',
    unit: '₹',
    inclusion_exclusion: 'Reported separately; never counted as cash.',
    computable_2025: true,
  },
  'M-13': {
    metric_id: 'M-13',
    name: 'Win rate per proposal',
    kpi_id: 'K-F-03',
    formula: 'won opportunities ÷ opportunities that reached proposal_sent',
    unit: 'ratio',
    inclusion_exclusion:
      'Opportunity level; withdrawn after confirmation counts as not won.',
    computable_2025: true,
  },
  'M-20': {
    metric_id: 'M-20',
    name: 'Avg days to confirm',
    kpi_id: null,
    formula: 'AVG(confirmed_at − created_at) in days',
    unit: 'days',
    inclusion_exclusion: 'Won (partner_confirmed) opportunities only.',
    computable_2025: true,
  },
};

export const OPPORTUNITY_STAGE_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All stages' },
  ...ALL_OPPORTUNITY_STAGES.map((stage) => ({
    value: stage,
    label: formatOpportunityStage(stage),
  })),
];

export const OPPORTUNITY_SUPPORT_TYPE_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All support types' },
  { value: 'cash', label: 'Cash' },
  { value: 'in_kind', label: 'In-kind' },
  { value: 'mixed', label: 'Mixed (cash + in-kind)' },
];

export const OPPORTUNITY_RECORD_CLASS_OPTIONS: FilterOption[] = [
  { value: 'simulated', label: 'Simulated (2026 demo)' },
  { value: 'historical_synthetic', label: 'Historical synthetic (2025, read-only)' },
  { value: 'live', label: 'Live' },
];

export const OPPORTUNITY_EDITION_BY_CLASS: Record<
  OpportunityRecordClass,
  FilterOption[]
> = {
  simulated: [{ value: 'ED-2026-DEMO', label: 'ED-2026-DEMO' }],
  historical_synthetic: [
    { value: 'ED-2025', label: 'ED-2025 (CampusFest 2025)' },
  ],
  live: [{ value: 'ED-2026-LIVE', label: 'ED-2026-LIVE' }],
};

/**
 * Provisional suggestions for OPPORTUNITY_STAGE_VERSION.drop_reason / loss_reason.
 * Open enum in 01_conceptual_data_model.md §4B (K-B1-05, K-B2-03).
 */
export const DROP_REASON_SUGGESTIONS: ReadonlyArray<string> = [
  'budget_frozen',
  'no_response',
  'timing_mismatch',
  'terms_dispute',
  'category_exclusivity_conflict',
  'sla_lapsed',
  'sponsor_withdrew',
  'other',
];

export const LOSS_REASON_SUGGESTIONS: ReadonlyArray<string> = [
  'terms_dispute',
  'pricing_mismatch',
  'competitor_selected',
  'low_brand_fit',
  'deliverables_mismatch',
  'budget_cut',
];

export function getDefaultPipelineEditionForClass(
  recordClass: OpportunityRecordClass
): string {
  return OPPORTUNITY_EDITION_BY_CLASS[recordClass][0].value;
}

export function isOpportunityReadOnly(opportunity: OpportunityEntity): boolean {
  return (
    opportunity.record_class === 'historical_synthetic' ||
    opportunity.edition_id === 'ED-2025'
  );
}

export function isOpenStage(stage?: OpportunityStage | null): boolean {
  return Boolean(stage && OPEN_OPPORTUNITY_STAGES.includes(stage));
}

export function isClosedStage(stage?: OpportunityStage | null): boolean {
  return Boolean(stage && CLOSED_OPPORTUNITY_STAGES.includes(stage));
}

export function formatProposalStatus(status: ProposalStatus | string): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'sent':
      return 'Sent';
    case 'superseded':
      return 'Superseded';
    case 'accepted':
      return 'Accepted';
    case 'declined':
      return 'Declined';
    default:
      return String(status).replace(/_/g, ' ');
  }
}

export function formatMeetingStatus(status: MeetingRecord['status']): string {
  switch (status) {
    case 'booked':
      return 'Booked';
    case 'held':
      return 'Held';
    case 'no_show':
      return 'No-show';
    case 'cancelled':
      return 'Cancelled';
  }
}

export function formatPipelineMetricValue(
  result: MetricQueryResult | null | undefined,
  unitOverride?: PipelineMetricMeta['unit']
): string {
  if (!result) return '—';
  if (!result.computable || result.value === null || result.value === undefined) {
    return 'Not computable';
  }
  const unit = unitOverride ?? result.unit;
  if (unit === 'ratio') {
    return `${(result.value * 100).toFixed(1)}%`;
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

/**
 * UI-level edit check derived from 02_architecture_requirements.md §4 permission matrix:
 * - Opportunities and stage: CRUA (coordination_lead), CRU (pipeline_ops),
 *   CRU (own) (partnerships / community / network / premium_sales), R (finance_collections / viewer).
 * - Actual authorization is enforced server-side.
 */
export function canUserEditOpportunity(
  opportunity: OpportunityEntity,
  permissions: UserPermissionContext
): boolean {
  if (isOpportunityReadOnly(opportunity)) return false;
  if (!permissions.verified_by_server) return true;
  if (permissions.write_scope === 'all') return true;
  if (permissions.write_scope === 'none') return false;
  const ownerId = opportunity.current_stage_version?.owner_member_id;
  if (!permissions.member_id || !ownerId) return false;
  return ownerId === permissions.member_id;
}

export function canUserConfirmPartnership(
  permissions: UserPermissionContext
): boolean {
  if (!permissions.verified_by_server) return true;
  // Per §4: coordination_lead holds CRUA (A = approve or confirm) on Opportunities and stage.
  // Pipeline ops / sales hold CRU; backend governs final confirmation rules.
  return permissions.write_scope === 'all' || permissions.write_scope === 'own';
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
      message = 'Pipeline data is currently unavailable.';
    }

    throw new PipelineApiError(message, response.status, code);
  }

  if (!isJson) {
    throw new PipelineApiError(
      'Pipeline service is currently unavailable.',
      503,
      'SERVICE_UNAVAILABLE'
    );
  }

  return (await response.json()) as T;
}

function normalizeStageVersion(
  raw: Record<string, unknown>,
  fallbackOpportunityId: string
): OpportunityStageVersionRecord {
  const isCurrent =
    typeof raw.is_current === 'boolean'
      ? raw.is_current
      : raw.valid_to === null || raw.valid_to === undefined;
  return {
    history_id: String(raw.history_id ?? raw.id ?? 'current'),
    opportunity_id: String(raw.opportunity_id ?? fallbackOpportunityId),
    stage: (raw.stage as OpportunityStage) ?? 'prospecting',
    owner_member_id: (raw.owner_member_id as string | null | undefined) ?? null,
    proposed_value:
      raw.proposed_value !== null && raw.proposed_value !== undefined
        ? Number(raw.proposed_value)
        : raw.proposed_value_inr !== null && raw.proposed_value_inr !== undefined
          ? Number(raw.proposed_value_inr)
          : null,
    confirmed_value:
      raw.confirmed_value !== null && raw.confirmed_value !== undefined
        ? Number(raw.confirmed_value)
        : raw.confirmed_value_inr !== null &&
            raw.confirmed_value_inr !== undefined
          ? Number(raw.confirmed_value_inr)
          : null,
    drop_reason: (raw.drop_reason as string | null | undefined) ?? null,
    loss_reason: (raw.loss_reason as string | null | undefined) ?? null,
    valid_from: (raw.valid_from as string | null | undefined) ?? null,
    valid_to: (raw.valid_to as string | null | undefined) ?? null,
    is_current: isCurrent,
    record_class:
      (raw.record_class as OpportunityRecordClass | undefined) ?? undefined,
    created_at: (raw.created_at as string | null | undefined) ?? null,
    created_by: (raw.created_by as string | null | undefined) ?? null,
    owner_name: (raw.owner_name as string | null | undefined) ?? null,
    created_by_name: (raw.created_by_name as string | null | undefined) ?? null,
  };
}

function normalizeProposal(raw: Record<string, unknown>): ProposalRecord {
  return {
    proposal_id: String(raw.proposal_id ?? raw.id ?? ''),
    opportunity_id: String(raw.opportunity_id ?? ''),
    package_id: (raw.package_id as string | null | undefined) ?? null,
    package_name: (raw.package_name as string | null | undefined) ?? null,
    proposed_value: Number(raw.proposed_value ?? 0),
    exclusivity_requested:
      (raw.exclusivity_requested as ProposalRecord['exclusivity_requested']) ??
      null,
    sent_at: (raw.sent_at as string | null | undefined) ?? null,
    valid_until: (raw.valid_until as string | null | undefined) ?? null,
    status: (raw.status as ProposalStatus) ?? 'draft',
    document_uri: (raw.document_uri as string | null | undefined) ?? null,
    record_class:
      (raw.record_class as ProposalRecord['record_class'] | undefined) ??
      undefined,
    created_at: (raw.created_at as string | null | undefined) ?? null,
    created_by: (raw.created_by as string | null | undefined) ?? null,
  };
}

function normalizeOpportunity(raw: Record<string, unknown>): OpportunityEntity {
  const opportunityId = String(raw.opportunity_id ?? raw.id ?? '');

  const rawHistory = Array.isArray(raw.stage_history)
    ? (raw.stage_history as Array<Record<string, unknown>>)
    : Array.isArray(raw.stage_versions)
      ? (raw.stage_versions as Array<Record<string, unknown>>)
      : null;

  const stageHistory: OpportunityStageVersionRecord[] | null = rawHistory
    ? rawHistory
        .map((item) => normalizeStageVersion(item, opportunityId))
        .sort((a, b) =>
          (b.valid_from ?? b.created_at ?? '').localeCompare(
            a.valid_from ?? a.created_at ?? ''
          )
        )
    : null;

  let currentStageVersion: OpportunityStageVersionRecord | null = null;
  if (raw.current_stage_version && typeof raw.current_stage_version === 'object') {
    currentStageVersion = normalizeStageVersion(
      raw.current_stage_version as Record<string, unknown>,
      opportunityId
    );
  } else if (stageHistory && stageHistory.length > 0) {
    currentStageVersion =
      stageHistory.find((v) => v.is_current ?? !v.valid_to) ?? stageHistory[0];
  } else if (raw.stage) {
    currentStageVersion = normalizeStageVersion(raw, opportunityId);
  }

  const rawProposals = Array.isArray(raw.proposals)
    ? (raw.proposals as Array<Record<string, unknown>>).map(normalizeProposal)
    : null;

  return {
    opportunity_id: opportunityId,
    sponsor_id: String(raw.sponsor_id ?? ''),
    edition_id: String(raw.edition_id ?? ''),
    primary_contact_id:
      (raw.primary_contact_id as string | null | undefined) ?? null,
    originating_campaign_id:
      (raw.originating_campaign_id as string | null | undefined) ?? null,
    bet_id: (raw.bet_id as string | null | undefined) ?? null,
    support_type: (raw.support_type as OpportunitySupportType) ?? 'cash',
    is_renewal:
      typeof raw.is_renewal === 'boolean' ? raw.is_renewal : null,
    renewal_route: (raw.renewal_route as string | null | undefined) ?? null,
    recovered_lead:
      typeof raw.recovered_lead === 'boolean' ? raw.recovered_lead : null,
    name: (raw.name as string | null | undefined) ?? null,
    record_class:
      (raw.record_class as OpportunityRecordClass) ?? 'simulated',
    source_ref: (raw.source_ref as string | null | undefined) ?? null,
    data_version:
      (raw.data_version as string | number | null | undefined) ?? null,
    created_at: (raw.created_at as string | null | undefined) ?? null,
    created_by: (raw.created_by as string | null | undefined) ?? null,
    current_stage_version: currentStageVersion,
    stage_history: stageHistory,
    sponsor_name: (raw.sponsor_name as string | null | undefined) ?? null,
    sponsor_category_id:
      (raw.sponsor_category_id as string | null | undefined) ??
      (raw.category_id as string | null | undefined) ??
      null,
    sponsor_category_name:
      (raw.sponsor_category_name as string | null | undefined) ??
      (raw.category_name as string | null | undefined) ??
      null,
    primary_contact_name:
      (raw.primary_contact_name as string | null | undefined) ?? null,
    originating_campaign_name:
      (raw.originating_campaign_name as string | null | undefined) ?? null,
    bet_name: (raw.bet_name as string | null | undefined) ?? null,
    has_contract: Boolean(raw.has_contract),
    proposals: rawProposals,
  };
}

export interface PipelineWorkspaceResult {
  opportunities: OpportunityEntity[];
  summary: PipelineSummaryState;
  owners: FilterOption[];
  campaigns: FilterOption[];
  categories: FilterOption[];
}

export async function fetchPipelineWorkspace(
  filters: PipelineFilters,
  signal?: AbortSignal
): Promise<PipelineWorkspaceResult> {
  const params = new URLSearchParams({
    record_class: filters.record_class,
    edition_id: filters.edition_id,
  });
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.stage !== 'all') params.set('stage', filters.stage);
  if (filters.owner_member_id !== 'all') {
    params.set('owner_member_id', filters.owner_member_id);
  }
  if (filters.originating_campaign_id !== 'all') {
    params.set('originating_campaign_id', filters.originating_campaign_id);
  }
  if (filters.bet_id !== 'all') params.set('bet_id', filters.bet_id);
  if (filters.support_type !== 'all') {
    params.set('support_type', filters.support_type);
  }
  if (filters.category_id !== 'all') {
    params.set('category_id', filters.category_id);
  }

  const rawData = await requestJson<
    | Array<Record<string, unknown>>
    | {
        opportunities?: Array<Record<string, unknown>>;
        items?: Array<Record<string, unknown>>;
      }
  >(`${OVERVIEW_API_ENDPOINTS.opportunities}?${params.toString()}`, { signal });

  const rawList = Array.isArray(rawData)
    ? rawData
    : rawData.opportunities ?? rawData.items ?? [];

  const opportunities = rawList.map(normalizeOpportunity);

  const ownerMap = new Map<string, string>();
  const campaignMap = new Map<string, string>();
  const categoryMap = new Map<string, string>();

  for (const opp of opportunities) {
    const ownerId = opp.current_stage_version?.owner_member_id;
    if (ownerId) {
      ownerMap.set(ownerId, opp.current_stage_version?.owner_name || ownerId);
    }
    if (opp.originating_campaign_id) {
      campaignMap.set(
        opp.originating_campaign_id,
        opp.originating_campaign_name || opp.originating_campaign_id
      );
    }
    if (opp.sponsor_category_id) {
      categoryMap.set(
        opp.sponsor_category_id,
        opp.sponsor_category_name || opp.sponsor_category_id
      );
    }
  }

  const owners: FilterOption[] = [
    { value: 'all', label: 'All owners' },
    ...Array.from(ownerMap.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label })),
  ];

  const campaigns: FilterOption[] = [
    { value: 'all', label: 'All campaigns' },
    ...Array.from(campaignMap.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label })),
  ];

  const categories: FilterOption[] = [
    { value: 'all', label: 'All categories' },
    ...Array.from(categoryMap.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label })),
  ];

  // Query summary KPIs strictly from POST /api/metrics/query; never compute in React.
  let summary: PipelineSummaryState = { metrics: {}, data_version: null };
  try {
    const results = await queryMetrics(
      {
        metric_ids: PIPELINE_SUMMARY_METRIC_IDS,
        record_class: filters.record_class,
        edition_id: filters.edition_id,
        as_of: filters.as_of,
        filters: {
          campaign_id: filters.originating_campaign_id,
          bet_id: filters.bet_id,
        },
      },
      signal
    );

    const map: Partial<Record<PipelineSummaryMetricId, MetricQueryResult>> = {};
    let dataVersion: string | number | null = null;
    for (const item of results) {
      if (
        PIPELINE_SUMMARY_METRIC_IDS.includes(
          item.metric_id as PipelineSummaryMetricId
        )
      ) {
        map[item.metric_id as PipelineSummaryMetricId] = item;
        if (item.data_version !== undefined && item.data_version !== null) {
          dataVersion = item.data_version;
        }
      }
    }
    summary = { metrics: map, data_version: dataVersion };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    summary = { metrics: {}, data_version: null, error: true };
  }

  return { opportunities, summary, owners, campaigns, categories };
}

export async function fetchOpportunityById(
  opportunityId: string,
  recordClass?: OpportunityRecordClass,
  editionId?: string,
  signal?: AbortSignal
): Promise<OpportunityEntity> {
  const params = new URLSearchParams({ opportunity_id: opportunityId });
  if (recordClass) params.set('record_class', recordClass);
  if (editionId) params.set('edition_id', editionId);

  const rawData = await requestJson<
    | Array<Record<string, unknown>>
    | (Record<string, unknown> & {
        opportunity?: Record<string, unknown>;
        opportunities?: Array<Record<string, unknown>>;
        items?: Array<Record<string, unknown>>;
      })
  >(`${OVERVIEW_API_ENDPOINTS.opportunities}?${params.toString()}`, { signal });

  if (Array.isArray(rawData)) {
    const match =
      rawData.find(
        (r) => String(r.opportunity_id ?? r.id ?? '') === opportunityId
      ) ?? rawData[0];
    if (!match) {
      throw new PipelineApiError('Opportunity not found.', 404, 'NOT_FOUND');
    }
    return normalizeOpportunity(match);
  }
  if (rawData.opportunity) {
    return normalizeOpportunity(rawData.opportunity);
  }
  const arr = rawData.opportunities ?? rawData.items;
  if (Array.isArray(arr)) {
    const match =
      arr.find(
        (r) => String(r.opportunity_id ?? r.id ?? '') === opportunityId
      ) ?? arr[0];
    if (!match) {
      throw new PipelineApiError('Opportunity not found.', 404, 'NOT_FOUND');
    }
    return normalizeOpportunity(match);
  }
  return normalizeOpportunity(rawData);
}

export async function createOpportunity(
  payload: OpportunityCreatePayload
): Promise<{ opportunity: OpportunityEntity; data_version?: string | number }> {
  const res = await requestJson<
    Record<string, unknown> & {
      opportunity?: Record<string, unknown>;
      data_version?: string | number;
    }
  >(OVERVIEW_API_ENDPOINTS.opportunities, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const opportunity = res.opportunity
    ? normalizeOpportunity(res.opportunity)
    : normalizeOpportunity(res);
  return { opportunity, data_version: res.data_version };
}

export async function updateOpportunityMetadata(
  opportunityId: string,
  payload: OpportunityMetadataUpdatePayload,
  currentRecord?: OpportunityEntity
): Promise<{ opportunity: OpportunityEntity; data_version?: string | number }> {
  if (currentRecord && isOpportunityReadOnly(currentRecord)) {
    throw new PipelineApiError(
      'Historical synthetic records are read-only and cannot be modified.',
      403,
      'READ_ONLY_RECORD'
    );
  }

  const res = await requestJson<
    Record<string, unknown> & {
      opportunity?: Record<string, unknown>;
      data_version?: string | number;
    }
  >(`${OVERVIEW_API_ENDPOINTS.opportunities}/${encodeURIComponent(opportunityId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  const opportunity = res.opportunity
    ? normalizeOpportunity(res.opportunity)
    : normalizeOpportunity(res);
  return { opportunity, data_version: res.data_version };
}

export async function appendOpportunityStageVersion(
  opportunityId: string,
  payload: OpportunityStageTransitionPayload,
  currentRecord?: OpportunityEntity
): Promise<{
  opportunity?: OpportunityEntity;
  stage_version?: OpportunityStageVersionRecord;
  data_version?: string | number;
}> {
  if (currentRecord && isOpportunityReadOnly(currentRecord)) {
    throw new PipelineApiError(
      'Historical synthetic records are read-only and cannot be modified.',
      403,
      'READ_ONLY_RECORD'
    );
  }

  if (
    (payload.stage === 'lost' || payload.stage === 'withdrawn') &&
    !payload.drop_reason?.trim()
  ) {
    throw new PipelineApiError(
      'A drop reason is required when marking an opportunity lost or withdrawn.',
      400,
      'DROP_REASON_REQUIRED'
    );
  }

  if (
    payload.stage !== 'partner_confirmed' &&
    payload.confirmed_value !== null &&
    payload.confirmed_value !== undefined &&
    payload.confirmed_value > 0
  ) {
    throw new PipelineApiError(
      'Confirmed value can only be non-zero at partner_confirmed.',
      400,
      'INVALID_CONFIRMED_VALUE'
    );
  }

  const normalizedPayload: OpportunityStageTransitionPayload = {
    ...payload,
    confirmed_value:
      payload.stage === 'partner_confirmed'
        ? payload.confirmed_value ?? 0
        : 0,
  };

  const res = await requestJson<
    Record<string, unknown> & {
      opportunity?: Record<string, unknown>;
      stage_version?: Record<string, unknown>;
      data_version?: string | number;
    }
  >(
    `${OVERVIEW_API_ENDPOINTS.opportunities}/${encodeURIComponent(opportunityId)}/stage`,
    {
      method: 'POST',
      body: JSON.stringify(normalizedPayload),
    }
  );

  return {
    opportunity: res.opportunity
      ? normalizeOpportunity(res.opportunity)
      : undefined,
    stage_version: res.stage_version
      ? normalizeStageVersion(res.stage_version, opportunityId)
      : undefined,
    data_version: res.data_version,
  };
}

export async function fetchOpportunityMeetings(
  opportunityId: string,
  recordClass: OpportunityRecordClass,
  editionId: string,
  signal?: AbortSignal
): Promise<MeetingRecord[]> {
  const params = new URLSearchParams({
    opportunity_id: opportunityId,
    record_class: recordClass,
    edition_id: editionId,
  });
  const res = await requestJson<
    MeetingRecord[] | { meetings?: MeetingRecord[]; items?: MeetingRecord[] }
  >(`${OVERVIEW_API_ENDPOINTS.meetings}?${params.toString()}`, { signal });

  const list = Array.isArray(res) ? res : res.meetings ?? res.items ?? [];
  return [...list].sort((a, b) =>
    (b.scheduled_at || '').localeCompare(a.scheduled_at || '')
  );
}

export async function fetchOpportunitySponsorInteractions(
  sponsorId: string,
  recordClass: OpportunityRecordClass,
  editionId: string,
  signal?: AbortSignal
): Promise<InteractionRecord[]> {
  const params = new URLSearchParams({
    sponsor_id: sponsorId,
    record_class: recordClass,
    edition_id: editionId,
  });
  const res = await requestJson<
    | InteractionRecord[]
    | { interactions?: InteractionRecord[]; items?: InteractionRecord[] }
  >(`${OVERVIEW_API_ENDPOINTS.interactions}?${params.toString()}`, { signal });

  const list = Array.isArray(res) ? res : res.interactions ?? res.items ?? [];
  return [...list].sort((a, b) =>
    (b.occurred_at || '').localeCompare(a.occurred_at || '')
  );
}

export async function fetchOpportunityTasks(
  opportunityId: string,
  recordClass: OpportunityRecordClass,
  editionId: string,
  signal?: AbortSignal
): Promise<CampaignTaskRecord[]> {
  const params = new URLSearchParams({
    linked_type: 'opportunity',
    linked_id: opportunityId,
    record_class: recordClass,
    edition_id: editionId,
  });
  const res = await requestJson<
    CampaignTaskRecord[] | { tasks?: CampaignTaskRecord[]; items?: CampaignTaskRecord[] }
  >(`${OVERVIEW_API_ENDPOINTS.tasks}?${params.toString()}`, { signal });

  return Array.isArray(res) ? res : res.tasks ?? res.items ?? [];
}

export async function createOpportunityTask(
  payload: CreateOpportunityTaskPayload
): Promise<CampaignTaskRecord> {
  const res = await requestJson<
    CampaignTaskRecord | { task: CampaignTaskRecord }
  >(OVERVIEW_API_ENDPOINTS.tasks, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return 'task' in res ? res.task : res;
}

export async function updateOpportunityTaskStatus(
  taskId: string,
  status: CanonicalTaskStatus
): Promise<CampaignTaskRecord> {
  const res = await requestJson<
    CampaignTaskRecord | { task: CampaignTaskRecord }
  >(`${OVERVIEW_API_ENDPOINTS.tasks}/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  return 'task' in res ? res.task : res;
}

export async function fetchOpportunityContracts(
  opportunityId: string,
  recordClass: OpportunityRecordClass,
  signal?: AbortSignal
): Promise<SponsorContractRecord[]> {
  if (recordClass === 'historical_synthetic') return [];
  const params = new URLSearchParams({
    opportunity_id: opportunityId,
    record_class: recordClass,
  });
  const res = await requestJson<
    | SponsorContractRecord[]
    | { contracts?: SponsorContractRecord[]; items?: SponsorContractRecord[] }
  >(`${OVERVIEW_API_ENDPOINTS.contracts}?${params.toString()}`, { signal });

  return Array.isArray(res) ? res : res.contracts ?? res.items ?? [];
}

export async function fetchPipelineContextCampaigns(
  recordClass: OpportunityRecordClass,
  editionId: string,
  signal?: AbortSignal
): Promise<CampaignEntity[]> {
  const params = new URLSearchParams({
    record_class: recordClass,
    edition_id: editionId,
  });
  const res = await requestJson<
    | CampaignEntity[]
    | { campaigns?: CampaignEntity[]; items?: CampaignEntity[] }
  >(`${OVERVIEW_API_ENDPOINTS.campaigns}?${params.toString()}`, { signal });

  return Array.isArray(res) ? res : res.campaigns ?? res.items ?? [];
}

export { formatOpportunityStage, formatSupportType };
