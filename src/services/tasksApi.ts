import { apiFetch } from './authSession';
import type { FilterOption } from '../types/overview';
import type { CanonicalRole, UserPermissionContext } from '../types/sponsors';
import {
  ALL_TASK_LINKED_TYPES,
  ALL_TASK_ORIGINS,
  ALL_TASK_STATUSES,
  ALL_TASK_TYPES,
  type AuditEventRecord,
  type KnownTeamMember,
  type LinkedRecordCatalog,
  type LinkedRecordOption,
  type TaskCreatePayload,
  type TaskDependencyRecord,
  type TaskFilters,
  type TaskLinkedType,
  type TaskOrigin,
  type TaskPermissionProfile,
  type TaskRecord,
  type TaskRecordClass,
  type TaskStatus,
  type TaskType,
  type TaskUpdatePayload,
} from '../types/tasks';
import { OVERVIEW_API_ENDPOINTS } from './overviewApi';

export class TaskApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = 'API_ERROR') {
    super(message);
    this.name = 'TaskApiError';
    this.status = status;
    this.code = code;
  }
}

export const TASK_RECORD_CLASS_OPTIONS: FilterOption[] = [
  { value: 'simulated', label: 'Simulated (2026 demo)' },
  { value: 'historical_synthetic', label: 'Historical synthetic (2025, read-only)' },
  { value: 'live', label: 'Live' },
];

export const TASK_EDITION_BY_CLASS: Record<TaskRecordClass, FilterOption[]> = {
  simulated: [{ value: 'ED-2026-DEMO', label: 'ED-2026-DEMO' }],
  historical_synthetic: [{ value: 'ED-2025', label: 'ED-2025 (CampusFest 2025)' }],
  live: [{ value: 'ED-2026-LIVE', label: 'ED-2026-LIVE' }],
};

export function getDefaultTaskEditionForClass(
  recordClass: TaskRecordClass
): string {
  return TASK_EDITION_BY_CLASS[recordClass][0].value;
}

export function formatTaskStatus(status: TaskStatus | string): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'in_progress':
      return 'In progress';
    case 'blocked':
      return 'Blocked';
    case 'done':
      return 'Done';
    case 'cancelled':
      return 'Cancelled';
    default:
      return String(status).replace(/_/g, ' ');
  }
}

export function formatTaskType(taskType: TaskType | string): string {
  switch (taskType) {
    case 'follow_up':
      return 'Follow-up';
    case 'proposal':
      return 'Proposal';
    case 'invoice':
      return 'Invoice';
    case 'call':
      return 'Call';
    case 'pitch':
      return 'Pitch';
    case 'admin':
      return 'Admin';
    default:
      return String(taskType).replace(/_/g, ' ');
  }
}

export function formatTaskLinkedType(
  linkedType?: TaskLinkedType | string | null
): string {
  if (!linkedType) return 'Unlinked';
  switch (linkedType) {
    case 'sponsor':
      return 'Sponsor';
    case 'opportunity':
      return 'Opportunity';
    case 'invoice':
      return 'Invoice';
    case 'campaign':
      return 'Campaign';
    case 'referral':
      return 'Referral';
    default:
      return String(linkedType).replace(/_/g, ' ');
  }
}

export function formatTaskOrigin(origin: TaskOrigin | string): string {
  switch (origin) {
    case 'manual':
      return 'Manual';
    case 'rule':
      return 'Rule';
    case 'ai_confirmed':
      return 'AI confirmed';
    default:
      return String(origin).replace(/_/g, ' ');
  }
}

export const TASK_STATUS_FILTER_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All statuses' },
  ...ALL_TASK_STATUSES.map((s) => ({
    value: s,
    label: formatTaskStatus(s),
  })),
];

export const TASK_TYPE_FILTER_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All types' },
  ...ALL_TASK_TYPES.map((t) => ({
    value: t,
    label: formatTaskType(t),
  })),
];

export const TASK_LINKED_TYPE_FILTER_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All linked records' },
  ...ALL_TASK_LINKED_TYPES.map((lt) => ({
    value: lt,
    label: formatTaskLinkedType(lt),
  })),
];

export const TASK_ORIGIN_FILTER_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All origins' },
  ...ALL_TASK_ORIGINS.map((orig) => ({
    value: orig,
    label: formatTaskOrigin(orig),
  })),
];

