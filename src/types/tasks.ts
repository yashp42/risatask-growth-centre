import type {
  BetId,
  CanonicalTaskStatus,
  CanonicalTaskType,
} from './campaigns';

export type TaskType = CanonicalTaskType;
export type TaskStatus = CanonicalTaskStatus;
export type TaskLinkedType =
  | 'sponsor'
  | 'opportunity'
  | 'invoice'
  | 'campaign'
  | 'referral';
export type TaskOrigin = 'manual' | 'rule' | 'ai_confirmed';

/**
 * TASK allowed record classes in 01_conceptual_data_model.md §4E
 * Note: §4E header lists "live, simulated" while Provenance line states "Live only".
 * Frontend inherits record_class from active application/edition context.
 */
export type TaskRecordClass = 'simulated' | 'live' | 'historical_synthetic';

export const ALL_TASK_STATUSES: ReadonlyArray<TaskStatus> = [
  'open',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
];

export const ALL_TASK_TYPES: ReadonlyArray<TaskType> = [
  'follow_up',
  'proposal',
  'invoice',
  'call',
  'pitch',
  'admin',
];

export const ALL_TASK_LINKED_TYPES: ReadonlyArray<TaskLinkedType> = [
  'sponsor',
  'opportunity',
  'invoice',
  'campaign',
  'referral',
];

export const ALL_TASK_ORIGINS: ReadonlyArray<TaskOrigin> = [
  'manual',
  'rule',
  'ai_confirmed',
];

/**
 * Canonical TASK_DEPENDENCY entity (01_conceptual_data_model.md §4E)
 * Read-only display when returned by GET /api/tasks; no write endpoint exists in §2.3.
 */
export interface TaskDependencyRecord {
  dependency_id: string;
  task_id: string;
  depends_on_task_id: string;
  // Optional server-joined display metadata
  depends_on_title?: string | null;
  depends_on_status?: TaskStatus | null;
}

/**
 * Canonical TASK entity (01_conceptual_data_model.md §4E)
 * Exact attributes: task_id, title, task_type, owner_member_id, due_at,
 * status, linked_type, linked_id, bet_id, origin.
 */
export interface TaskRecord {
  task_id: string;
  title: string;
  task_type: TaskType;
  owner_member_id: string;
  due_at: string;
  status: TaskStatus;
  linked_type?: TaskLinkedType | null;
  linked_id?: string | null;
  bet_id?: BetId | string | null;
  origin: TaskOrigin;
  // Provenance & server-managed metadata (never user-editable in task form)
  record_class?: TaskRecordClass;
  edition_id?: string | null;
  ai_action_id?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  created_by?: string | null;
  source_ref?: string | null;
  data_version?: string | number | null;
  // Optional server-joined display metadata
  owner_name?: string | null;
  linked_label?: string | null;
  bet_name?: string | null;
  dependencies?: TaskDependencyRecord[] | null;
}

/**
 * Canonical TASK creation payload.
 * Manual creation always fixes origin = 'manual' and inherits record_class/edition_id
 * from the active workspace context. Never submits completed_at.
 */
export interface TaskCreatePayload {
  title: string;
  task_type: TaskType;
  owner_member_id: string;
  due_at: string;
  status: TaskStatus;
  linked_type?: TaskLinkedType | null;
  linked_id?: string | null;
  bet_id?: string | null;
  origin: 'manual';
  record_class: TaskRecordClass;
  edition_id: string;
}

/**
 * Canonical TASK update payload (PATCH /api/tasks/:id).
 * Never mutates origin, record_class, or completed_at from the client.
 */
export interface TaskUpdatePayload {
  title?: string;
  task_type?: TaskType;
  owner_member_id?: string;
  due_at?: string;
  status?: TaskStatus;
  linked_type?: TaskLinkedType | null;
  linked_id?: string | null;
  bet_id?: string | null;
}

/**
 * Canonical AUDIT_EVENT entity (01_conceptual_data_model.md §4G)
 */
export interface AuditEventRecord {
  audit_id: string;
  actor_id: string;
  actor_name?: string | null;
  ai_action_id?: string | null;
  entity: string;
  entity_id: string;
  operation: 'insert' | 'update' | 'soft_delete' | string;
  before_hash?: string | null;
  after?: Record<string, unknown> | null;
  at: string;
}

export type TaskScopeView = 'my' | 'all' | 'due_soon' | 'overdue' | 'completed';
export type TaskDisplayMode = 'table' | 'board';

export interface TaskFilters {
  search: string;
  record_class: TaskRecordClass;
  edition_id: string;
  status: string;
  task_type: string;
  owner_member_id: string;
  due_from: string;
  due_to: string;
  linked_type: string;
  bet_id: string;
  origin: string;
}

export type TaskSortKey =
  | 'title'
  | 'due_at'
  | 'owner_member_id'
  | 'status'
  | 'task_type'
  | 'linked_type'
  | 'bet_id'
  | 'origin';

export interface KnownTeamMember {
  member_id: string;
  full_name?: string | null;
  source: 'me' | 'loaded_records' | 'team';
}

export interface LinkedRecordOption {
  id: string;
  label: string;
  subtitle?: string | null;
}

export interface LinkedRecordCatalog {
  sponsor: LinkedRecordOption[];
  opportunity: LinkedRecordOption[];
  campaign: LinkedRecordOption[];
  referral: LinkedRecordOption[];
  loaded: {
    sponsor: boolean;
    opportunity: boolean;
    campaign: boolean;
    referral: boolean;
  };
}

export interface TaskPermissionProfile {
  canRead: boolean;
  canCreate: boolean;
  writeScope: 'all' | 'own' | 'none';
  canApprove: boolean;
  canReassignOwner: boolean;
  canViewAudit: boolean;
  verifiedByServer: boolean;
  currentMemberId: string | null;
}
