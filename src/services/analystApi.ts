import { apiFetch } from './authSession';
import {
  ALLOWED_AI_ACTION_TYPES,
  type AiActionRecord,
  type AiActionResolutionResponse,
  type AiActionStatus,
  type AiBatchResolutionResponse,
  type AiChatMessage,
  type AiChatRequest,
  type AiCitation,
  type AiConversationPayload,
  type AiLinkedRecordSummary,
  type AiNumberReference,
  type AiPermissionProfile,
  type AiQuotaInfo,
  type AiRecordClass,
  type AiResponseIntegrityCheck,
  type AiStructuredResponse,
  type AiToolCallTrace,
  type AiViewSpec,
  type AllowedAiActionType,
} from '../types/analyst';
import type { MetricQueryResult } from '../types/campaigns';
import type { FilterOption } from '../types/overview';
import type { CanonicalRole, UserPermissionContext } from '../types/sponsors';
import { formatAnalyticsMetricValue } from './analyticsApi';
import { OVERVIEW_API_ENDPOINTS } from './overviewApi';

export class AnalystApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = 'API_ERROR') {
    super(message);
    this.name = 'AnalystApiError';
    this.status = status;
    this.code = code;
  }
}

export const ANALYST_RECORD_CLASS_OPTIONS: FilterOption[] = [
  { value: 'simulated', label: 'Simulated (2026 demo)' },
  { value: 'historical_synthetic', label: 'Historical synthetic (2025, fictional)' },
  { value: 'live', label: 'Live' },
];

export const ANALYST_EDITION_BY_CLASS: Record<AiRecordClass, FilterOption[]> = {
  simulated: [{ value: 'ED-2026-DEMO', label: 'ED-2026-DEMO' }],
  historical_synthetic: [
    { value: 'ED-2025', label: 'ED-2025 (CampusFest 2025)' },
  ],
  live: [{ value: 'ED-2026-LIVE', label: 'ED-2026-LIVE' }],
};

export function getDefaultAnalystEditionForClass(
  recordClass: AiRecordClass
): string {
  return ANALYST_EDITION_BY_CLASS[recordClass][0].value;
}

export function formatRecordClassLabel(
  recordClass?: AiRecordClass | string | null
): string {
  switch (recordClass) {
    case 'simulated':
      return 'Simulated 2026 demo data';
    case 'historical_synthetic':
      return 'Synthetic 2025 data (read-only)';
    case 'live':
      return 'Live operational data';
    default:
      return recordClass ? String(recordClass) : 'Unspecified data class';
  }
}

export function isAllowedAiActionType(
  value: unknown
): value is AllowedAiActionType {
  return (
    typeof value === 'string' &&
    (ALLOWED_AI_ACTION_TYPES as ReadonlyArray<string>).includes(value)
  );
}

export function formatAiActionType(actionType: AllowedAiActionType | string): string {
  switch (actionType) {
    case 'create_task':
      return 'Create task';
    case 'update_task':
      return 'Update task';
    case 'log_interaction':
      return 'Log interaction';
    case 'log_meeting':
      return 'Log meeting';
    case 'upsert_sponsor_contact':
      return 'Create or update sponsor contact';
    case 'create_sponsor':
      return 'Create sponsor';
    case 'update_sponsor':
      return 'Update sponsor';
    case 'change_owner':
      return 'Change owner';
    case 'create_contact':
      return 'Create contact';
    case 'update_contact':
      return 'Update contact';
    case 'create_campaign':
      return 'Create campaign';
    case 'update_campaign':
      return 'Update campaign';
    case 'log_outreach':
      return 'Log outreach';
    case 'record_qualification':
      return 'Record qualification';
    case 'create_opportunity':
      return 'Create opportunity';
    case 'update_opportunity':
      return 'Update opportunity';
    case 'change_stage':
      return 'Change opportunity stage';
    case 'confirm_deal':
      return 'Confirm deal';
    case 'log_time':
      return 'Log hours';
    case 'create_network_partner':
      return 'Create network partner';
    case 'record_referral':
      return 'Record referral';
    default:
      return String(actionType).replace(/_/g, ' ');
  }
}

export function formatAiActionStatus(status: AiActionStatus | string): string {
  switch (status) {
    case 'proposed':
      return 'Proposed — awaiting human confirmation';
    case 'confirmed':
      return 'Confirmed';
    case 'executed':
      return 'Executed';
    case 'rejected':
      return 'Rejected';
    case 'expired':
      return 'Expired';
    case 'cancelled':
      return 'Cancelled';
    default:
      return String(status);
  }
}