/**
 * Canonical overdue rule from 01_conceptual_data_model.md §4E:
 * "Overdue = due_at < now and status not done"
 * Does not silently exclude `cancelled`; instead flags any cancelled task
 * matching `due_at < now` so the anomaly is transparent for review.
 */
export function evaluateTaskOverdue(
  task: Pick<TaskRecord, 'due_at' | 'status'>,
  nowMs: number = Date.now()
): { isOverdue: boolean; isCancelledAnomaly: boolean } {
  const dueMs = Date.parse(task.due_at);
  if (Number.isNaN(dueMs)) {
    return { isOverdue: false, isCancelledAnomaly: false };
  }
  const isOverdue = dueMs < nowMs && task.status !== 'done';
  return {
    isOverdue,
    isCancelledAnomaly: isOverdue && task.status === 'cancelled',
  };
}

export function isTaskDueSoon(
  task: Pick<TaskRecord, 'due_at' | 'status'>,
  nowMs: number = Date.now(),
  horizonDays = 7
): boolean {
  if (task.status === 'done' || task.status === 'cancelled') return false;
  const dueMs = Date.parse(task.due_at);
  if (Number.isNaN(dueMs)) return false;
  const horizonMs = nowMs + horizonDays * 24 * 60 * 60 * 1000;
  return dueMs >= nowMs && dueMs <= horizonMs;
}

export function formatTaskDueDisplay(dueAt?: string | null): string {
  if (!dueAt) return '—';
  const parsed = new Date(dueAt);
  if (Number.isNaN(parsed.getTime())) return dueAt;
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(parsed);
  } catch {
    return dueAt.slice(0, 16).replace('T', ' ');
  }
}

export function toDateAndTimeInputs(isoString?: string | null): {
  date: string;
  time: string;
} {
  if (!isoString) {
    return { date: '', time: '18:00' };
  }
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) {
    return { date: '', time: '18:00' };
  }
  // Convert into local YYYY-MM-DD and HH:mm for <input type="date"> / <input type="time">
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { date, time };
}

/**
 * Task permission mapping strictly aligned to 02_architecture_requirements.md §4:
 * - coordination_lead: CRUA (all tasks) + Audit log R
 * - pipeline_ops: CRU (all tasks)
 * - partnerships / community / network / premium_sales / finance_collections: CRU (own tasks)
 * - viewer: R (read-only)
 * - admin: separate from business roles (no implicit task access)
 */
const ALL_TASKS_WRITE_ROLES: ReadonlyArray<CanonicalRole> = [
  'coordination_lead',
  'pipeline_ops',
];

const OWN_TASKS_WRITE_ROLES: ReadonlyArray<CanonicalRole> = [
  'partnerships',
  'community',
  'network',
  'premium_sales',
  'finance_collections',
];

const READ_TASKS_ROLES: ReadonlyArray<CanonicalRole> = [
  ...ALL_TASKS_WRITE_ROLES,
  ...OWN_TASKS_WRITE_ROLES,
  'viewer',
];

export function getTaskPermissionProfile(
  permissions: UserPermissionContext
): TaskPermissionProfile {
  if (!permissions.verified_by_server) {
    return {
      canRead: true,
      canCreate: true,
      writeScope: 'all',
      canApprove: true,
      canReassignOwner: true,
      canViewAudit: true,
      verifiedByServer: false,
      currentMemberId: permissions.member_id,
    };
  }

  const roles = permissions.roles;
  const hasAny = (list: ReadonlyArray<CanonicalRole>) =>
    list.some((r) => roles.includes(r));

  const canWriteAll = hasAny(ALL_TASKS_WRITE_ROLES);
  const canWriteOwn = hasAny(OWN_TASKS_WRITE_ROLES);
  const writeScope: TaskPermissionProfile['writeScope'] = canWriteAll
    ? 'all'
    : canWriteOwn
      ? 'own'
      : 'none';

  return {
    canRead: hasAny(READ_TASKS_ROLES),
    canCreate: writeScope !== 'none',
    writeScope,
    canApprove: roles.includes('coordination_lead'),
    canReassignOwner: canWriteAll,
    canViewAudit: roles.includes('coordination_lead'),
    verifiedByServer: true,
    currentMemberId: permissions.member_id,
  };
}

