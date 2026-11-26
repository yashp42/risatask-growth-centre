import { AlertCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getTodayIstIso } from '../../lib/dateIst';
import { CANONICAL_BETS, formatBetDisplay } from '../../services/campaignsApi';
import {
  TaskApiError,
  createTask,
  formatTaskLinkedType,
  formatTaskOrigin,
  formatTaskStatus,
  formatTaskType,
  toDateAndTimeInputs,
  updateTask,
} from '../../services/tasksApi';
import {
  ALL_TASK_LINKED_TYPES,
  ALL_TASK_STATUSES,
  ALL_TASK_TYPES,
  type KnownTeamMember,
  type LinkedRecordCatalog,
  type TaskCreatePayload,
  type TaskLinkedType,
  type TaskPermissionProfile,
  type TaskRecord,
  type TaskRecordClass,
  type TaskStatus,
  type TaskType,
  type TaskUpdatePayload,
} from '../../types/tasks';
import { InfoHint } from '../ui/InfoHint';
import { SlideOverDrawer } from '../ui/SlideOverDrawer';

interface TaskFormDrawerProps {
  open: boolean;
  editingTask: TaskRecord | null;
  activeRecordClass: TaskRecordClass;
  activeEditionId: string;
  knownTeamMembers: KnownTeamMember[];
  linkedCatalog: LinkedRecordCatalog;
  permissionProfile: TaskPermissionProfile;
  onClose: () => void;
  onSaved: (task: TaskRecord) => void;
}

