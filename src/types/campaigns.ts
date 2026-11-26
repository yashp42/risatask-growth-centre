export const CAMPAIGN_METRIC_IDS = [
  'M-23',
  'M-11',
  'M-13',
  'M-09',
  'M-02',
  'M-17',
] as const;

export const PORTFOLIO_SUMMARY_METRIC_IDS = ['M-21', 'M-02'] as const;

export type CampaignMetricId = (typeof CAMPAIGN_METRIC_IDS)[number];
export type PortfolioMetricId =
  | CampaignMetricId
  | (typeof PORTFOLIO_SUMMARY_METRIC_IDS)[number];

/**
 * Canonical CAMPAIGN.status enum (01_conceptual_data_model.md §4B)
 */
export type CampaignStatus = 'planned' | 'active' | 'stopped' | 'closed';

/**
 * Canonical CAMPAIGN.allowed_record_classes (01_conceptual_data_model.md §4B)
 */
export type CampaignRecordClass =
  | 'historical_synthetic'
  | 'simulated'
  | 'live';

/**
 * Canonical CHANNEL reference entry (01_conceptual_data_model.md §4B)
 */
export type ChannelGroup = 'warm' | 'inbound' | 'cold' | 'renewal' | 'premium';

export interface ChannelReference {
  channel_id: string;
  name: string;
  label: string;
  channel_group: ChannelGroup;
  is_active: boolean;
}

/**
 * Canonical BET reference entry (01_conceptual_data_model.md §4F, D-010)
 */
export type BetId = 'B1' | 'B2' | 'B3' | 'B4a' | 'B4b' | 'B5';

export interface BetReference {
  bet_id: BetId;
  name: string;
  rank: number;
}

/**
 * Canonical CAMPAIGN entity (00_READ_FIRST.md & 01_conceptual_data_model.md §4B)
 * Note: planned_person_weeks and planned_hours belong to STAFFING_ALLOCATION / TIME_LOG, not CAMPAIGN.
 */
export interface CampaignEntity {
  campaign_id: string;
  edition_id: string;
  name: string;
  channel_id: string;
  bet_id?: BetId | string | null;
  owner_member_id?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  objective?: string | null;
  status: CampaignStatus;
  // Provenance metadata
  record_class: CampaignRecordClass;
  // Optional display fields if joined by server read endpoint
  channel_name?: string | null;
  channel_group?: ChannelGroup | null;
  owner_name?: string | null;
  bet_name?: string | null;
  created_at?: string | null;
}

/**
 * Canonical POST /api/metrics/query result item (10_technical_architecture_handoff.md §2.2)
 */
export interface MetricQueryResult {
  metric_id: string;
  value: number | null;
  unit: string;
  numerator: number | null;
  denominator: number | null;
  computable: boolean;
  reason?: string | null;
  applied_filters?: Record<string, unknown>;
  series_key?: string | null;
  record_class: CampaignRecordClass;
  as_of?: string | null;
  data_version?: string | number | null;
  definition_version?: string | number | null;
}

export interface CampaignMetricDefinitionMeta {
  metric_id: CampaignMetricId | 'M-21';
  name: string;
  kpi_id: string | null;
  formula: string;
  numerator_label: string;
  denominator_label: string;
  unit: 'ratio' | 'opportunities' | '₹';
  inclusion_exclusion: string;
}

export interface CampaignPortfolioRow {
  campaign: CampaignEntity;
  metrics: Partial<Record<CampaignMetricId, MetricQueryResult>>;
  metrics_error?: boolean;
}

export interface CampaignPortfolioSummary {
  active_campaigns_count: number | null;
  open_pipeline_metric: MetricQueryResult | null; // M-21
  signed_value_metric: MetricQueryResult | null; // M-02 (includes in-kind; never cash)
  data_version?: string | number | null;
}

export interface CampaignPortfolioFilters {
  search: string;
  record_class: CampaignRecordClass;
  edition_id: string;
  channel_id: string;
  bet_id: string;
  owner_member_id: string;
  status: string;
  as_of: string;
}

export type CampaignPortfolioSortKey =
  | 'name'
  | 'channel_id'
  | 'bet_id'
  | 'owner_member_id'
  | 'status'
  | 'M-23'
  | 'M-11'
  | 'M-13'
  | 'M-09'
  | 'M-02'
  | 'M-17';