export function formatAiRouteLabel(route?: string | null): string | null {
  switch (route) {
    case 'sql':
      return 'Structured metrics & records';
    case 'rag':
      return 'Knowledge & rationale retrieval';
    case 'hybrid':
      return 'Metrics + knowledge synthesis';
    case 'lookup':
      return 'Approved scenario / reference lookup';
    case 'action':
      return 'Proposed action (confirmation required)';
    case 'refuse':
      return 'Boundary refusal';
    default:
      return null;
  }
}

/**
 * Strips ASCII control chars (except newlines/tabs) from untrusted server or record text.
 * All UI output uses React text bindings (no raw HTML injection).
 */
export function sanitizeUntrustedText(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

const PROMPT_INJECTION_PATTERNS: ReadonlyArray<RegExp> = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /system\s+prompt/i,
  /reveal\s+(the\s+)?(api\s*key|secret|database_url|password|token)/i,
  /call\s+(record_receipt|create_invoice|confirm_opportunity|delete_record|run_readonly_sql)/i,
  /override\s+(permissions|role|d-009|d-010)/i,
  /bypass\s+(confirmation|approval|auth)/i,
];

export function containsPromptInjectionSignal(text: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some((re) => re.test(text));
}

const SENSITIVE_PII_FIELDS = new Set([
  'email',
  'phone',
  'mobile',
  'bank_reference',
  'gstin',
  'pan',
  'account_number',
  'ifsc',
  'password',
  'token',
  'secret',
]);

/**
 * Redacts restricted PII or bank fields if they ever appear unexpectedly in an action preview.
 */
export function redactSensitivePreviewFields(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_PII_FIELDS.has(key.toLowerCase())) {
      sanitized[key] = '[Restricted — verified server-side]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = redactSensitivePreviewFields(
        value as Record<string, unknown>
      );
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

const TASK_ALLOWED_ROLES: ReadonlyArray<CanonicalRole> = [
  'coordination_lead',
  'pipeline_ops',
  'partnerships',
  'community',
  'network',
  'premium_sales',
  'finance_collections',
];

const INTERACTION_ALLOWED_ROLES: ReadonlyArray<CanonicalRole> = [
  'coordination_lead',
  'pipeline_ops',
  'partnerships',
  'community',
  'network',
  'premium_sales',
];

const SPONSOR_CONTACT_ALLOWED_ROLES: ReadonlyArray<CanonicalRole> = [
  'coordination_lead',
  'pipeline_ops',
  'partnerships',
  'community',
  'network',
  'premium_sales',
];

const FINANCIAL_METRIC_ROLES: ReadonlyArray<CanonicalRole> = [
  'coordination_lead',
  'pipeline_ops',
  'partnerships',
  'community',
  'network',
  'premium_sales',
  'finance_collections',
];

/**
 * Maps GET /api/me roles strictly to 02_architecture_requirements.md §4.
 */
export function getAnalystPermissionProfile(
  permissions: UserPermissionContext
): AiPermissionProfile {
  if (!permissions.verified_by_server) {
    return {
      canUseAnalyst: true,
      canConfirmTaskAction: false,
      canConfirmInteractionOrMeeting: false,
      canConfirmSponsorContactUpsert: false,
      canViewFinancialMetrics: true,
      canViewAdminAuditLogs: false,
      isViewerRestricted: false,
      verifiedByServer: false,
      roles: permissions.roles,
      currentMemberId: permissions.member_id,
    };
  }

  const roles = permissions.roles;
  const hasAny = (allowed: ReadonlyArray<CanonicalRole>) =>
    allowed.some((r) => roles.includes(r));

  const isViewer = roles.includes('viewer');
  const hasBusinessRole = hasAny(FINANCIAL_METRIC_ROLES);

  if (!hasBusinessRole && !isViewer) {
    // e.g. standalone `admin` without a business role (OD-24)
    return {
      canUseAnalyst: false,
      canConfirmTaskAction: false,
      canConfirmInteractionOrMeeting: false,
      canConfirmSponsorContactUpsert: false,
      canViewFinancialMetrics: false,
      canViewAdminAuditLogs: roles.includes('admin'),
      isViewerRestricted: true,
      verifiedByServer: true,
      roles,
      currentMemberId: permissions.member_id,
    };
  }

  return {
    canUseAnalyst: true,
    canConfirmTaskAction: hasAny(TASK_ALLOWED_ROLES),
    canConfirmInteractionOrMeeting: hasAny(INTERACTION_ALLOWED_ROLES),
    canConfirmSponsorContactUpsert: hasAny(SPONSOR_CONTACT_ALLOWED_ROLES),
    canViewFinancialMetrics: hasBusinessRole,
    canViewAdminAuditLogs: roles.includes('coordination_lead'),
    isViewerRestricted: !hasBusinessRole && isViewer,
    verifiedByServer: true,
    roles,
    currentMemberId: permissions.member_id,
  };
}