export function canUserEditTask(
  task: Pick<TaskRecord, 'owner_member_id'>,
  profile: TaskPermissionProfile
): boolean {
  if (!profile.verifiedByServer) return true;
  if (profile.writeScope === 'all') return true;
  if (profile.writeScope === 'own') {
    return Boolean(
      profile.currentMemberId &&
        task.owner_member_id === profile.currentMemberId
    );
  }
  return false;
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
      message = 'Task service data is currently unavailable.';
    }

    throw new TaskApiError(message, response.status, code);
  }

  if (!isJson) {
    throw new TaskApiError(
      'Task service is currently unavailable.',
      503,
      'SERVICE_UNAVAILABLE'
    );
  }

  return (await response.json()) as T;
}

function normalizeDependency(
  raw: Record<string, unknown>,
  fallbackTaskId: string
): TaskDependencyRecord {
  return {
    dependency_id: String(raw.dependency_id ?? raw.id ?? ''),
    task_id: String(raw.task_id ?? fallbackTaskId),
    depends_on_task_id: String(raw.depends_on_task_id ?? ''),
    depends_on_title:
      (raw.depends_on_title as string | null | undefined) ?? null,
    depends_on_status:
      (raw.depends_on_status as TaskStatus | null | undefined) ?? null,
  };
}

function normalizeTask(raw: Record<string, unknown>): TaskRecord {
  const taskId = String(raw.task_id ?? raw.id ?? '');
  const rawDeps = Array.isArray(raw.dependencies)
    ? (raw.dependencies as Array<Record<string, unknown>>)
    : null;

  return {
    task_id: taskId,
    title: String(raw.title ?? ''),
    task_type: (raw.task_type as TaskType) ?? 'follow_up',
    owner_member_id: String(raw.owner_member_id ?? ''),
    due_at: String(raw.due_at ?? ''),
    status: (raw.status as TaskStatus) ?? 'open',
    linked_type: (raw.linked_type as TaskLinkedType | null | undefined) ?? null,
    linked_id: (raw.linked_id as string | null | undefined) ?? null,
    bet_id: (raw.bet_id as string | null | undefined) ?? null,
    origin: (raw.origin as TaskOrigin) ?? 'manual',
    record_class:
      (raw.record_class as TaskRecordClass | undefined) ?? undefined,
    edition_id: (raw.edition_id as string | null | undefined) ?? null,
    ai_action_id: (raw.ai_action_id as string | null | undefined) ?? null,
    completed_at: (raw.completed_at as string | null | undefined) ?? null,
    created_at: (raw.created_at as string | null | undefined) ?? null,
    created_by: (raw.created_by as string | null | undefined) ?? null,
    source_ref: (raw.source_ref as string | null | undefined) ?? null,
    data_version:
      (raw.data_version as string | number | null | undefined) ?? null,
    owner_name: (raw.owner_name as string | null | undefined) ?? null,
    linked_label: (raw.linked_label as string | null | undefined) ?? null,
    bet_name: (raw.bet_name as string | null | undefined) ?? null,
    dependencies: rawDeps
      ? rawDeps.map((dep) => normalizeDependency(dep, taskId))
      : null,
  };
}

export async function fetchTasksList(
  filters: TaskFilters,
  signal?: AbortSignal
): Promise<TaskRecord[]> {
  const params = new URLSearchParams({
    record_class: filters.record_class,
    edition_id: filters.edition_id,
  });
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.task_type !== 'all') params.set('task_type', filters.task_type);
  if (filters.owner_member_id !== 'all') {
    params.set('owner_member_id', filters.owner_member_id);
  }
  if (filters.due_from) params.set('due_from', filters.due_from);
  if (filters.due_to) params.set('due_to', filters.due_to);
  if (filters.linked_type !== 'all') {
    params.set('linked_type', filters.linked_type);
  }
  if (filters.bet_id !== 'all') params.set('bet_id', filters.bet_id);
  if (filters.origin !== 'all') params.set('origin', filters.origin);

  const rawData = await requestJson<
    | Array<Record<string, unknown>>
    | { tasks?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }
  >(`${OVERVIEW_API_ENDPOINTS.tasks}?${params.toString()}`, { signal });

  const rawList = Array.isArray(rawData)
    ? rawData
    : rawData.tasks ?? rawData.items ?? [];

  return rawList.map(normalizeTask);
}

