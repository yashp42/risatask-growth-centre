import type {
  BetId,
  CampaignRecordClass,
  CanonicalTaskStatus,
  CanonicalTaskType,
  MetricQueryResult,
  OpportunityStage,
  OpportunitySupportType,
} from './campaigns';

export type { OpportunityStage, OpportunitySupportType };

export const PIPELINE_SUMMARY_METRIC_IDS = [
  'M-21',
  'M-09',
  'M-02',
  'M-03',
  'M-04',
  'M-13',
  'M-20',
] as const;

export type PipelineSummaryMetricId =
  (typeof PIPELINE_SUMMARY_METRIC_IDS)[number];

export type OpportunityRecordClass = CampaignRecordClass;

export const OPEN_OPPORTUNITY_STAGES: ReadonlyArray<OpportunityStage> = [
  'prospecting',
  'contacted',
  'proposal_sent',
  'negotiating',
];

export const CLOSED_OPPORTUNITY_STAGES: ReadonlyArray<OpportunityStage> = [
  'partner_confirmed',
  'lost',
  'withdrawn',
];

export const ALL_OPPORTUNITY_STAGES: ReadonlyArray<OpportunityStage> = [
  ...OPEN_OPPORTUNITY_STAGES,
  ...CLOSED_OPPORTUNITY_STAGES,
];

/**
 * Canonical OPPORTUNITY_STAGE_VERSION entity (01_conceptual_data_model.md §4B)
 * Append-only full-state versions; stage, owner, proposed_value, confirmed_value,
 * drop_reason and loss_reason live strictly here, never on OPPORTUNITY.
 */
export interface OpportunityStageVersionRecord {
  history_id: string;
  opportunity_id: string;
  stage: OpportunityStage;
  owner_member_id?: string | null;
  proposed_value?: number | null;
  confirmed_value?: number | null;
  drop_reason?: string | null;
  loss_reason?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  is_current?: boolean;
  record_class?: OpportunityRecordClass;
  created_at?: string | null;
  created_by?: string | null;
  // Optional server-joined display labels
  owner_name?: string | null;
  created_by_name?: string | null;
}

/**
 * Canonical OPPORTUNITY entity (01_conceptual_data_model.md §4B)
 * Exact attributes: opportunity_id, sponsor_id, edition_id, primary_contact_id,
 * originating_campaign_id, bet_id, support_type, is_renewal, renewal_route,
 * recovered_lead, name.
 * Current stage/values are derived from OPPORTUNITY_STAGE_VERSION.
 */
export interface OpportunityEntity {
  opportunity_id: string;
  sponsor_id: string;
  edition_id: string;
  primary_contact_id?: string | null;
  originating_campaign_id?: string | null;
  bet_id?: BetId | string | null;
  support_type: OpportunitySupportType;
  is_renewal?: boolean | null;
  renewal_route?: string | null;
  recovered_lead?: boolean | null;
  name?: string | null;
  // Standard provenance
  record_class: OpportunityRecordClass;
  source_ref?: string | null;
  data_version?: string | number | null;
  created_at?: string | null;
  created_by?: string | null;
  // Derived from current OPPORTUNITY_STAGE_VERSION
  current_stage_version: OpportunityStageVersionRecord | null;
  stage_history: OpportunityStageVersionRecord[] | null;
  // Optional server-joined display labels
  sponsor_name?: string | null;
  sponsor_category_id?: string | null;
  sponsor_category_name?: string | null;
  primary_contact_name?: string | null;
  originating_campaign_name?: string | null;
  bet_name?: string | null;
  has_contract?: boolean;
  proposals?: ProposalRecord[] | null;
}

/**
 * Canonical OPPORTUNITY creation payload + initial OPPORTUNITY_STAGE_VERSION seed.
 * Never sets confirmed_value at creation and never infers renewal_route/recovered_lead.
 */
export interface OpportunityCreatePayload {
  sponsor_id: string;
  edition_id: string;
  primary_contact_id?: string | null;
  originating_campaign_id?: string | null;
  bet_id?: string | null;
  support_type: OpportunitySupportType;
  is_renewal?: boolean;
  name?: string | null;
  record_class: 'simulated' | 'live';
  initial_stage: {
    stage: 'prospecting' | 'contacted' | 'proposal_sent' | 'negotiating';
    owner_member_id?: string | null;
    proposed_value?: number | null;
  };
}

/**
 * Mutable OPPORTUNITY metadata update payload (PATCH /api/opportunities/:id).
 * originating_campaign_id and sponsor_id are immutable; stage/values use POST /stage.
 */