export function canUserConfirmActionType(
  profile: AiPermissionProfile,
  action: AiActionRecord
): { allowed: boolean; reason?: string } {
  if (action.permission_allowed === false) {
    return {
      allowed: false,
      reason:
        action.permission_reason ||
        'Your assigned role is not permitted to confirm this action.',
    };
  }
  if (!profile.verifiedByServer) {
    return {
      allowed: true,
      reason: 'Final permission check is enforced by the server on confirm.',
    };
  }
  if (!profile.canUseAnalyst) {
    return {
      allowed: false,
      reason: 'Your assigned role does not include sponsorship operations.',
    };
  }
  switch (action.action_type) {
    case 'create_task':
    case 'update_task':
    case 'log_time':
      return profile.canConfirmTaskAction
        ? { allowed: true }
        : {
            allowed: false,
            reason: 'Viewer accounts cannot create or update execution records.',
          };
    case 'confirm_deal':
      return profile.roles.includes('coordination_lead')
        ? { allowed: true }
        : {
            allowed: false,
            reason: 'Confirming deals requires the coordination lead role.',
          };
    case 'create_campaign':
    case 'update_campaign':
      return profile.roles.includes('coordination_lead') ||
        profile.roles.includes('pipeline_ops')
        ? { allowed: true }
        : {
            allowed: false,
            reason: 'Managing campaigns requires coordination lead or pipeline ops.',
          };
    case 'log_interaction':
    case 'log_meeting':
    case 'log_outreach':
    case 'record_qualification':
    case 'create_opportunity':
    case 'update_opportunity':
    case 'change_stage':
    case 'create_network_partner':
    case 'record_referral':
      return profile.canConfirmInteractionOrMeeting
        ? { allowed: true }
        : {
            allowed: false,
            reason:
              'This change requires a sales, pipeline ops, or coordination lead role.',
          };
    case 'upsert_sponsor_contact':
    case 'create_sponsor':
    case 'update_sponsor':
    case 'change_owner':
    case 'create_contact':
    case 'update_contact':
      return profile.canConfirmSponsorContactUpsert
        ? { allowed: true }
        : {
            allowed: false,
            reason:
              'Updating sponsor records requires a sales, pipeline ops, or coordination lead role.',
          };
    default:
      return profile.canConfirmInteractionOrMeeting
        ? { allowed: true }
        : {
            allowed: false,
            reason: 'Your role cannot confirm this operational change.',
          };
  }
}

export function verifyAnalystResponseIntegrity(
  response: AiStructuredResponse
): AiResponseIntegrityCheck {
  const warnings: string[] = [];
  const toolCallIds = new Set(
    (response.tool_calls ?? []).map((tc) => tc.tool_call_id).filter(Boolean)
  );

  let unverifiedNumbers = response.answer_check_status === 'unverified';

  if (
    toolCallIds.size > 0 &&
    response.numbers_used.some(
      (num) => !num.tool_call_id || !toolCallIds.has(num.tool_call_id)
    )
  ) {
    unverifiedNumbers = true;
    warnings.push(
      'One or more numeric references did not map to a returned tool call in this turn.'
    );
  }

  const hasNumericEvidence =
    response.numbers_used.length > 0 ||
    (response.metric_results?.length ?? 0) > 0;
  const missingDataLabels =
    hasNumericEvidence && response.data_labels.length === 0;

  if (missingDataLabels) {
    warnings.push(
      'Numeric response is missing an explicit data provenance label.'
    );
  }

  if (response.answer_check_status === 'unverified') {
    warnings.push(
      'The server answer check flagged that a requested figure could not be verified.'
    );
  }

  return {
    valid: !unverifiedNumbers && !missingDataLabels,
    unverifiedNumbers,
    missingDataLabels,
    warnings,
  };
}