export async function fetchTaskById(
  taskId: string,
  recordClass: TaskRecordClass,
  editionId: string,
  signal?: AbortSignal
): Promise<TaskRecord> {
  const params = new URLSearchParams({
    task_id: taskId,
    record_class: recordClass,
    edition_id: editionId,
  });

  const rawData = await requestJson<
    | Array<Record<string, unknown>>
    | (Record<string, unknown> & {
        task?: Record<string, unknown>;
        tasks?: Array<Record<string, unknown>>;
        items?: Array<Record<string, unknown>>;
      })
  >(`${OVERVIEW_API_ENDPOINTS.tasks}?${params.toString()}`, { signal });

  if (Array.isArray(rawData)) {
    const match =
      rawData.find((r) => String(r.task_id ?? r.id ?? '') === taskId) ??
      rawData[0];
    if (!match) {
      throw new TaskApiError('Task not found.', 404, 'NOT_FOUND');
    }
    return normalizeTask(match);
  }
  if (rawData.task) {
    return normalizeTask(rawData.task);
  }
  const arr = rawData.tasks ?? rawData.items;
  if (Array.isArray(arr)) {
    const match =
      arr.find((r) => String(r.task_id ?? r.id ?? '') === taskId) ?? arr[0];
    if (!match) {
      throw new TaskApiError('Task not found.', 404, 'NOT_FOUND');
    }
    return normalizeTask(match);
  }
  return normalizeTask(rawData);
}

function validateLinkedPair(
  linkedType?: TaskLinkedType | null,
  linkedId?: string | null
): void {
  if (linkedType && !linkedId?.trim()) {
    throw new TaskApiError(
      'Select a valid linked record or clear the linked record type.',
      400,
      'INVALID_LINKED_PAIR'
    );
  }
  if (!linkedType && linkedId?.trim()) {
    throw new TaskApiError(
      'Linked record ID requires a linked record type.',
      400,
      'INVALID_LINKED_PAIR'
    );
  }
}

export async function createTask(
  payload: TaskCreatePayload
): Promise<TaskRecord> {
  if (payload.origin !== 'manual') {
    throw new TaskApiError(
      'Manually created tasks must have origin set to manual.',
      400,
      'INVALID_ORIGIN'
    );
  }
  validateLinkedPair(payload.linked_type, payload.linked_id);

  const sanitized: TaskCreatePayload = {
    title: payload.title.trim(),
    task_type: payload.task_type,
    owner_member_id: payload.owner_member_id.trim(),
    due_at: payload.due_at,
    status: payload.status,
    linked_type: payload.linked_type ?? null,
    linked_id: payload.linked_type ? payload.linked_id?.trim() ?? null : null,
    bet_id: payload.bet_id || null,
    origin: 'manual',
    record_class: payload.record_class,
    edition_id: payload.edition_id,
  };

  const res = await requestJson<
    Record<string, unknown> & { task?: Record<string, unknown> }
  >(OVERVIEW_API_ENDPOINTS.tasks, {
    method: 'POST',
    body: JSON.stringify(sanitized),
  });

  return res.task ? normalizeTask(res.task) : normalizeTask(res);
}