export interface OpportunityMetadataUpdatePayload {
  primary_contact_id?: string | null;
  bet_id?: string | null;
  support_type?: OpportunitySupportType;
  is_renewal?: boolean;
  name?: string | null;
}

/**
 * Append-only stage transition payload (POST /api/opportunities/:id/stage).
 */
export interface OpportunityStageTransitionPayload {
  stage: OpportunityStage;
  owner_member_id?: string | null;
  proposed_value?: number | null;
  confirmed_value?: number | null;
  drop_reason?: string | null;
  loss_reason?: string | null;
}

export type PaymentTermsCode = 'standard_50_50' | '100_upfront' | 'custom';

export interface ConfirmOpportunityLinePayload {
  considerationType: 'cash' | 'in_kind';
  value: number;
  assetId?: string | null;
  priceId?: string | null;
}

export interface ConfirmOpportunityPayload {
  signedAt: string;
  paymentTerms: PaymentTermsCode;
  signatoryContactId?: string | null;
  documentUri?: string | null;
  lines: ConfirmOpportunityLinePayload[];
  signedValueTotal: number;
}

export interface InventoryAssetOption {
  asset_id: string;
  edition_id: string;
  asset_type: string;
  slots_total?: number | null;
  is_premium?: boolean;
}

/**
 * Canonical PROPOSAL entity (01_conceptual_data_model.md §4C)
 */
export type ProposalStatus =
  | 'draft'
  | 'sent'
  | 'superseded'
  | 'accepted'
  | 'declined';

export type ProposalExclusivityRequested = 'none' | 'narrow' | 'broad';

export interface ProposalRecord {
  proposal_id: string;
  opportunity_id: string;
  package_id?: string | null;
  package_name?: string | null;
  proposed_value: number;
  exclusivity_requested?: ProposalExclusivityRequested | null;
  sent_at?: string | null;
  valid_until?: string | null;
  status: ProposalStatus;
  document_uri?: string | null;
  record_class?: 'simulated' | 'live';
  created_at?: string | null;
  created_by?: string | null;
}

/**
 * Canonical MEETING entity (01_conceptual_data_model.md §4B)
 */
export type MeetingStatus = 'booked' | 'held' | 'no_show' | 'cancelled';
export type MeetingPurpose =
  | 'discovery'
  | 'renewal_screen'
  | 'title_pitch'
  | 'negotiation';

export interface MeetingRecord {
  meeting_id: string;
  attempt_id?: string | null;
  opportunity_id?: string | null;
  sponsor_id: string;
  scheduled_at: string;
  status: MeetingStatus;
  purpose?: MeetingPurpose | null;
  attendee_member_ids?: string[] | null;
  outcome_note?: string | null;
  record_class?: OpportunityRecordClass;
}

/**
 * Canonical TASK create payload for opportunity-linked tasks (01_conceptual_data_model.md §4E)
 */
export interface CreateOpportunityTaskPayload {
  title: string;
  task_type: CanonicalTaskType;
  owner_member_id: string;
  due_at: string;
  status: Extract<CanonicalTaskStatus, 'open'>;
  linked_type: 'opportunity';
  linked_id: string;
  bet_id?: string | null;
  origin: 'manual';
}

export interface PipelineMetricMeta {
  metric_id: PipelineSummaryMetricId;
  name: string;
  kpi_id: string | null;
  formula: string;
  unit: '₹' | 'opportunities' | 'ratio' | 'days';
  inclusion_exclusion: string;
  computable_2025: boolean;
}

export type PipelineScopeView = 'active' | 'outcomes' | 'all';
export type PipelineDisplayMode = 'board' | 'table';

export interface PipelineFilters {
  search: string;
  record_class: OpportunityRecordClass;
  edition_id: string;
  stage: string;
  owner_member_id: string;
  originating_campaign_id: string;
  bet_id: string;
  support_type: string;
  category_id: string;
  as_of: string;
}

export type PipelineSortKey =
  | 'name'
  | 'sponsor_name'
  | 'stage'
  | 'support_type'
  | 'proposed_value'
  | 'confirmed_value'
  | 'owner_member_id'
  | 'originating_campaign_id'
  | 'bet_id'
  | 'updated_at';

export interface PipelineSummaryState {
  metrics: Partial<Record<PipelineSummaryMetricId, MetricQueryResult>>;
  data_version?: string | number | null;
  error?: boolean;
}