function normalizeActionRecord(raw: Record<string, unknown>): AiActionRecord | null {
  const actionType = raw.action_type ?? raw.type;
  if (!isAllowedAiActionType(actionType)) {
    return null;
  }

  const rawPayload =
    raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload)
      ? (raw.payload as Record<string, unknown>)
      : {};

  return {
    ai_action_id: String(raw.ai_action_id ?? raw.id ?? ''),
    batch_id:
      (raw.batch_id as string | null | undefined) ??
      (rawPayload.batch_id as string | null | undefined) ??
      null,
    query_id: (raw.query_id as string | null | undefined) ?? null,
    action_type: actionType,
    permission_level: String(raw.permission_level ?? 'L5'),
    payload: redactSensitivePreviewFields(rawPayload),
    payload_hash:
      (raw.payload_hash as string | null | undefined) ??
      (raw.payload_sha256 as string | null | undefined) ??
      null,
    status: (raw.status as AiActionStatus) ?? 'proposed',
    permission_allowed:
      typeof raw.permission_allowed === 'boolean'
        ? raw.permission_allowed
        : undefined,
    permission_reason:
      (raw.permission_reason as string | null | undefined) ?? null,
    affected_summary:
      (raw.affected_summary as string | null | undefined) ??
      (rawPayload.affected_summary as string | null | undefined) ??
      null,
    impacted_note:
      (raw.impacted_note as string | null | undefined) ??
      (rawPayload.impacted_note as string | null | undefined) ??
      null,
    before_snapshot:
      (raw.before_snapshot as Record<string, unknown> | null | undefined) ??
      (rawPayload.before as Record<string, unknown> | null | undefined) ??
      null,
    after_snapshot:
      (raw.after_snapshot as Record<string, unknown> | null | undefined) ??
      (rawPayload.after as Record<string, unknown> | null | undefined) ??
      null,
    linked_sponsor_id:
      (raw.linked_sponsor_id as string | null | undefined) ??
      (rawPayload.sponsor_id as string | null | undefined) ??
      null,
    linked_contact_id:
      (raw.linked_contact_id as string | null | undefined) ??
      (rawPayload.contact_id as string | null | undefined) ??
      null,
    linked_campaign_id:
      (raw.linked_campaign_id as string | null | undefined) ??
      (rawPayload.campaign_id as string | null | undefined) ??
      null,
    linked_opportunity_id:
      (raw.linked_opportunity_id as string | null | undefined) ??
      (rawPayload.opportunity_id as string | null | undefined) ??
      null,
    created_record_type:
      (raw.created_record_type as string | null | undefined) ?? null,
    created_record_id:
      (raw.created_record_id as string | null | undefined) ?? null,
    audit_event_id: (raw.audit_event_id as string | null | undefined) ?? null,
    confirmed_by: (raw.confirmed_by as string | null | undefined) ?? null,
    confirmed_at: (raw.confirmed_at as string | null | undefined) ?? null,
    executed_at: (raw.executed_at as string | null | undefined) ?? null,
    error_message: (raw.error_message as string | null | undefined) ?? null,
  };
}

