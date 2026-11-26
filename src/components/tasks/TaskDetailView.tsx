import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSeason } from '../../contexts/SeasonContext';
import {
  READ_ONLY_2025_MESSAGE,
  isHistoricalReadOnlyEdition,
} from '../../lib/dateIst';
import { formatBetDisplay } from '../../services/campaignsApi';
import {
  TaskApiError,
  canUserEditTask,
  evaluateTaskOverdue,
  fetchTaskAuditHistory,
  fetchTaskById,
  formatTaskDueDisplay,
  formatTaskLinkedType,
  formatTaskOrigin,
  formatTaskStatus,
  formatTaskType,
  toDateAndTimeInputs,
  updateTask,
} from '../../services/tasksApi';
import type { ApiErrorInfo, DataLoadStatus } from '../../types/overview';
import {
  ALL_TASK_STATUSES,
  type AuditEventRecord,
  type KnownTeamMember,
  type TaskPermissionProfile,
  type TaskRecord,
  type TaskRecordClass,
  type TaskStatus,
} from '../../types/tasks';
import { DataStateWrapper } from '../ui/DataStateWrapper';
import { InfoHint } from '../ui/InfoHint';

interface TaskDetailViewProps {
  taskId: string;
  initialTask?: TaskRecord | null;
  recordClass: TaskRecordClass;
  editionId: string;
  knownTeamMembers: KnownTeamMember[];
  permissionProfile: TaskPermissionProfile;
  reloadToken: number;
  onBack: () => void;
  onEditTask: (task: TaskRecord) => void;
  onInvalidateTasks: () => void;
  onOpenSponsor?: (sponsorId: string) => void;
  onOpenOpportunity?: (opportunityId: string) => void;
  onOpenCampaign?: (campaignId: string) => void;
  onOpenTask?: (taskId: string) => void;
}