export async function updateTask(
  taskId: string,
  payload: TaskUpdatePayload
): Promise<TaskRecord> {
  if (payload.linked_type !== undefined || payload.linked_id !== undefined) {
    validateLinkedPair(payload.linked_type, payload.linked_id);
  }

  // Strictly omit origin, record_class, and completed_at from client update payloads.
  const sanitized: TaskUpdatePayload = {
    ...(payload.title !== undefined ? { title: payload.title.trim() } : {}),
    ...(payload.task_type !== undefined ? { task_type: payload.task_type } : {}),
    ...(payload.owner_member_id !== undefined
      ? { owner_member_id: payload.owner_member_id.trim() }
      : {}),
    ...(payload.due_at !== undefined ? { due_at: payload.due_at } : {}),
    ...(payload.status !== undefined ? { status: payload.status } : {}),
    ...(payload.linked_type !== undefined
      ? {
          linked_type: payload.linked_type ?? null,
          linked_id: payload.linked_type
            ? payload.linked_id?.trim() ?? null
            : null,
        }
      : {}),
    ...(payload.bet_id !== undefined ? { bet_id: payload.bet_id || null } : {}),
  };

  const res = await requestJson<
    Record<string, unknown> & { task?: Record<string, unknown> }
  >(`${OVERVIEW_API_ENDPOINTS.tasks}/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify(sanitized),
  });

  return res.task ? normalizeTask(res.task) : normalizeTask(res);
}

export async function fetchTaskAuditHistory(
  taskId: string,
  signal?: AbortSignal
): Promise<AuditEventRecord[]> {
  const params = new URLSearchParams({
    entity: 'task',
    id: taskId,
  });

  const res = await requestJson<
    | Array<Record<string, unknown>>
    | { events?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }
  >(`${OVERVIEW_API_ENDPOINTS.audit}?${params.toString()}`, { signal });

  const list = Array.isArray(res) ? res : res.events ?? res.items ?? [];
  return list
    .map((item): AuditEventRecord => ({
      audit_id: String(item.audit_id ?? item.id ?? ''),
      actor_id: String(item.actor_id ?? ''),
      actor_name: (item.actor_name as string | null | undefined) ?? null,
      ai_action_id: (item.ai_action_id as string | null | undefined) ?? null,
      entity: String(item.entity ?? 'task'),
      entity_id: String(item.entity_id ?? taskId),
      operation: String(item.operation ?? 'update'),
      before_hash: (item.before_hash as string | null | undefined) ?? null,
      after: (item.after as Record<string, unknown> | null | undefined) ?? null,
      at: String(item.at ?? item.created_at ?? ''),
    }))
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

export interface TeamRoleAssignmentInfo {
  role_assignment_id: string;
  role: string;
  edition_id: string;
  valid_from?: string | null;
}

export interface TeamDirectoryMember {
  member_id: string;
  full_name: string;
  email?: string | null;
  auth_linked?: boolean;
  fte_share?: number | null;
  is_active?: boolean;
  record_class?: string;
  roles?: string[];
  role_assignments?: TeamRoleAssignmentInfo[];
}

export async function fetchTeamRoster(
  editionId: string,
  recordClass?: string,
  signal?: AbortSignal
): Promise<TeamDirectoryMember[]> {
  const params = new URLSearchParams({ editionId });
  if (recordClass) params.set('recordClass', recordClass);
  const res = await requestJson<
    | TeamDirectoryMember[]
    | { team?: TeamDirectoryMember[]; members?: TeamDirectoryMember[] }
  >(`${OVERVIEW_API_ENDPOINTS.team}?${params.toString()}`, { signal });

  return Array.isArray(res) ? res : res.team ?? res.members ?? [];
}

/**
 * Loads real records from existing GET endpoints for validated linked_type pairs
 * (sponsors, opportunities, campaigns, referrals).
 */
export async function fetchLinkedRecordCatalog(
  recordClass: TaskRecordClass,
  editionId: string,
  signal?: AbortSignal
): Promise<LinkedRecordCatalog> {
  const queryParams = new URLSearchParams({
    record_class: recordClass,
    edition_id: editionId,
  });

  const [spRes, oppRes, camRes, refRes] = await Promise.allSettled([
    requestJson<
      | Array<Record<string, unknown>>
      | { sponsors?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }
    >(`${OVERVIEW_API_ENDPOINTS.sponsors}?${queryParams.toString()}`, { signal }),
    requestJson<
      | Array<Record<string, unknown>>
      | {
          opportunities?: Array<Record<string, unknown>>;
          items?: Array<Record<string, unknown>>;
        }
    >(`${OVERVIEW_API_ENDPOINTS.opportunities}?${queryParams.toString()}`, {
      signal,
    }),
    requestJson<
      | Array<Record<string, unknown>>
      | { campaigns?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }
    >(`${OVERVIEW_API_ENDPOINTS.campaigns}?${queryParams.toString()}`, { signal }),
    requestJson<
      | Array<Record<string, unknown>>
      | { referrals?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }
    >(`${OVERVIEW_API_ENDPOINTS.referrals}?${queryParams.toString()}`, { signal }),
  ]);

  const sponsorOptions: LinkedRecordOption[] = [];
  let sponsorLoaded = false;
  if (spRes.status === 'fulfilled') {
    sponsorLoaded = true;
    const raw = Array.isArray(spRes.value)
      ? spRes.value
      : spRes.value.sponsors ?? spRes.value.items ?? [];
    for (const row of raw) {
      const id = String(row.sponsor_id ?? row.id ?? '');
      if (!id) continue;
      sponsorOptions.push({
        id,
        label: String(row.display_name ?? row.legal_name ?? id),
        subtitle: (row.lifecycle_status as string | undefined) ?? null,
      });
    }
  }

  const opportunityOptions: LinkedRecordOption[] = [];
  let opportunityLoaded = false;
  if (oppRes.status === 'fulfilled') {
    opportunityLoaded = true;
    const raw = Array.isArray(oppRes.value)
      ? oppRes.value
      : oppRes.value.opportunities ?? oppRes.value.items ?? [];
    for (const row of raw) {
      const id = String(row.opportunity_id ?? row.id ?? '');
      if (!id) continue;
      const sponsorName = (row.sponsor_name as string | undefined) ?? null;
      const oppName = (row.name as string | undefined) ?? null;
      opportunityOptions.push({
        id,
        label: oppName || sponsorName || id,
        subtitle: oppName && sponsorName ? sponsorName : id,
      });
    }
  }

  const campaignOptions: LinkedRecordOption[] = [];
  let campaignLoaded = false;
  if (camRes.status === 'fulfilled') {
    campaignLoaded = true;
    const raw = Array.isArray(camRes.value)
      ? camRes.value
      : camRes.value.campaigns ?? camRes.value.items ?? [];
    for (const row of raw) {
      const id = String(row.campaign_id ?? row.id ?? '');
      if (!id) continue;
      campaignOptions.push({
        id,
        label: String(row.name ?? id),
        subtitle: (row.status as string | undefined) ?? null,
      });
    }
  }

  const referralOptions: LinkedRecordOption[] = [];
  let referralLoaded = false;
  if (refRes.status === 'fulfilled') {
    referralLoaded = true;
    const raw = Array.isArray(refRes.value)
      ? refRes.value
      : refRes.value.referrals ?? refRes.value.items ?? [];
    for (const row of raw) {
      const id = String(row.referral_id ?? row.id ?? '');
      if (!id) continue;
      const partnerName = (row.partner_name as string | undefined) ?? null;
      const sponsorName = (row.sponsor_name as string | undefined) ?? null;
      const commitmentStatus =
        (row.commitment_status as string | undefined) ?? null;
      referralOptions.push({
        id,
        label:
          partnerName && sponsorName
            ? `${partnerName} → ${sponsorName}`
            : sponsorName || partnerName || id,
        subtitle: commitmentStatus,
      });
    }
  }

  sponsorOptions.sort((a, b) => a.label.localeCompare(b.label));
  opportunityOptions.sort((a, b) => a.label.localeCompare(b.label));
  campaignOptions.sort((a, b) => a.label.localeCompare(b.label));
  referralOptions.sort((a, b) => a.label.localeCompare(b.label));

  return {
    sponsor: sponsorOptions,
    opportunity: opportunityOptions,
    campaign: campaignOptions,
    referral: referralOptions,
    loaded: {
      sponsor: sponsorLoaded,
      opportunity: opportunityLoaded,
      campaign: campaignLoaded,
      referral: referralLoaded,
    },
  };
}

/**
 * Merges team directory (GET /api/team), GET /api/me, and task owners.
 */
export function collectKnownTeamMembers(
  permissions: UserPermissionContext,
  tasks: TaskRecord[],
  teamRoster: TeamDirectoryMember[] = []
): KnownTeamMember[] {
  const map = new Map<string, KnownTeamMember>();

  for (const m of teamRoster) {
    if (!m.member_id) continue;
    map.set(m.member_id, {
      member_id: m.member_id,
      full_name: m.full_name ?? null,
      source: 'team',
    });
  }

  if (permissions.member_id) {
    const existing = map.get(permissions.member_id);
    map.set(permissions.member_id, {
      member_id: permissions.member_id,
      full_name: permissions.full_name ?? existing?.full_name ?? null,
      source: 'me',
    });
  }

  for (const t of tasks) {
    if (!t.owner_member_id) continue;
    const existing = map.get(t.owner_member_id);
    if (!existing) {
      map.set(t.owner_member_id, {
        member_id: t.owner_member_id,
        full_name: t.owner_name ?? null,
        source: 'loaded_records',
      });
    } else if (!existing.full_name && t.owner_name) {
      map.set(t.owner_member_id, {
        ...existing,
        full_name: t.owner_name,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    (a.full_name || a.member_id).localeCompare(b.full_name || b.member_id)
  );
}