function normalizeStructuredResponse(
  raw: Record<string, unknown>
): AiStructuredResponse {
  const rawNumbers = Array.isArray(raw.numbers_used) ? raw.numbers_used : [];
  const numbers_used: AiNumberReference[] = rawNumbers.map((item) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      text: sanitizeUntrustedText(obj.text),
      tool_call_id: String(obj.tool_call_id ?? ''),
      metric_id: (obj.metric_id as string | null | undefined) ?? null,
      value:
        obj.value !== undefined && obj.value !== null ? Number(obj.value) : null,
      unit: (obj.unit as string | null | undefined) ?? null,
    };
  });

  const rawCitations = Array.isArray(raw.citations) ? raw.citations : [];
  const citations: AiCitation[] = rawCitations.map((item) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      type: String(obj.type ?? 'knowledge'),
      id: String(obj.id ?? obj.chunk_id ?? obj.metric_id ?? ''),
      title: obj.title ? sanitizeUntrustedText(obj.title) : null,
      doc_id: (obj.doc_id as string | null | undefined) ?? null,
      chunk_id: (obj.chunk_id as string | null | undefined) ?? null,
      chunk_text:
        obj.chunk_text || obj.text
          ? sanitizeUntrustedText(obj.chunk_text ?? obj.text)
          : null,
      section: obj.section ? sanitizeUntrustedText(obj.section) : null,
      source_id: (obj.source_id as string | null | undefined) ?? null,
      source_type: (obj.source_type as string | null | undefined) ?? null,
      evidence_class: (obj.evidence_class as string | null | undefined) ?? null,
      citation_location: obj.citation_location
        ? sanitizeUntrustedText(obj.citation_location)
        : null,
      decision_id: (obj.decision_id as string | null | undefined) ?? null,
      decision_status: (obj.decision_status as string | null | undefined) ?? null,
      retrieval_rule: (obj.retrieval_rule as string | null | undefined) ?? null,
      effective_date: (obj.effective_date as string | null | undefined) ?? null,
      version: (obj.version as string | null | undefined) ?? null,
      related_bet: (obj.related_bet as string | null | undefined) ?? null,
      related_kpi: (obj.related_kpi as string | null | undefined) ?? null,
      record_class: (obj.record_class as AiRecordClass | null | undefined) ?? null,
      data_version:
        (obj.data_version as string | number | null | undefined) ?? null,
      definition_version:
        (obj.definition_version as string | number | null | undefined) ?? null,
    };
  });

  const rawActions = Array.isArray(raw.actions) ? raw.actions : [];
  const actions: AiActionRecord[] = rawActions
    .map((item) => normalizeActionRecord((item ?? {}) as Record<string, unknown>))
    .filter((item): item is AiActionRecord => item !== null && Boolean(item.ai_action_id));

  const rawToolCalls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
  const tool_calls: AiToolCallTrace[] = rawToolCalls.map((item) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      tool_call_id: String(obj.tool_call_id ?? ''),
      tool_name: obj.tool_name as AiToolCallTrace['tool_name'],
      status: (obj.status as string | undefined) ?? 'ok',
      record_class: (obj.record_class as AiRecordClass | null | undefined) ?? null,
      data_version:
        (obj.data_version as string | number | null | undefined) ?? null,
      summary: obj.summary ? sanitizeUntrustedText(obj.summary) : null,
      metric_result:
        (obj.metric_result as MetricQueryResult | null | undefined) ?? null,
    };
  });

  const rawLinked = Array.isArray(raw.linked_records) ? raw.linked_records : [];
  const linked_records: AiLinkedRecordSummary[] = rawLinked.map((item) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      entity_type: String(obj.entity_type ?? 'record'),
      entity_id: String(obj.entity_id ?? ''),
      label: sanitizeUntrustedText(obj.label ?? obj.entity_id ?? ''),
      subtitle: obj.subtitle ? sanitizeUntrustedText(obj.subtitle) : null,
    };
  });

  const metricResultsFromRaw = Array.isArray(raw.metric_results)
    ? (raw.metric_results as MetricQueryResult[])
    : tool_calls
        .map((tc) => tc.metric_result)
        .filter((m): m is MetricQueryResult => Boolean(m));

  return {
    conversation_id: String(raw.conversation_id ?? ''),
    query_id: (raw.query_id as string | null | undefined) ?? null,
    route: (raw.route as AiStructuredResponse['route']) ?? null,
    answer: sanitizeUntrustedText(raw.answer),
    numbers_used,
    citations,
    data_labels: Array.isArray(raw.data_labels)
      ? raw.data_labels.map((l) => sanitizeUntrustedText(l)).filter(Boolean)
      : [],
    action_ids: Array.isArray(raw.action_ids)
      ? raw.action_ids.map((id) => String(id))
      : actions.map((a) => a.ai_action_id),
    actions,
    metric_results: metricResultsFromRaw,
    tool_calls,
    linked_records,
    follow_up_suggestions: Array.isArray(raw.follow_up_suggestions)
      ? raw.follow_up_suggestions
          .map((q) => sanitizeUntrustedText(q))
          .filter(Boolean)
      : [],
    record_class: (raw.record_class as AiRecordClass | null | undefined) ?? null,
    edition_id: (raw.edition_id as string | null | undefined) ?? null,
    as_of: (raw.as_of as string | null | undefined) ?? null,
    data_version:
      (raw.data_version as string | number | null | undefined) ?? null,
    data_refreshed: Boolean(raw.data_refreshed),
    answer_check_passed:
      typeof raw.answer_check_passed === 'boolean'
        ? raw.answer_check_passed
        : undefined,
    answer_check_status:
      (raw.answer_check_status as string | null | undefined) ?? null,
    cached: Boolean(raw.cached),
    shortcut: Boolean(raw.shortcut),
    quota: (raw.quota as AiQuotaInfo | null | undefined) ?? null,
    view_spec: (raw.view_spec as AiViewSpec | null | undefined) ?? null,
    model_id: (raw.model_id as string | null | undefined) ?? null,
    latency_ms:
      typeof raw.latency_ms === 'number' ? raw.latency_ms : null,
  };
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
    let message = 'Growth Analyst service is currently unavailable.';
    let code = `HTTP_${response.status}`;

    if (isJson) {
      try {
        const body = (await response.json()) as {
          message?: string;
          error?: string;
          code?: string;
        };
        if (body.message) message = sanitizeUntrustedText(body.message);
        else if (body.error) message = sanitizeUntrustedText(body.error);
        if (body.code) code = String(body.code);
      } catch {
        // Ignore parse error
      }
    } else if (response.status === 401) {
      message = 'Authentication is required to use Growth Analyst.';
    } else if (response.status === 403) {
      message = 'Your assigned role is not permitted to perform this action.';
    } else if (response.status === 404) {
      message =
        'Growth Analyst AI service is not connected in this environment.';
      code = 'SERVICE_UNAVAILABLE';
    }

    throw new AnalystApiError(message, response.status, code);
  }

  if (!isJson) {
    throw new AnalystApiError(
      'Growth Analyst AI service is not connected in this environment.',
      503,
      'SERVICE_UNAVAILABLE'
    );
  }

  return (await response.json()) as T;
}