export function TaskDetailView({
  taskId,
  initialTask = null,
  recordClass,
  editionId,
  knownTeamMembers,
  permissionProfile,
  reloadToken,
  onBack,
  onEditTask,
  onInvalidateTasks,
  onOpenSponsor,
  onOpenOpportunity,
  onOpenCampaign,
  onOpenTask,
}: TaskDetailViewProps) {
  const { asOf } = useSeason();
  const [task, setTask] = useState<TaskRecord | null>(initialTask);
  const [taskStatus, setTaskStatus] = useState<DataLoadStatus>(
    initialTask ? 'ready' : 'loading'
  );
  const [taskError, setTaskError] = useState<ApiErrorInfo | null>(null);

  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [auditStatus, setAuditStatus] = useState<DataLoadStatus>('loading');
  const [auditError, setAuditError] = useState<ApiErrorInfo | null>(null);

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Quick deadline editor state
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineDate, setDeadlineDate] = useState('');
  const [deadlineTime, setDeadlineTime] = useState('18:00');

  const [localReload, setLocalReload] = useState(0);

  const triggerReload = useCallback(() => {
    setLocalReload((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const effectiveClass = initialTask?.record_class ?? recordClass;
    const effectiveEdition = initialTask?.edition_id ?? editionId;

    if (!initialTask || initialTask.task_id !== taskId) {
      setTaskStatus('loading');
    }
    setTaskError(null);
    setActionError(null);

    fetchTaskById(taskId, effectiveClass, effectiveEdition, controller.signal)
      .then((loaded) => {
        setTask(loaded);
        setTaskStatus('ready');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (initialTask && initialTask.task_id === taskId) {
          setTask(initialTask);
          setTaskStatus('ready');
        } else {
          setTaskStatus('error');
          setTaskError({
            code: err instanceof TaskApiError ? err.code : 'ERROR',
            message:
              err instanceof TaskApiError
                ? err.message
                : 'Unable to load task details.',
            endpoint: '',
          });
        }
      });

    if (permissionProfile.canViewAudit) {
      setAuditStatus('loading');
      setAuditError(null);
      fetchTaskAuditHistory(taskId, controller.signal)
        .then((events) => {
          setAuditEvents(events);
          setAuditStatus(events.length > 0 ? 'ready' : 'empty');
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setAuditStatus('error');
          setAuditError({
            code: err instanceof TaskApiError ? err.code : 'ERROR',
            message:
              err instanceof TaskApiError
                ? err.message
                : 'Unable to load audit history.',
            endpoint: '',
          });
        });
    } else {
      setAuditEvents([]);
      setAuditStatus('empty');
      setAuditError(null);
    }

    return () => controller.abort();
  }, [
    taskId,
    initialTask,
    recordClass,
    editionId,
    permissionProfile.canViewAudit,
    reloadToken,
    localReload,
  ]);

  const isHistorical2025 = isHistoricalReadOnlyEdition(
    task?.edition_id ?? editionId,
    task?.record_class ?? recordClass
  );
  const editable = task
    ? !isHistorical2025 && canUserEditTask(task, permissionProfile)
    : false;

  const overdueInfo = useMemo(() => {
    if (!task) return { isOverdue: false, isCancelledAnomaly: false };
    return evaluateTaskOverdue(task);
  }, [task]);

  const ownerChoices = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of knownTeamMembers) {
      map.set(
        member.member_id,
        member.full_name
          ? `${member.full_name} (${member.member_id})`
          : member.member_id
      );
    }
    if (task?.owner_member_id && !map.has(task.owner_member_id)) {
      map.set(
        task.owner_member_id,
        task.owner_name
          ? `${task.owner_name} (${task.owner_member_id})`
          : task.owner_member_id
      );
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [knownTeamMembers, task]);

  const handleQuickUpdate = async (
    payload: Parameters<typeof updateTask>[1]
  ) => {
    if (!task || !editable || isHistorical2025 || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const updated = await updateTask(task.task_id, payload);
      setTask(updated);
      setEditingDeadline(false);
      triggerReload();
      onInvalidateTasks();
    } catch (err) {
      setActionError(
        err instanceof TaskApiError
          ? err.message
          : 'Unable to update task right now.'
      );
    } finally {
      setActionBusy(false);
    }
  };

  const handleSaveDeadline = async (event: FormEvent) => {
    event.preventDefault();
    if (!deadlineDate) return;
    const composed = new Date(`${deadlineDate}T${deadlineTime || '18:00'}:00`);
    if (Number.isNaN(composed.getTime())) {
      setActionError('Enter a valid due date and time.');
      return;
    }
    await handleQuickUpdate({ due_at: composed.toISOString() });
  };

  const canDrillLinkedRecord = Boolean(
    task?.linked_id &&
      ((task.linked_type === 'sponsor' && onOpenSponsor) ||
        (task.linked_type === 'opportunity' && onOpenOpportunity) ||
        (task.linked_type === 'campaign' && onOpenCampaign))
  );

  const handleOpenLinkedRecord = () => {
    if (!task?.linked_type || !task.linked_id) return;
    if (task.linked_type === 'sponsor') onOpenSponsor?.(task.linked_id);
    else if (task.linked_type === 'opportunity')
      onOpenOpportunity?.(task.linked_id);
    else if (task.linked_type === 'campaign') onOpenCampaign?.(task.linked_id);
  };

  return (
    <div className="space-y-6 pb-8">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#525E58] transition-colors duration-150 hover:text-[#202824]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to Tasks
        </button>
      </div>

      <DataStateWrapper
        status={taskStatus}
        error={taskError}
        onRetry={triggerReload}
        loadingSkeleton={
          <div className="border-b border-[#D9D7D0] pb-6">
            <div className="h-7 w-72 rounded bg-[#E8E6E0]" />
            <div className="mt-2 h-4 w-64 rounded bg-[#F3F1EB]" />
          </div>
        }
      >
        {task ? (
          <>
            {/* Header */}
            <div className="border-b border-[#D9D7D0] pb-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-[#788C83]">
                    <span className="font-mono text-[#525E58]">
                      {task.task_id}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatTaskType(task.task_type)}</span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        task.status === 'done'
                          ? 'font-medium text-[#315F52]'
                          : task.status === 'blocked'
                            ? 'font-medium text-[#9B3B32]'
                            : 'font-medium text-[#202824]'
                      }
                    >
                      {formatTaskStatus(task.status)}
                    </span>
                    {overdueInfo.isOverdue ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-[#9B3B32]">
                          {overdueInfo.isCancelledAnomaly
                            ? 'Overdue (cancelled)'
                            : 'Overdue'}
                        </span>
                      </>
                    ) : null}
                    {task.record_class ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-[11px]">
                          {task.record_class}
                          {task.edition_id ? ` · ${task.edition_id}` : ''}
                        </span>
                      </>
                    ) : null}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-[11px]">As of {asOf}</span>
                    {isHistorical2025 ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-[11px] text-[#525E58]">
                          {READ_ONLY_2025_MESSAGE}
                        </span>
                      </>
                    ) : null}
                  </div>
                  <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-[#202824]">
                    {task.title}
                  </h1>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={triggerReload}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6] whitespace-nowrap"
                  >
                    <RefreshCw
                      className="h-3.5 w-3.5 text-[#525E58]"
                      aria-hidden="true"
                    />
                    Refresh
                  </button>

                  {editable || (isHistorical2025 && permissionProfile.canCreate) ? (
                    <>
                      <button
                        type="button"
                        disabled={isHistorical2025 || !editable}
                        title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                        onClick={() => {
                          if (isHistorical2025 || !editable) return;
                          onEditTask(task);
                        }}
                        className="inline-flex h-10 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3.5 text-[13px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                      >
                        <Pencil
                          className="h-3.5 w-3.5 text-[#525E58]"
                          aria-hidden="true"
                        />
                        Edit task
                      </button>

                      {task.status !== 'done' ? (
                        <button
                          type="button"
                          disabled={actionBusy || isHistorical2025 || !editable}
                          title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                          onClick={() => handleQuickUpdate({ status: 'done' })}
                          className="inline-flex h-10 items-center gap-1.5 rounded-md bg-[#315F52] px-3.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#264B40] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                        >
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          {actionBusy ? 'Updating...' : 'Mark as done'}
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>

              {actionError ? (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded border border-[#9B3B32]/30 bg-[#9B3B32]/5 px-3.5 py-2.5 text-[12px] text-[#9B3B32]"
                >
                  <AlertCircle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{actionError}</span>
                </div>
              ) : null}
            </div>

            {/* Canonical Task Details & Quick Actions */}
            <section className="rounded-md border border-[#D9D7D0] bg-white p-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label
                    htmlFor="detail-task-status"
                    className="block text-[11px] font-medium text-[#788C83]"
                  >
                    Status
                  </label>
                  {editable || (isHistorical2025 && permissionProfile.canCreate) ? (
                    <select
                      id="detail-task-status"
                      disabled={actionBusy || isHistorical2025 || !editable}
                      title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                      value={task.status}
                      onChange={(e) =>
                        handleQuickUpdate({
                          status: e.target.value as TaskStatus,
                        })
                      }
                      className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-2.5 text-[13px] font-medium text-[#202824] focus:border-[#315F52] focus:outline-none disabled:cursor-not-allowed disabled:bg-[#FAF9F6] disabled:opacity-60"
                    >
                      {ALL_TASK_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {formatTaskStatus(st)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="mt-1 text-[14px] font-medium text-[#202824]">
                      {formatTaskStatus(task.status)}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Task type
                  </p>
                  <p className="mt-1 text-[14px] text-[#202824]">
                    {formatTaskType(task.task_type)}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="detail-task-owner"
                    className="block text-[11px] font-medium text-[#788C83]"
                  >
                    Owner
                  </label>
                  {(editable || (isHistorical2025 && permissionProfile.canCreate)) &&
                  permissionProfile.canReassignOwner &&
                  ownerChoices.length > 0 ? (
                    <select
                      id="detail-task-owner"
                      disabled={actionBusy || isHistorical2025 || !editable}
                      title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                      value={task.owner_member_id}
                      onChange={(e) =>
                        handleQuickUpdate({ owner_member_id: e.target.value })
                      }
                      className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-2.5 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:cursor-not-allowed disabled:bg-[#FAF9F6] disabled:opacity-60"
                    >
                      {ownerChoices.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="mt-1 text-[14px] text-[#202824]">
                      {task.owner_name || task.owner_member_id}
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-[#788C83]">
                      Due date & time
                    </span>
                    {(editable || (isHistorical2025 && permissionProfile.canCreate)) &&
                    !editingDeadline ? (
                      <button
                        type="button"
                        disabled={isHistorical2025 || !editable}
                        title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                        onClick={() => {
                          if (isHistorical2025 || !editable) return;
                          const dt = toDateAndTimeInputs(task.due_at);
                          setDeadlineDate(dt.date);
                          setDeadlineTime(dt.time);
                          setEditingDeadline(true);
                        }}
                        className="text-[11px] font-medium text-[#315F52] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Change
                      </button>
                    ) : null}
                  </div>
                  {editingDeadline && editable ? (
                    <form
                      onSubmit={handleSaveDeadline}
                      className="mt-1 space-y-2"
                    >
                      <div className="flex gap-1.5">
                        <input
                          type="date"
                          required
                          value={deadlineDate}
                          onChange={(e) => setDeadlineDate(e.target.value)}
                          className="h-8 min-w-0 flex-1 rounded border border-[#D9D7D0] px-2 font-mono text-[12px]"
                        />
                        <input
                          type="time"
                          required
                          value={deadlineTime}
                          onChange={(e) => setDeadlineTime(e.target.value)}
                          className="h-8 w-24 rounded border border-[#D9D7D0] px-2 font-mono text-[12px]"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={actionBusy}
                          className="h-7 rounded bg-[#315F52] px-2.5 text-[11px] font-medium text-white hover:bg-[#264B40]"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingDeadline(false)}
                          className="h-7 rounded border border-[#D9D7D0] px-2.5 text-[11px] font-medium text-[#525E58]"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="mt-1">
                      <p className="font-mono text-[13px] tabular-nums text-[#202824]">
                        {formatTaskDueDisplay(task.due_at)}
                      </p>
                      {overdueInfo.isOverdue ? (
                        <p className="mt-0.5 text-[12px] font-medium text-[#9B3B32]">
                          {overdueInfo.isCancelledAnomaly
                            ? 'Overdue · cancelled task past due date'
                            : 'Overdue'}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Linked record
                  </p>
                  {task.linked_type && task.linked_id ? (
                    <div className="mt-1">
                      <span className="block text-[11px] text-[#788C83]">
                        {formatTaskLinkedType(task.linked_type)}
                      </span>
                      {canDrillLinkedRecord ? (
                        <button
                          type="button"
                          onClick={handleOpenLinkedRecord}
                          className="inline-flex items-center gap-1 text-[13px] font-medium text-[#315F52] hover:underline"
                        >
                          <span>{task.linked_label || task.linked_id}</span>
                          <ArrowUpRight
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        </button>
                      ) : (
                        <p className="font-mono text-[13px] text-[#202824]">
                          {task.linked_label || task.linked_id}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-[13px] text-[#788C83]">Unlinked</p>
                  )}
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Strategic bet
                  </p>
                  <p className="mt-1 text-[13px] text-[#202824]">
                    {task.bet_id
                      ? formatBetDisplay(task.bet_id, task.bet_name)
                      : '—'}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Origin
                  </p>
                  <p className="mt-1 text-[13px] text-[#202824]">
                    {formatTaskOrigin(task.origin)}
                  </p>
                  {task.ai_action_id ? (
                    <p className="mt-0.5 font-mono text-[11px] text-[#788C83]">
                      Action: {task.ai_action_id}
                    </p>
                  ) : null}
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Completion & provenance
                  </p>
                  <p className="mt-1 font-mono text-[12px] text-[#525E58]">
                    {task.completed_at
                      ? `Done ${formatTaskDueDisplay(task.completed_at)}`
                      : task.status === 'done'
                        ? 'Completion timestamp managed on save'
                        : 'Open execution'}
                  </p>
                </div>
              </div>
            </section>

            {/* Dependencies (read-only if supplied) */}
            <section className="rounded-md border border-[#D9D7D0] bg-white p-5">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[15px] font-semibold text-[#202824]">
                  Task dependencies
                </h2>
                <InfoHint
                  label="Dependency scope"
                  content="Task dependencies record prerequisite tasks that must finish before this task starts. Blocking status and task dependencies are tracked separately."
                />
              </div>

              {task.dependencies && task.dependencies.length > 0 ? (
                <ul className="mt-3 divide-y divide-[#E8E6E0] border-t border-[#E8E6E0]">
                  {task.dependencies.map((dep) => (
                    <li
                      key={dep.dependency_id}
                      className="flex items-center justify-between gap-4 py-2.5 text-[13px]"
                    >
                      <div className="min-w-0">
                        {onOpenTask ? (
                          <button
                            type="button"
                            onClick={() => onOpenTask(dep.depends_on_task_id)}
                            className="font-medium text-[#315F52] hover:underline"
                          >
                            {dep.depends_on_title || dep.depends_on_task_id}
                          </button>
                        ) : (
                          <span className="font-medium text-[#202824]">
                            {dep.depends_on_title || dep.depends_on_task_id}
                          </span>
                        )}
                        <span className="ml-2 font-mono text-[11px] text-[#788C83]">
                          {dep.depends_on_task_id}
                        </span>
                      </div>
                      {dep.depends_on_status ? (
                        <span className="text-[12px] text-[#525E58]">
                          {formatTaskStatus(dep.depends_on_status)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-[#525E58]">
                  No prerequisite dependencies recorded. Managing task
                  dependencies is not yet available in this workspace.
                </p>
              )}
            </section>

            {/* Audit History */}
            <section className="rounded-md border border-[#D9D7D0] bg-white p-5">
              <h2 className="text-[15px] font-semibold text-[#202824]">
                Audit history
              </h2>

              {!permissionProfile.canViewAudit ? (
                <p className="mt-2 text-[13px] text-[#525E58]">
                  Audit log access is restricted to Coordination lead roles.
                </p>
              ) : (
                <div className="mt-3">
                  <DataStateWrapper
                    status={auditStatus}
                    error={auditError}
                    onRetry={triggerReload}
                    loadingSkeleton={
                      <div className="space-y-2">
                        <div className="h-8 rounded bg-[#FAF9F6]" />
                        <div className="h-8 rounded bg-[#FAF9F6]" />
                      </div>
                    }
                  >
                    {auditEvents.length > 0 ? (
                      <div className="overflow-x-auto border-t border-[#E8E6E0]">
                        <table className="w-full border-collapse text-left">
                          <thead>
                            <tr className="border-b border-[#E8E6E0] text-[12px] font-medium text-[#525E58]">
                              <th className="py-2.5 pr-4">Timestamp</th>
                              <th className="py-2.5 pr-4">Operation</th>
                              <th className="py-2.5 pr-4">Actor</th>
                              <th className="py-2.5">Details</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E8E6E0] text-[12px]">
                            {auditEvents.map((ev) => (
                              <tr key={ev.audit_id}>
                                <td className="py-2.5 pr-4 font-mono tabular-nums text-[#525E58] whitespace-nowrap">
                                  {formatTaskDueDisplay(ev.at)}
                                </td>
                                <td className="py-2.5 pr-4 font-medium capitalize text-[#202824] whitespace-nowrap">
                                  {ev.operation.replace(/_/g, ' ')}
                                </td>
                                <td className="py-2.5 pr-4 text-[#525E58] whitespace-nowrap">
                                  {ev.actor_name || ev.actor_id}
                                  {ev.ai_action_id ? (
                                    <span className="ml-1.5 font-mono text-[11px] text-[#788C83]">
                                      ({ev.ai_action_id})
                                    </span>
                                  ) : null}
                                </td>
                                <td className="py-2.5 font-mono text-[11px] text-[#525E58]">
                                  {ev.after ? JSON.stringify(ev.after) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-[13px] text-[#525E58]">
                        No audit events recorded for this task yet.
                      </p>
                    )}
                  </DataStateWrapper>
                </div>
              )}
            </section>
          </>
        ) : null}
      </DataStateWrapper>
    </div>
  );
}
