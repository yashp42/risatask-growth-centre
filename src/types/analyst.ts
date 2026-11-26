import type { MetricQueryResult } from './campaigns';
import type { NavSectionId } from './overview';
import type { CanonicalRole } from './sponsors';

export type AiRecordClass = 'simulated' | 'historical_synthetic' | 'live';

export type AiRouteType =
  | 'sql'
  | 'rag'
  | 'hybrid'
  | 'lookup'
  | 'action'
  | 'refuse';

export const ALLOWED_AI_ACTION_TYPES = [
  'create_task',
  'log_interaction',
  'log_meeting',
  'upsert_sponsor_contact',
  'create_sponsor',
  'update_sponsor',
  'change_owner',
  'create_contact',
  'update_contact',
  'create_campaign',
  'update_campaign',
  'log_outreach',
  'record_qualification',
  'create_opportunity',
  'update_opportunity',
  'change_stage',
  'confirm_deal',
  'update_task',
  'log_time',
  'create_network_partner',
  'record_referral',
] as const;

export type AllowedAiActionType = (typeof ALLOWED_AI_ACTION_TYPES)[number];

/**
 * Canonical AI_ACTION.status values (01_conceptual_data_model.md §4G) + cancel state
 */
export type AiActionStatus =
  | 'proposed'
  | 'confirmed'
  | 'executed'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export interface AiQuotaInfo {
  limit: number | null;
  remaining: number | null;
  used: number | null;
  is_free_tier?: boolean;
  exhausted?: boolean;
  reset_note?: string;
  checked_at?: string;
  unavailable?: boolean;
}

export interface AiViewWidgetSpec {
  id: string;
  kind: 'metric_by' | 'series' | 'table';
  title: string;
  metric_id?: string;
  group_by?: 'campaign' | 'channel_group' | 'bet';
  entity?: string;
  dates?: string[];
  rows?: Array<Record<string, unknown>>;
}

export interface AiViewSpec {
  screen: 'overview' | 'campaigns' | 'sponsors' | 'pipeline' | 'analytics';
  title?: string;
  edition_id: string;
  record_class: AiRecordClass;
  as_of: string;
  filters?: Record<string, string>;
  pinned_metrics?: Array<{
    metric_id: string;
    label: string;
    result: MetricQueryResult;
  }>;
  widgets?: AiViewWidgetSpec[];
}

export interface AiNumberReference {
  text: string;
  tool_call_id: string;
  metric_id?: string | null;
  value?: number | null;
  unit?: string | null;
}

export interface AiCitation {
  type: 'metric' | 'knowledge' | 'reference' | 'record' | string;
  id: string;
  title?: string | null;
  doc_id?: string | null;
  chunk_id?: string | null;
  chunk_text?: string | null;
  section?: string | null;
  source_id?: string | null;
  source_type?: string | null;
  evidence_class?: string | null;
  citation_location?: string | null;
  decision_id?: string | null;
  decision_status?: 'approved' | 'reference' | 'proposed' | 'superseded' | string | null;
  retrieval_rule?: string | null;
  effective_date?: string | null;
  version?: string | null;
  related_bet?: string | null;
  related_kpi?: string | null;
  record_class?: AiRecordClass | null;
  data_version?: string | number | null;
  definition_version?: string | number | null;
}

export type CanonicalAiToolName =
  | 'get_metric'
  | 'get_series'
  | 'get_scenario'
  | 'get_register'
  | 'get_reference'
  | 'search_knowledge'
  | 'list_records'
  | 'get_data_status'
  | 'propose_action'
  | 'propose_changes'
  | 'set_view';

export interface AiToolCallTrace {
  tool_call_id: string;
  tool_name: CanonicalAiToolName;
  status?: 'ok' | 'error' | 'denied' | string;
  record_class?: AiRecordClass | null;
  data_version?: string | number | null;
  summary?: string | null;
  metric_result?: MetricQueryResult | null;
}