export async function sendAnalystChatMessage(
  request: AiChatRequest,
  signal?: AbortSignal
): Promise<AiStructuredResponse> {
  const trimmed = request.message.trim();
  const payload = {
    conversation_id: request.conversation_id || undefined,
    question: trimmed,
    message: trimmed,
    record_class: request.record_class,
    edition_id: request.edition_id,
    as_of: request.as_of,
    filters: request.filters,
  };

  const raw = await requestJson<Record<string, unknown>>(
    OVERVIEW_API_ENDPOINTS.aiAsk,
    {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    }
  );

  return normalizeStructuredResponse(raw);
}

export async function fetchAiQuota(
  signal?: AbortSignal
): Promise<AiQuotaInfo | null> {
  try {
    return await requestJson<AiQuotaInfo>(OVERVIEW_API_ENDPOINTS.aiQuota, {
      signal,
    });
  } catch {
    return null;
  }
}

export async function submitAiFeedback(
  queryId: string,
  rating: 'up' | 'down',
  comment?: string,
  signal?: AbortSignal
): Promise<{ query_id: string; rating: 'up' | 'down' }> {
  return requestJson<{ query_id: string; rating: 'up' | 'down' }>(
    OVERVIEW_API_ENDPOINTS.aiFeedback,
    {
      method: 'POST',
      body: JSON.stringify({
        query_id: queryId,
        rating,
        comment: comment?.trim() || undefined,
      }),
      signal,
    }
  );
}