export interface CampaignWritePayload {
  edition_id: string;
  name: string;
  channel_id: string;
  bet_id?: string | null;
  owner_member_id?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  objective?: string | null;
  status: CampaignStatus;
  record_class: 'live' | 'simulated';
}

/**
 * Canonical OUTREACH_ATTEMPT & INTERACTION records (01_conceptual_data_model.md §4B)
 */
export interface OutreachAttemptRecord {
  attempt_id: string;
  campaign_id: string;
  sponsor_id: string;
  contact_id?: string | null;
  referral_id?: string | null;
  owner_member_id?: string | null;
  started_at: string;
  root_event_type: 'outreach_sent' | 'introduction_received' | 'web_inbound' | string;
  record_class?: CampaignRecordClass;
  // Optional server-joined display fields
  sponsor_name?: string | null;
  contact_name?: string | null;
  contact_role?: string | null;
  owner_name?: string | null;
}

export interface InteractionRecord {
  interaction_id: string;
  attempt_id: string;
  origin_interaction_id?: string | null;
  event_type: string;
  outcome?: string | null;
  occurred_at: string;
  summary?: string | null;
  logged_by?: string | null;
  record_class?: CampaignRecordClass;
  // Optional server-joined context from OUTREACH_ATTEMPT
  campaign_id?: string | null;
  sponsor_id?: string | null;
  sponsor_name?: string | null;
  contact_id?: string | null;
  contact_name?: string | null;
  contact_role?: string | null;
  logged_by_name?: string | null;
}

export interface CampaignSponsorAssociation {
  sponsor_key: string;
  sponsor_id?: string | null;
  sponsor_name: string;
  contacts: Array<{ name: string; role?: string | null }>;
  attempt_count: number;
  interaction_count: number;
  latest_activity_at: string | null;
}

/**
 * Canonical OPPORTUNITY + current OPPORTUNITY_STAGE_VERSION (01_conceptual_data_model.md §4B)
 */
export type OpportunitySupportType = 'cash' | 'in_kind' | 'mixed';
export type OpportunityStage =
  | 'prospecting'
  | 'contacted'
  | 'proposal_sent'
  | 'negotiating'
  | 'partner_confirmed'
  | 'lost'
  | 'withdrawn';

export interface CampaignOpportunityRecord {
  opportunity_id: string;
  sponsor_id: string;
  edition_id: string;
  primary_contact_id?: string | null;
  originating_campaign_id?: string | null;
  bet_id?: string | null;
  support_type: OpportunitySupportType;
  is_renewal?: boolean | null;
  recovered_lead?: boolean | null;
  name?: string | null;
  record_class?: CampaignRecordClass;
  // Joined current OPPORTUNITY_STAGE_VERSION & SPONSOR fields
  sponsor_name?: string | null;
  stage?: OpportunityStage | null;
  owner_member_id?: string | null;
  owner_name?: string | null;
  proposed_value?: number | null;
  confirmed_value?: number | null;
}

/**
 * Canonical TASK entity (01_conceptual_data_model.md §4E)
 */
export type CanonicalTaskType =
  | 'follow_up'
  | 'proposal'
  | 'invoice'
  | 'call'
  | 'pitch'
  | 'admin';

export type CanonicalTaskStatus =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'cancelled';

export interface CampaignTaskRecord {
  task_id: string;
  title: string;
  task_type: CanonicalTaskType;
  owner_member_id: string;
  due_at: string;
  status: CanonicalTaskStatus;
  linked_type?: 'sponsor' | 'opportunity' | 'invoice' | 'campaign' | 'referral' | null;
  linked_id?: string | null;
  bet_id?: string | null;
  origin: 'manual' | 'rule' | 'ai_confirmed';
  record_class?: CampaignRecordClass;
  owner_name?: string | null;
}

export interface CreateCampaignTaskPayload {
  title: string;
  task_type: CanonicalTaskType;
  owner_member_id: string;
  due_at: string;
  status: 'open';
  linked_type: 'campaign';
  linked_id: string;
  bet_id?: string | null;
  origin: 'manual';
}