export function TaskFormDrawer({
  open,
  editingTask,
  activeRecordClass,
  activeEditionId,
  knownTeamMembers,
  linkedCatalog,
  permissionProfile,
  onClose,
  onSaved,
}: TaskFormDrawerProps) {
  const isEditing = Boolean(editingTask);

  const [title, setTitle] = useState('');
  const [taskType, setTaskType] = useState<TaskType>('follow_up');
  const [ownerMemberId, setOwnerMemberId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('18:00');
  const [status, setStatus] = useState<TaskStatus>('open');
  const [linkedType, setLinkedType] = useState<TaskLinkedType | ''>('');
  const [linkedId, setLinkedId] = useState('');
  const [betId, setBetId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const effectiveRecordClass: TaskRecordClass =
    editingTask?.record_class ?? activeRecordClass;
  const effectiveEditionId: string =
    editingTask?.edition_id ?? activeEditionId;

  useEffect(() => {
    if (!open) return;
    setFormError(null);

    if (editingTask) {
      setTitle(editingTask.title);
      setTaskType(editingTask.task_type);
      setOwnerMemberId(editingTask.owner_member_id);
      const dt = toDateAndTimeInputs(editingTask.due_at);
      setDueDate(dt.date);
      setDueTime(dt.time);
      setStatus(editingTask.status);
      setLinkedType(editingTask.linked_type ?? '');
      setLinkedId(editingTask.linked_id ?? '');
      setBetId(editingTask.bet_id ?? '');
    } else {
      setTitle('');
      setTaskType('follow_up');
      setOwnerMemberId(
        permissionProfile.currentMemberId ??
          knownTeamMembers[0]?.member_id ??
          ''
      );
      const today = getTodayIstIso();
      setDueDate(today);
      setDueTime('18:00');
      setStatus('open');
      setLinkedType('');
      setLinkedId('');
      setBetId('');
    }
  }, [open, editingTask, permissionProfile.currentMemberId, knownTeamMembers]);

  // Include current editingTask owner in select options even if not in list
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
    if (editingTask?.owner_member_id && !map.has(editingTask.owner_member_id)) {
      map.set(
        editingTask.owner_member_id,
        editingTask.owner_name
          ? `${editingTask.owner_name} (${editingTask.owner_member_id})`
          : editingTask.owner_member_id
      );
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [knownTeamMembers, editingTask]);

  const ownerSelectionDisabled =
    submitting || (isEditing && !permissionProfile.canReassignOwner);

  const isUnsupportedLookupType = linkedType === 'invoice';

  const preservedExistingUnsupportedLink =
    Boolean(
      isEditing &&
        editingTask?.linked_type &&
        editingTask?.linked_id &&
        linkedType === editingTask.linked_type &&
        isUnsupportedLookupType
    );

  const linkedRecordOptions = useMemo(() => {
    if (
      linkedType !== 'sponsor' &&
      linkedType !== 'opportunity' &&
      linkedType !== 'campaign' &&
      linkedType !== 'referral'
    ) {
      return [];
    }
    const base = [...linkedCatalog[linkedType]];
    if (
      isEditing &&
      editingTask?.linked_type === linkedType &&
      editingTask.linked_id &&
      !base.some((item) => item.id === editingTask.linked_id)
    ) {
      base.unshift({
        id: editingTask.linked_id,
        label: editingTask.linked_label || editingTask.linked_id,
      });
    }
    return base;
  }, [linkedType, linkedCatalog, isEditing, editingTask]);

  const linkedTypeLoaded =
    linkedType === 'sponsor' ||
    linkedType === 'opportunity' ||
    linkedType === 'campaign' ||
    linkedType === 'referral'
      ? linkedCatalog.loaded[linkedType]
      : false;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError('Task title is required.');
      return;
    }

    if (!ownerMemberId.trim()) {
      setFormError(
        'An owner team member is required. No team member identity is available from the current session.'
      );
      return;
    }

    if (!dueDate) {
      setFormError('Due date and time are required.');
      return;
    }

    const composedDue = new Date(`${dueDate}T${dueTime || '18:00'}:00`);
    if (Number.isNaN(composedDue.getTime())) {
      setFormError('Enter a valid due date and time.');
      return;
    }
    const dueAtIso = composedDue.toISOString();

    if (linkedType && isUnsupportedLookupType && !preservedExistingUnsupportedLink) {
      setFormError(
        `${formatTaskLinkedType(linkedType)} lookup is not available yet. Clear the linked record type or choose a sponsor, opportunity, or campaign.`
      );
      return;
    }

    if (linkedType && !linkedId.trim()) {
      setFormError(
        `Select a valid ${formatTaskLinkedType(linkedType).toLowerCase()} record or clear the linked record type.`
      );
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      if (!isEditing) {
        const payload: TaskCreatePayload = {
          title: trimmedTitle,
          task_type: taskType,
          owner_member_id: ownerMemberId.trim(),
          due_at: dueAtIso,
          status,
          linked_type: linkedType ? (linkedType as TaskLinkedType) : null,
          linked_id: linkedType ? linkedId.trim() : null,
          bet_id: betId || null,
          origin: 'manual',
          record_class: effectiveRecordClass,
          edition_id: effectiveEditionId,
        };
        const saved = await createTask(payload);
        onSaved(saved);
      } else if (editingTask) {
        const payload: TaskUpdatePayload = {
          title: trimmedTitle,
          task_type: taskType,
          ...(permissionProfile.canReassignOwner
            ? { owner_member_id: ownerMemberId.trim() }
            : {}),
          due_at: dueAtIso,
          status,
          linked_type: linkedType ? (linkedType as TaskLinkedType) : null,
          linked_id: linkedType ? linkedId.trim() : null,
          bet_id: betId || null,
        };
        const saved = await updateTask(editingTask.task_id, payload);
        onSaved(saved);
      }
    } catch (err) {
      setFormError(
        err instanceof TaskApiError
          ? err.message
          : 'Unable to save task right now.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlideOverDrawer
      open={open}
      onClose={onClose}
      meta={isEditing ? `Edit task · ${editingTask?.task_id}` : 'New task'}
      title={isEditing ? editingTask?.title || 'Edit task' : 'Create task'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {formError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded border border-[#9B3B32]/30 bg-[#9B3B32]/5 px-3.5 py-2.5 text-[12px] text-[#9B3B32]"
          >
            <AlertCircle
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>{formError}</span>
          </div>
        ) : null}

        {/* Inherited read-only context & provenance */}
        <div className="grid grid-cols-1 gap-3 rounded border border-[#E8E6E0] bg-[#FAF9F6] px-3.5 py-2.5 sm:grid-cols-3">
          <div>
            <p className="text-[11px] font-medium text-[#788C83]">
              Data context
            </p>
            <p className="mt-0.5 font-mono text-[12px] text-[#202824]">
              {effectiveRecordClass}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-[#788C83]">Edition</p>
            <p className="mt-0.5 font-mono text-[12px] text-[#202824]">
              {effectiveEditionId}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-1">
              <p className="text-[11px] font-medium text-[#788C83]">Origin</p>
              <InfoHint
                label="Task origin provenance"
                content="Manual tasks always record origin as manual. Rule and AI-confirmed origins are assigned only by automated rules or confirmed assistant actions."
              />
            </div>
            <p className="mt-0.5 text-[12px] font-medium text-[#202824]">
              {isEditing
                ? formatTaskOrigin(editingTask?.origin ?? 'manual')
                : 'Manual'}
            </p>
          </div>
        </div>

        {/* Title */}
        <div>
          <label
            htmlFor="task-form-title"
            className="block text-[12px] font-medium text-[#525E58]"
          >
            Task title
          </label>
          <input
            id="task-form-title"
            type="text"
            required
            disabled={submitting}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Follow up on title proposal"
            className="mt-1 h-10 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
          />
        </div>

        {/* Type & Status */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="task-form-type"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Task type
            </label>
            <select
              id="task-form-type"
              required
              disabled={submitting}
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as TaskType)}
              className="mt-1 h-10 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              {ALL_TASK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {formatTaskType(t)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center gap-1">
              <label
                htmlFor="task-form-status"
                className="block text-[12px] font-medium text-[#525E58]"
              >
                Status
              </label>
              <InfoHint
                label="Completion handling"
                content="Marking a task done requires a completion timestamp handled when saved."
              />
            </div>
            <select
              id="task-form-status"
              required
              disabled={submitting}
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className="mt-1 h-10 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              {ALL_TASK_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {formatTaskStatus(st)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {status === 'done' ? (
          <p className="text-[12px] text-[#525E58]">
            Completion time is recorded when the task is saved as Done.
          </p>
        ) : null}

        {/* Owner */}
        <div>
          <div className="flex items-center gap-1">
            <label
              htmlFor="task-form-owner"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Owner
            </label>
            <InfoHint
              label="Team member scope"
              content="Defaults to your current team-member account when signed in. Only your current account and owners already seen in loaded tasks appear until a team directory lookup is added."
            />
          </div>
          {ownerChoices.length > 0 ? (
            <select
              id="task-form-owner"
              required
              disabled={ownerSelectionDisabled}
              value={ownerMemberId}
              onChange={(e) => setOwnerMemberId(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6] disabled:text-[#525E58]"
            >
              <option value="">Select owner</option>
              {ownerChoices.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.label}
                </option>
              ))}
            </select>
          ) : (
            <div className="mt-1 rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-3 py-2 text-[12px] text-[#525E58]">
              No team-member identity is available in the current session.
            </div>
          )}
          {isEditing && !permissionProfile.canReassignOwner ? (
            <p className="mt-1 text-[11px] text-[#788C83]">
              Reassigning tasks to another owner requires Coordination lead or
              Pipeline ops permission.
            </p>
          ) : null}
        </div>

        {/* Due date & time */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="task-form-due-date"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Due date
            </label>
            <input
              id="task-form-due-date"
              type="date"
              required
              disabled={submitting}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            />
          </div>
          <div>
            <label
              htmlFor="task-form-due-time"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Due time
            </label>
            <input
              id="task-form-due-time"
              type="time"
              required
              disabled={submitting}
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            />
          </div>
        </div>

        {/* Linked record pair */}
        <div className="space-y-3 border-t border-[#E8E6E0] pt-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="task-form-linked-type"
                className="block text-[12px] font-medium text-[#525E58]"
              >
                Linked record type
              </label>
              <select
                id="task-form-linked-type"
                disabled={submitting}
                value={linkedType}
                onChange={(e) => {
                  const next = e.target.value as TaskLinkedType | '';
                  setLinkedType(next);
                  setLinkedId('');
                }}
                className="mt-1 h-10 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
              >
                <option value="">None (standalone task)</option>
                {ALL_TASK_LINKED_TYPES.map((lt) => (
                  <option key={lt} value={lt}>
                    {formatTaskLinkedType(lt)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="task-form-linked-id"
                className="block text-[12px] font-medium text-[#525E58]"
              >
                Linked record
              </label>
              {!linkedType ? (
                <div className="mt-1 flex h-10 items-center rounded-md border border-[#E8E6E0] bg-[#FAF9F6] px-3 text-[12px] text-[#788C83]">
                  Select a linked record type first
                </div>
              ) : preservedExistingUnsupportedLink ? (
                <div className="mt-1 flex h-10 items-center rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-3 font-mono text-[12px] text-[#202824]">
                  {editingTask?.linked_label || editingTask?.linked_id}
                </div>
              ) : isUnsupportedLookupType ? (
                <div className="mt-1 flex h-10 items-center rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-3 text-[12px] text-[#788C83]">
                  Lookup unavailable
                </div>
              ) : (
                <select
                  id="task-form-linked-id"
                  disabled={submitting || linkedRecordOptions.length === 0}
                  value={linkedId}
                  onChange={(e) => setLinkedId(e.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
                >
                  <option value="">
                    {!linkedTypeLoaded
                      ? `Unable to load ${formatTaskLinkedType(linkedType).toLowerCase()}s`
                      : linkedRecordOptions.length === 0
                        ? `No ${formatTaskLinkedType(linkedType).toLowerCase()}s found`
                        : `Select ${formatTaskLinkedType(linkedType).toLowerCase()}`}
                  </option>
                  {linkedRecordOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                      {item.subtitle ? ` (${item.subtitle})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {linkedType && isUnsupportedLookupType && !preservedExistingUnsupportedLink ? (
            <p className="text-[12px] text-[#9B3B32]">
              {formatTaskLinkedType(linkedType)} lookup is not yet supported in
              this workspace. Leave the task unlinked or link it to a sponsor,
              opportunity, or campaign.
            </p>
          ) : null}

          {linkedType &&
          !isUnsupportedLookupType &&
          (!linkedTypeLoaded || linkedRecordOptions.length === 0) ? (
            <p className="text-[12px] text-[#525E58]">
              Real {formatTaskLinkedType(linkedType).toLowerCase()} records are
              not loaded for this edition, so this relationship must remain
              unset.
            </p>
          ) : null}
        </div>

        {/* Strategic bet */}
        <div>
          <label
            htmlFor="task-form-bet"
            className="block text-[12px] font-medium text-[#525E58]"
          >
            Strategic bet (optional)
          </label>
          <select
            id="task-form-bet"
            disabled={submitting}
            value={betId}
            onChange={(e) => setBetId(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
          >
            <option value="">Unassigned</option>
            {CANONICAL_BETS.map((bet) => (
              <option key={bet.bet_id} value={bet.bet_id}>
                {formatBetDisplay(bet.bet_id, bet.name)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#E8E6E0] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-md border border-[#D9D7D0] bg-white px-4 text-[13px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || ownerChoices.length === 0}
            className="h-10 rounded-md bg-[#315F52] px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#264B40] disabled:opacity-60"
          >
            {submitting
              ? 'Saving...'
              : isEditing
                ? 'Save changes'
                : 'Create task'}
          </button>
        </div>
      </form>
    </SlideOverDrawer>
  );
}