const METRIC_SHORTCUT_MAP: ReadonlyArray<{
  patterns: ReadonlyArray<RegExp>;
  metricId: string;
  label: string;
}> = [
  {
    patterns: [
      /^what(?:'s| is)?(?: our| the)? cash collected(?: before fest)?\??$/i,
      /^cash collected(?: before fest)?\??$/i,
      /^m-?01\??$/i,
    ],
    metricId: 'M-01',
    label: 'Cash collected before fest (M-01)',
  },
  {
    patterns: [
      /^what(?:'s| is)?(?: our| the)? signed(?: sponsorship)? value\??$/i,
      /^signed(?: sponsorship)? value\??$/i,
      /^m-?02\??$/i,
    ],
    metricId: 'M-02',
    label: 'Signed sponsorship value (M-02)',
  },
  {
    patterns: [
      /^what(?:'s| is)?(?: our| the)? signed cash(?: value)?\??$/i,
      /^signed cash(?: value)?\??$/i,
      /^m-?03\??$/i,
    ],
    metricId: 'M-03',
    label: 'Signed cash value (M-03)',
  },
  {
    patterns: [
      /^what(?:'s| is)?(?: our| the)? in-?kind value\??$/i,
      /^in-?kind value\??$/i,
      /^m-?04\??$/i,
    ],
    metricId: 'M-04',
    label: 'In-kind value (M-04)',
  },
  {
    patterns: [
      /^what(?:'s| is)?(?: our| the)? collection rate\??$/i,
      /^collection rate\??$/i,
      /^m-?06\??$/i,
    ],
    metricId: 'M-06',
    label: 'Collection rate (M-06)',
  },
  {
    patterns: [
      /^what(?:'s| is)?(?: our| the)? outstanding cash\??$/i,
      /^outstanding cash\??$/i,
      /^m-?07\??$/i,
    ],
    metricId: 'M-07',
    label: 'Outstanding cash (M-07)',
  },
  {
    patterns: [
      /^what(?:'s| is)?(?: our| the)? open pipeline(?: value)?\??$/i,
      /^open pipeline(?: value)?\??$/i,
      /^m-?21\??$/i,
    ],
    metricId: 'M-21',
    label: 'Open pipeline value (M-21)',
  },
];

export async function tryResolveMetricShortcut(
  request: AiChatRequest,
  signal?: AbortSignal
): Promise<AiStructuredResponse | null> {
  const normalized = request.message.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0 || normalized.length > 64) return null;

  const matched = METRIC_SHORTCUT_MAP.find((entry) =>
    entry.patterns.some((re) => re.test(normalized))
  );
  if (!matched) return null;

  const res = await requestJson<{ results?: MetricQueryResult[] }>(
    OVERVIEW_API_ENDPOINTS.metricsQuery,
    {
      method: 'POST',
      signal,
      body: JSON.stringify({
        metricIds: [matched.metricId],
        editionId: request.edition_id,
        recordClass: request.record_class,
        asOf: request.as_of,
        filters: request.filters ?? {},
      }),
    }
  );

  const row = res.results?.[0];
  if (!row) return null;

  const formattedVal = row.computable
    ? formatAnalyticsMetricValue(row)
    : `Not computable — ${row.reason || 'Underlying data is unavailable for this scope.'}`;

  const answer = row.computable
    ? `${matched.label} is ${formattedVal} (${request.edition_id}, as of ${row.as_of || request.as_of}) [${row.metric_id}].`
    : `${matched.label} is not computable: ${row.reason || 'Underlying data is unavailable for this scope.'} [${row.metric_id}].`;

  return {
    conversation_id: request.conversation_id || `shortcut-${Date.now()}`,
    query_id: null,
    route: 'sql',
    answer,
    numbers_used: [],
    citations: [
      {
        type: 'metric',
        id: row.metric_id,
        title: matched.label,
        record_class: row.record_class,
        data_version: row.data_version ?? null,
        definition_version: row.definition_version ?? null,
      },
    ],
    data_labels: [
      `${request.edition_id} · ${row.record_class}`,
      `As of ${row.as_of || request.as_of}`,
      ...(row.data_version !== undefined && row.data_version !== null
        ? [`Data v${String(row.data_version)}`]
        : []),
    ],
    action_ids: [],
    actions: [],
    metric_results: [row],
    tool_calls: [
      {
        tool_call_id: `shortcut-${matched.metricId}`,
        tool_name: 'get_metric',
        status: 'ok',
        record_class: row.record_class,
        data_version: row.data_version ?? null,
        summary: `${matched.metricId} (metric card shortcut · 0 AI calls)`,
        metric_result: row,
      },
    ],
    record_class: row.record_class,
    edition_id: request.edition_id,
    as_of: row.as_of || request.as_of,
    data_version: row.data_version ?? null,
    answer_check_passed: true,
    answer_check_status: 'verified',
    shortcut: true,
    cached: false,
  };
}

export async function confirmAiActionBatch(
  batchId: string,
  signal?: AbortSignal
): Promise<AiBatchResolutionResponse> {
  const raw = await requestJson<Record<string, unknown>>(
    OVERVIEW_API_ENDPOINTS.aiBatchConfirm(batchId),
    {
      method: 'POST',
      body: JSON.stringify({}),
      signal,
    }
  );
  const rawActions = Array.isArray(raw.actions) ? raw.actions : [];
  const actions = rawActions
    .map((a) => normalizeActionRecord((a ?? {}) as Record<string, unknown>))
    .filter((a): a is AiActionRecord => a !== null);
  return {
    batch_id: String(raw.batch_id ?? batchId),
    applied_count: Number(raw.applied_count ?? actions.length ?? 0),
    data_version:
      (raw.data_version as string | number | null | undefined) ?? null,
    audit_ids: Array.isArray(raw.audit_ids)
      ? raw.audit_ids.map((id) => String(id))
      : [],
    actions,
    message: raw.message ? sanitizeUntrustedText(raw.message) : null,
  };
}

export async function cancelAiActionBatch(
  batchId: string,
  signal?: AbortSignal
): Promise<{ batch_id: string; actions: AiActionRecord[]; message?: string | null }> {
  const raw = await requestJson<Record<string, unknown>>(
    OVERVIEW_API_ENDPOINTS.aiBatchCancel(batchId),
    {
      method: 'POST',
      body: JSON.stringify({}),
      signal,
    }
  );
  const rawActions = Array.isArray(raw.actions) ? raw.actions : [];
  const actions = rawActions
    .map((a) => normalizeActionRecord((a ?? {}) as Record<string, unknown>))
    .filter((a): a is AiActionRecord => a !== null);
  return {
    batch_id: String(raw.batch_id ?? batchId),
    actions,
    message: raw.message ? sanitizeUntrustedText(raw.message) : null,
  };
}

export async function fetchAnalystConversation(
  conversationId: string,
  signal?: AbortSignal
): Promise<AiConversationPayload> {
  const raw = await requestJson<Record<string, unknown>>(
    OVERVIEW_API_ENDPOINTS.aiConversation(conversationId),
    { signal }
  );

  const rawMessages = Array.isArray(raw.messages) ? raw.messages : [];
  const messages: AiChatMessage[] = rawMessages.map((item, idx) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const role = obj.role === 'user' ? 'user' : 'assistant';
    const structuredRaw =
      obj.structured && typeof obj.structured === 'object'
        ? normalizeStructuredResponse(obj.structured as Record<string, unknown>)
        : role === 'assistant' &&
            (obj.answer !== undefined || Array.isArray(obj.citations))
          ? normalizeStructuredResponse(obj)
          : null;

    return {
      message_id: String(obj.message_id ?? obj.id ?? `msg-${idx}`),
      role,
      content: sanitizeUntrustedText(obj.content ?? obj.answer ?? ''),
      created_at: String(obj.created_at ?? new Date().toISOString()),
      structured: structuredRaw,
    };
  });

  return {
    conversation_id: String(raw.conversation_id ?? conversationId),
    record_class: (raw.record_class as AiRecordClass | null | undefined) ?? null,
    edition_id: (raw.edition_id as string | null | undefined) ?? null,
    data_version:
      (raw.data_version as string | number | null | undefined) ?? null,
    messages,
  };
}

export async function confirmAiAction(
  actionId: string,
  payloadHash?: string | null,
  signal?: AbortSignal
): Promise<AiActionResolutionResponse> {
  const raw = await requestJson<Record<string, unknown>>(
    OVERVIEW_API_ENDPOINTS.aiActionConfirm(actionId),
    {
      method: 'POST',
      body: JSON.stringify(
        payloadHash ? { payload_hash: payloadHash } : {}
      ),
      signal,
    }
  );

  const rawAction =
    (raw.action as Record<string, unknown> | undefined) ?? raw;
  const normalized = normalizeActionRecord(rawAction);
  if (!normalized) {
    throw new AnalystApiError(
      'Server returned an unsupported action record.',
      422,
      'INVALID_ACTION_TYPE'
    );
  }

  return {
    action: normalized,
    data_version:
      (raw.data_version as string | number | null | undefined) ?? null,
    audit_event_id:
      (raw.audit_event_id as string | null | undefined) ??
      normalized.audit_event_id ??
      null,
    message: raw.message ? sanitizeUntrustedText(raw.message) : null,
  };
}

export async function cancelAiAction(
  actionId: string,
  signal?: AbortSignal
): Promise<AiActionResolutionResponse> {
  const raw = await requestJson<Record<string, unknown>>(
    OVERVIEW_API_ENDPOINTS.aiActionCancel(actionId),
    {
      method: 'POST',
      body: JSON.stringify({}),
      signal,
    }
  );

  const rawAction =
    (raw.action as Record<string, unknown> | undefined) ?? raw;
  const normalized = normalizeActionRecord(rawAction);
  if (!normalized) {
    throw new AnalystApiError(
      'Server returned an unsupported action record.',
      422,
      'INVALID_ACTION_TYPE'
    );
  }

  return {
    action: normalized,
    data_version:
      (raw.data_version as string | number | null | undefined) ?? null,
    audit_event_id:
      (raw.audit_event_id as string | null | undefined) ?? null,
    message: raw.message ? sanitizeUntrustedText(raw.message) : null,
  };
}

export function formatAnalystMetricDisplay(result: MetricQueryResult): string {
  return formatAnalyticsMetricValue(result);
}