export interface AiLinkedRecordSummary {
  entity_type: 'sponsor' | 'contact' | 'campaign' | 'opportunity' | 'task' | string;
  entity_id: string;
  label: string;
  subtitle?: string | null;
}

export interface AiActionRecord {
  ai_action_id: string;
  batch_id?: string | null;
  query_id?: string | null;
  action_type: AllowedAiActionType;
  permission_level: 'L4' | 'L5' | string;
  payload: Record<string, unknown>;
  payload_hash?: string | null;
  status: AiActionStatus;
  permission_allowed?: boolean;
  permission_reason?: string | null;
  affected_summary?: string | null;
  impacted_note?: string | null;
  before_snapshot?: Record<string, unknown> | null;
  after_snapshot?: Record<string, unknown> | null;
  linked_sponsor_id?: string | null;
  linked_contact_id?: string | null;
  linked_campaign_id?: string | null;
  linked_opportunity_id?: string | null;
  created_record_type?: string | null;
  created_record_id?: string | null;
  audit_event_id?: string | null;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
  executed_at?: string | null;
  error_message?: string | null;
}

export interface AiStructuredResponse {
  conversation_id: string;
  query_id?: string | null;
  route?: AiRouteType | null;
  answer: string;
  numbers_used: AiNumberReference[];
  citations: AiCitation[];
  data_labels: string[];
  action_ids: string[];
  actions?: AiActionRecord[];
  metric_results?: MetricQueryResult[];
  tool_calls?: AiToolCallTrace[];
  linked_records?: AiLinkedRecordSummary[];
  follow_up_suggestions?: string[];
  record_class?: AiRecordClass | null;
  edition_id?: string | null;
  as_of?: string | null;
  data_version?: string | number | null;
  data_refreshed?: boolean;
  answer_check_passed?: boolean;
  answer_check_status?: 'verified' | 'retried' | 'unverified' | string | null;
  cached?: boolean;
  shortcut?: boolean;
  quota?: AiQuotaInfo | null;
  view_spec?: AiViewSpec | null;
  model_id?: string | null;
  latency_ms?: number | null;
}

export interface AiChatRequest {
  conversation_id?: string | null;
  message: string;
  record_class: AiRecordClass;
  edition_id: string;
  as_of: string;
  filters?: Record<string, string | undefined>;
}

export interface AiChatMessage {
  message_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  structured?: AiStructuredResponse | null;
  feedback?: 'up' | 'down' | null;
  context_snapshot?: {
    record_class: AiRecordClass;
    edition_id: string;
    as_of: string;
  };
}

export interface AiConversationPayload {
  conversation_id: string;
  record_class?: AiRecordClass | null;
  edition_id?: string | null;
  data_version?: string | number | null;
  messages: AiChatMessage[];
}

export interface AiActionResolutionResponse {
  action: AiActionRecord;
  data_version?: string | number | null;
  audit_event_id?: string | null;
  message?: string | null;
}

export interface AiBatchResolutionResponse {
  batch_id: string;
  applied_count: number;
  data_version?: string | number | null;
  audit_ids: string[];
  actions: AiActionRecord[];
  message?: string | null;
}

export interface AiWorkspaceContext {
  section: NavSectionId;
  record_class: AiRecordClass;
  edition_id: string;
  as_of: string;
  entity_type?: 'campaign' | 'sponsor' | 'opportunity' | 'task' | null;
  entity_id?: string | null;
  filters?: Record<string, string>;
}

export interface AiPermissionProfile {
  canUseAnalyst: boolean;
  canConfirmTaskAction: boolean;
  canConfirmInteractionOrMeeting: boolean;
  canConfirmSponsorContactUpsert: boolean;
  canViewFinancialMetrics: boolean;
  canViewAdminAuditLogs: boolean;
  isViewerRestricted: boolean;
  verifiedByServer: boolean;
  roles: CanonicalRole[];
  currentMemberId: string | null;
}

export interface AiResponseIntegrityCheck {
  valid: boolean;
  unverifiedNumbers: boolean;
  missingDataLabels: boolean;
  warnings: string[];
}
