import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Check,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Table2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSeason } from '../../contexts/SeasonContext';
import {
  READ_ONLY_2025_MESSAGE,
  isHistoricalReadOnlyEdition,
} from '../../lib/dateIst';
import { CANONICAL_BETS, formatRecordClassLabel } from '../../services/campaignsApi';
import {
  TASK_LINKED_TYPE_FILTER_OPTIONS,
  TASK_ORIGIN_FILTER_OPTIONS,
  TASK_RECORD_CLASS_OPTIONS,
  TASK_STATUS_FILTER_OPTIONS,
  TASK_TYPE_FILTER_OPTIONS,
  TaskApiError,
  canUserEditTask,
  evaluateTaskOverdue,
  formatTaskDueDisplay,
  formatTaskLinkedType,
  formatTaskOrigin,
  formatTaskStatus,
  formatTaskType,
  getDefaultTaskEditionForClass,
  isTaskDueSoon,
} from '../../services/tasksApi';
import type {
  ApiErrorInfo,
  DataLoadStatus,
  FilterOption,
  SortDirection,
} from '../../types/overview';
import {
  ALL_TASK_STATUSES,
  type KnownTeamMember,
  type TaskDisplayMode,
  type TaskFilters,
  type TaskPermissionProfile,
  type TaskRecord,
  type TaskRecordClass,
  type TaskScopeView,
  type TaskSortKey,
} from '../../types/tasks';
import type { PreviewStateMode } from '../overview/OverviewHeaderFilters';
import { DataStateWrapper } from '../ui/DataStateWrapper';
import { SelectControl } from '../ui/SelectControl';

interface TasksDirectoryPageProps {
  filters: TaskFilters;
  onChangeFilters: (next: TaskFilters) => void;
  tasks: TaskRecord[];
  knownTeamMembers: KnownTeamMember[];
  permissionProfile: TaskPermissionProfile;
  status: DataLoadStatus;
  error: ApiErrorInfo | null;
  onRetry: () => void;
  onRefresh: () => void;
  onCreateTask: () => void;
  onEditTask: (task: TaskRecord) => void;
  onMarkDone: (task: TaskRecord) => Promise<void>;
  onOpenTask: (task: TaskRecord) => void;
  onOpenSponsor?: (sponsorId: string) => void;
  onOpenOpportunity?: (opportunityId: string) => void;
  onOpenCampaign?: (campaignId: string) => void;
  showDevControls: boolean;
  previewMode: PreviewStateMode;
  onChangePreviewMode: (mode: PreviewStateMode) => void;
}

const BET_FILTER_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All strategic bets' },
  ...CANONICAL_BETS.map((b) => ({
    value: b.bet_id,
    label: `${b.bet_id} · ${b.name}`,
  })),
];

const SCOPE_TABS: ReadonlyArray<{ id: TaskScopeView; label: string }> = [
  { id: 'my', label: 'My Tasks' },
  { id: 'all', label: 'All Tasks' },
  { id: 'due_soon', label: 'Due Soon' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'completed', label: 'Completed' },
];

const TABLE_COLUMNS: ReadonlyArray<{
  key: TaskSortKey;
  label: string;
}> = [
  { key: 'title', label: 'Task' },
  { key: 'due_at', label: 'Due date' },
  { key: 'owner_member_id', label: 'Owner' },
  { key: 'status', label: 'Status' },
  { key: 'task_type', label: 'Type' },
  { key: 'linked_type', label: 'Linked record' },
];

export function TasksDirectoryPage({
  filters,
  onChangeFilters,
  tasks,
  knownTeamMembers,
  permissionProfile,
  status,
  error,
  onRetry,
  onRefresh,
  onCreateTask,
  onEditTask,
  onMarkDone,
  onOpenTask,
  onOpenSponsor,
  onOpenOpportunity,
  onOpenCampaign,
  showDevControls,
  previewMode,
  onChangePreviewMode,
}: TasksDirectoryPageProps) {
  const { asOf } = useSeason();
  const isHistorical2025 = isHistoricalReadOnlyEdition(
    filters.edition_id,
    filters.record_class
  );
  const [scopeView, setScopeView] = useState<TaskScopeView>('my');
  const [displayMode, setDisplayMode] = useState<TaskDisplayMode>('table');
  const [sortKey, setSortKey] = useState<TaskSortKey>('due_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [markingTaskId, setMarkingTaskId] = useState<string | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);

  const ownerFilterOptions = useMemo<FilterOption[]>(() => {
    return [
      { value: 'all', label: 'All known owners' },
      ...knownTeamMembers.map((m) => ({
        value: m.member_id,
        label: m.full_name ? `${m.full_name} (${m.member_id})` : m.member_id,
      })),
    ];
  }, [knownTeamMembers]);

  const nowMs = Date.now();

  const scopedTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (scopeView === 'my') {
        if (!permissionProfile.currentMemberId) return false;
        return task.owner_member_id === permissionProfile.currentMemberId;
      }
      if (scopeView === 'due_soon') {
        return isTaskDueSoon(task, nowMs);
      }
      if (scopeView === 'overdue') {
        return evaluateTaskOverdue(task, nowMs).isOverdue;
      }
      if (scopeView === 'completed') {
        return task.status === 'done';
      }
      return true;
    });
  }, [tasks, scopeView, permissionProfile.currentMemberId, nowMs]);

  const sortedTasks = useMemo(() => {
    if (scopedTasks.length === 0) return [];
    const copy = [...scopedTasks];
    const dir = sortDirection === 'asc' ? 1 : -1;

    copy.sort((a, b) => {
      const getVal = (t: TaskRecord): string | null => {
        switch (sortKey) {
          case 'title':
            return t.title || t.task_id;
          case 'due_at':
            return t.due_at || null;
          case 'owner_member_id':
            return t.owner_name || t.owner_member_id || null;
          case 'status':
            return t.status;
          case 'task_type':
            return t.task_type;
          case 'linked_type':
            return t.linked_type
              ? `${t.linked_type}:${t.linked_label || t.linked_id || ''}`
              : null;
          case 'bet_id':
            return t.bet_id ?? null;
          case 'origin':
            return t.origin;
        }
      };

      const av = getVal(a);
      const bv = getVal(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return av.localeCompare(bv) * dir;
    });

    return copy;
  }, [scopedTasks, sortKey, sortDirection]);

  const handleSort = (key: TaskSortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const handleQuickDone = async (task: TaskRecord) => {
    if (markingTaskId) return;
    setQuickError(null);
    setMarkingTaskId(task.task_id);
    try {
      await onMarkDone(task);
    } catch (err) {
      setQuickError(
        err instanceof TaskApiError
          ? err.message
          : 'Unable to mark task as done right now.'
      );
    } finally {
      setMarkingTaskId(null);
    }
  };

  const canDrillLinked = (task: TaskRecord) =>
    Boolean(
      task.linked_id &&
        ((task.linked_type === 'sponsor' && onOpenSponsor) ||
          (task.linked_type === 'opportunity' && onOpenOpportunity) ||
          (task.linked_type === 'campaign' && onOpenCampaign))
    );

  const handleDrillLinked = (task: TaskRecord) => {
    if (!task.linked_type || !task.linked_id) return;
    if (task.linked_type === 'sponsor') onOpenSponsor?.(task.linked_id);
    else if (task.linked_type === 'opportunity')
      onOpenOpportunity?.(task.linked_id);
    else if (task.linked_type === 'campaign') onOpenCampaign?.(task.linked_id);
  };

  const skeleton = (
    <div className="rounded-md border border-[#D9D7D0] bg-white p-4">
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="h-10 rounded bg-[#FAF9F6]" />
        ))}
      </div>
    </div>
  );

  const myTasksIdentityMissing =
    scopeView === 'my' &&
    status === 'ready' &&
    !permissionProfile.currentMemberId;

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <section className="border-b border-[#D9D7D0] pb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-[#202824]">
              Tasks
            </h1>
            <p className="mt-1 text-[13px] text-[#525E58]">
              Follow-ups, proposals, deadlines, and team assignments.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-[#788C83]">
              <span>{formatRecordClassLabel(filters.record_class)}</span>
              <span aria-hidden="true">·</span>
              <span>{filters.edition_id}</span>
              <span aria-hidden="true">·</span>
              <span>As of {asOf}</span>
              {isHistorical2025 ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-[#525E58]">
                    {READ_ONLY_2025_MESSAGE}
                  </span>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {showDevControls ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed border-[#D9D7D0] bg-[#FAF9F6] px-2.5 py-1">
                <span className="font-mono text-[11px] text-[#788C83]">
                  Dev state
                </span>
                <div
                  role="group"
                  aria-label="Developer preview task data state"
                  className="inline-flex rounded border border-[#D9D7D0] bg-white p-0.5"
                >
                  {(
                    [
                      { id: 'default', label: 'Live' },
                      { id: 'loading', label: 'Loading' },
                      { id: 'error', label: 'Error' },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => onChangePreviewMode(mode.id)}
                      className={`rounded px-2 py-0.5 text-[12px] font-medium transition-colors duration-150 ${
                        previewMode === mode.id
                          ? 'bg-[#315F52] text-white'
                          : 'text-[#525E58] hover:text-[#202824]'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex h-10 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6] whitespace-nowrap"
            >
              <RefreshCw
                className="h-3.5 w-3.5 text-[#525E58]"
                aria-hidden="true"
              />
              Refresh
            </button>

            {permissionProfile.canCreate ? (
              <button
                type="button"
                disabled={isHistorical2025}
                title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                onClick={onCreateTask}
                className="inline-flex h-10 items-center gap-1.5 rounded-md bg-[#315F52] px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#264B40] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                New task
              </button>
            ) : null}
          </div>
        </div>

        {/* Scope tabs & View switch */}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Task scope views"
            className="inline-flex flex-wrap rounded-md border border-[#D9D7D0] bg-[#FAF9F6] p-0.5"
          >
            {SCOPE_TABS.map((tab) => {
              const active = scopeView === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setScopeView(tab.id)}
                  className={`rounded px-3 py-1.5 text-[12px] font-medium transition-colors duration-150 whitespace-nowrap ${
                    active
                      ? 'bg-white text-[#202824] shadow-xs'
                      : 'text-[#525E58] hover:text-[#202824]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div
            role="group"
            aria-label="Task display mode"
            className="inline-flex rounded-md border border-[#D9D7D0] bg-[#FAF9F6] p-0.5"
          >
            <button
              type="button"
              onClick={() => setDisplayMode('table')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] font-medium transition-colors duration-150 whitespace-nowrap ${
                displayMode === 'table'
                  ? 'bg-white text-[#202824] shadow-xs'
                  : 'text-[#525E58] hover:text-[#202824]'
              }`}
            >
              <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
              Table
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('board')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] font-medium transition-colors duration-150 whitespace-nowrap ${
                displayMode === 'board'
                  ? 'bg-white text-[#202824] shadow-xs'
                  : 'text-[#525E58] hover:text-[#202824]'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
              Board
            </button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="tasks-search"
              className="text-[11px] font-medium text-[#788C83]"
            >
              Search
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[#788C83]"
                aria-hidden="true"
              />
              <input
                id="tasks-search"
                type="text"
                value={filters.search}
                onChange={(e) =>
                  onChangeFilters({ ...filters, search: e.target.value })
                }
                placeholder="Search title, ID, or linked..."
                className="h-9 w-full rounded-md border border-[#D9D7D0] bg-white pr-3 pl-8 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none"
              />
            </div>
          </div>

          <SelectControl
            id="tasks-filter-status"
            label="Status"
            value={filters.status}
            options={TASK_STATUS_FILTER_OPTIONS}
            onChange={(nextStatus) =>
              onChangeFilters({ ...filters, status: nextStatus })
            }
          />

          <SelectControl
            id="tasks-filter-type"
            label="Task type"
            value={filters.task_type}
            options={TASK_TYPE_FILTER_OPTIONS}
            onChange={(task_type) => onChangeFilters({ ...filters, task_type })}
          />

          <SelectControl
            id="tasks-filter-owner"
            label="Owner"
            value={filters.owner_member_id}
            options={ownerFilterOptions}
            onChange={(owner_member_id) =>
              onChangeFilters({ ...filters, owner_member_id })
            }
          />

          <SelectControl
            id="tasks-filter-record-class"
            label="Data context"
            value={filters.record_class}
            options={TASK_RECORD_CLASS_OPTIONS}
            onChange={(value) => {
              const nextClass = value as TaskRecordClass;
              onChangeFilters({
                ...filters,
                record_class: nextClass,
                edition_id: getDefaultTaskEditionForClass(nextClass),
              });
            }}
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="tasks-filter-due-from"
              className="text-[11px] font-medium text-[#788C83]"
            >
              Due from
            </label>
            <input
              id="tasks-filter-due-from"
              type="date"
              value={filters.due_from}
              onChange={(e) =>
                onChangeFilters({ ...filters, due_from: e.target.value })
              }
              className="h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[12px] text-[#202824] focus:border-[#315F52] focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="tasks-filter-due-to"
              className="text-[11px] font-medium text-[#788C83]"
            >
              Due to
            </label>
            <input
              id="tasks-filter-due-to"
              type="date"
              value={filters.due_to}
              onChange={(e) =>
                onChangeFilters({ ...filters, due_to: e.target.value })
              }
              className="h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[12px] text-[#202824] focus:border-[#315F52] focus:outline-none"
            />
          </div>

          <SelectControl
            id="tasks-filter-linked-type"
            label="Linked record type"
            value={filters.linked_type}
            options={TASK_LINKED_TYPE_FILTER_OPTIONS}
            onChange={(linked_type) =>
              onChangeFilters({ ...filters, linked_type })
            }
          />

          <SelectControl
            id="tasks-filter-bet"
            label="Strategic bet"
            value={filters.bet_id}
            options={BET_FILTER_OPTIONS}
            onChange={(bet_id) => onChangeFilters({ ...filters, bet_id })}
          />

          <SelectControl
            id="tasks-filter-origin"
            label="Origin"
            value={filters.origin}
            options={TASK_ORIGIN_FILTER_OPTIONS}
            onChange={(origin) => onChangeFilters({ ...filters, origin })}
          />
        </div>
      </section>

      {quickError ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md border border-[#9B3B32]/30 bg-[#9B3B32]/5 px-4 py-3 text-[12px] text-[#9B3B32]"
        >
          <div className="flex items-start gap-2">
            <AlertCircle
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>{quickError}</span>
          </div>
          <button
            type="button"
            onClick={() => setQuickError(null)}
            className="text-[11px] font-medium underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Task List / Board */}
      <section aria-label="Tasks workspace">
        <DataStateWrapper
          status={status}
          error={error}
          onRetry={onRetry}
          loadingSkeleton={skeleton}
        >
          {!permissionProfile.canRead ? (
            <div className="rounded-md border border-[#D9D7D0] bg-white px-6 py-10 text-center">
              <p className="text-[13px] font-medium text-[#202824]">
                Your current role does not have task-workspace access.
              </p>
            </div>
          ) : myTasksIdentityMissing ? (
            <div className="rounded-md border border-[#D9D7D0] bg-white px-6 py-10 text-center">
              <p className="text-[13px] font-medium text-[#202824]">
                Current team-member identity is unavailable for My Tasks.
              </p>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setScopeView('all')}
                  className="inline-flex h-9 items-center rounded-md border border-[#D9D7D0] bg-white px-3.5 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
                >
                  View All Tasks
                </button>
              </div>
            </div>
          ) : sortedTasks.length === 0 ? (
            <div className="rounded-md border border-[#D9D7D0] bg-white px-6 py-12 text-center">
              <p className="text-[13px] font-medium text-[#202824]">
                {scopeView === 'my'
                  ? 'No tasks assigned to you match these filters'
                  : 'No tasks match these filters'}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {scopeView !== 'all' ? (
                  <button
                    type="button"
                    onClick={() => setScopeView('all')}
                    className="inline-flex h-9 items-center rounded-md border border-[#D9D7D0] bg-white px-3.5 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
                  >
                    Switch to All Tasks
                  </button>
                ) : null}
                {permissionProfile.canCreate ? (
                  <button
                    type="button"
                    disabled={isHistorical2025}
                    title={
                      isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined
                    }
                    onClick={onCreateTask}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3.5 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus
                      className="h-3.5 w-3.5 text-[#315F52]"
                      aria-hidden="true"
                    />
                    Create task
                  </button>
                ) : null}
              </div>
            </div>
          ) : displayMode === 'table' ? (
            <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6]">
                      {TABLE_COLUMNS.map((col) => {
                        const isActive = sortKey === col.key;
                        const SortIcon = !isActive
                          ? ArrowUpDown
                          : sortDirection === 'asc'
                            ? ArrowUp
                            : ArrowDown;
                        return (
                          <th
                            key={col.key}
                            scope="col"
                            aria-sort={
                              isActive
                                ? sortDirection === 'asc'
                                  ? 'ascending'
                                  : 'descending'
                                : 'none'
                            }
                            className="px-4 py-3 text-[12px] font-medium text-[#525E58] whitespace-nowrap"
                          >
                            <button
                              type="button"
                              onClick={() => handleSort(col.key)}
                              className={`inline-flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors duration-150 hover:text-[#202824] ${
                                isActive ? 'font-semibold text-[#315F52]' : ''
                              }`}
                            >
                              <span>{col.label}</span>
                              <SortIcon
                                className={`h-3 w-3 ${
                                  isActive ? 'text-[#315F52]' : 'text-[#788C83]'
                                }`}
                                aria-hidden="true"
                              />
                            </button>
                          </th>
                        );
                      })}
                      <th
                        scope="col"
                        className="px-4 py-3 text-right text-[12px] font-medium text-[#525E58] whitespace-nowrap"
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-[#E8E6E0] text-[13px]">
                    {sortedTasks.map((task) => {
                      const editable = canUserEditTask(task, permissionProfile);
                      const overdue = evaluateTaskOverdue(task, nowMs);
                      const drillable = canDrillLinked(task);

                      return (
                        <tr
                          key={task.task_id}
                          className="transition-colors duration-150 hover:bg-[#FAF9F6]"
                        >
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => onOpenTask(task)}
                              className="text-left font-medium text-[#202824] hover:text-[#315F52] hover:underline"
                            >
                              {task.title}
                            </button>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[#788C83]">
                              <span className="font-mono">{task.task_id}</span>
                              {task.bet_id ? (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono">{task.bet_id}</span>
                                </>
                              ) : null}
                              <span aria-hidden="true">·</span>
                              <span>{formatTaskOrigin(task.origin)}</span>
                            </div>
                          </td>

                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`font-mono text-[12px] tabular-nums ${
                                overdue.isOverdue
                                  ? 'font-medium text-[#9B3B32]'
                                  : 'text-[#525E58]'
                              }`}
                            >
                              {formatTaskDueDisplay(task.due_at)}
                            </span>
                            {overdue.isOverdue ? (
                              <span className="mt-0.5 block text-[11px] font-medium text-[#9B3B32]">
                                {overdue.isCancelledAnomaly
                                  ? 'Overdue (cancelled)'
                                  : 'Overdue'}
                              </span>
                            ) : null}
                          </td>

                          <td className="px-4 py-3 text-[#525E58] whitespace-nowrap">
                            {task.owner_name || task.owner_member_id}
                          </td>

                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={
                                task.status === 'done'
                                  ? 'font-medium text-[#315F52]'
                                  : task.status === 'blocked'
                                    ? 'font-medium text-[#9B3B32]'
                                    : task.status === 'cancelled'
                                      ? 'text-[#788C83]'
                                      : 'text-[#202824]'
                              }
                            >
                              {formatTaskStatus(task.status)}
                            </span>
                          </td>

                          <td className="px-4 py-3 text-[#525E58] whitespace-nowrap">
                            {formatTaskType(task.task_type)}
                          </td>

                          <td className="px-4 py-3 whitespace-nowrap">
                            {task.linked_type && task.linked_id ? (
                              drillable ? (
                                <button
                                  type="button"
                                  onClick={() => handleDrillLinked(task)}
                                  className="inline-flex items-center gap-1 text-left text-[12px] font-medium text-[#315F52] hover:underline"
                                >
                                  <span>
                                    {formatTaskLinkedType(task.linked_type)} ·{' '}
                                    {task.linked_label || task.linked_id}
                                  </span>
                                  <ArrowUpRight
                                    className="h-3 w-3 shrink-0"
                                    aria-hidden="true"
                                  />
                                </button>
                              ) : (
                                <span className="text-[12px] text-[#525E58]">
                                  {formatTaskLinkedType(task.linked_type)} ·{' '}
                                  <span className="font-mono">
                                    {task.linked_label || task.linked_id}
                                  </span>
                                </span>
                              )
                            ) : (
                              <span className="text-[#788C83]">—</span>
                            )}
                          </td>

                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-3">
                              {(editable || (isHistorical2025 && permissionProfile.canCreate)) &&
                              task.status !== 'done' ? (
                                <button
                                  type="button"
                                  disabled={
                                    isHistorical2025 ||
                                    markingTaskId === task.task_id
                                  }
                                  title={
                                    isHistorical2025
                                      ? READ_ONLY_2025_MESSAGE
                                      : undefined
                                  }
                                  onClick={() => handleQuickDone(task)}
                                  className="inline-flex items-center gap-1 text-[12px] font-medium text-[#315F52] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                  {markingTaskId === task.task_id
                                    ? 'Saving...'
                                    : 'Done'}
                                </button>
                              ) : null}
                              {editable ||
                              (isHistorical2025 && permissionProfile.canCreate) ? (
                                <button
                                  type="button"
                                  disabled={isHistorical2025}
                                  title={
                                    isHistorical2025
                                      ? READ_ONLY_2025_MESSAGE
                                      : undefined
                                  }
                                  onClick={() => onEditTask(task)}
                                  className="text-[12px] font-medium text-[#525E58] hover:text-[#202824] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Edit
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => onOpenTask(task)}
                                className="inline-flex items-center gap-1 text-[12px] font-medium text-[#315F52] hover:underline"
                              >
                                Open
                                <ArrowUpRight
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              {ALL_TASK_STATUSES.map((statusKey) => {
                const colTasks = sortedTasks.filter(
                  (t) => t.status === statusKey
                );
                return (
                  <div
                    key={statusKey}
                    className="flex flex-col rounded-md border border-[#D9D7D0] bg-[#FAF9F6]/70"
                  >
                    <div className="flex items-center justify-between rounded-t-md border-b border-[#D9D7D0] bg-white px-3.5 py-2.5">
                      <span
                        className={`text-[12px] font-semibold ${
                          statusKey === 'done'
                            ? 'text-[#315F52]'
                            : statusKey === 'blocked'
                              ? 'text-[#9B3B32]'
                              : 'text-[#202824]'
                        }`}
                      >
                        {formatTaskStatus(statusKey)}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[#788C83]">
                        {colTasks.length}
                      </span>
                    </div>

                    <div className="space-y-2.5 p-2.5">
                      {colTasks.length > 0 ? (
                        colTasks.map((task) => {
                          const editable = canUserEditTask(
                            task,
                            permissionProfile
                          );
                          const overdue = evaluateTaskOverdue(task, nowMs);
                          return (
                            <article
                              key={task.task_id}
                              className="rounded-md border border-[#D9D7D0] bg-white p-3.5 transition-colors duration-150 hover:border-[#315F52]/50"
                            >
                              <div className="flex items-center justify-between gap-2 text-[11px] text-[#788C83]">
                                <span>{formatTaskType(task.task_type)}</span>
                                <span className="font-mono">{task.task_id}</span>
                              </div>

                              <button
                                type="button"
                                onClick={() => onOpenTask(task)}
                                className="mt-1 block text-left text-[13px] font-semibold leading-snug text-[#202824] hover:text-[#315F52] hover:underline"
                              >
                                {task.title}
                              </button>

                              <dl className="mt-2.5 space-y-1 border-t border-[#E8E6E0] pt-2 text-[11px] text-[#525E58]">
                                <div className="flex items-center justify-between gap-2">
                                  <dt className="text-[#788C83]">Due</dt>
                                  <dd
                                    className={`font-mono tabular-nums ${
                                      overdue.isOverdue
                                        ? 'font-medium text-[#9B3B32]'
                                        : 'text-[#202824]'
                                    }`}
                                  >
                                    {formatTaskDueDisplay(task.due_at)}
                                    {overdue.isCancelledAnomaly
                                      ? ' · cancelled'
                                      : overdue.isOverdue
                                        ? ' · overdue'
                                        : ''}
                                  </dd>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <dt className="text-[#788C83]">Owner</dt>
                                  <dd className="truncate font-medium text-[#202824]">
                                    {task.owner_name || task.owner_member_id}
                                  </dd>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <dt className="text-[#788C83]">Linked</dt>
                                  <dd className="truncate">
                                    {task.linked_type && task.linked_id
                                      ? `${formatTaskLinkedType(task.linked_type)} · ${task.linked_label || task.linked_id}`
                                      : '—'}
                                  </dd>
                                </div>
                              </dl>

                              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#E8E6E0] pt-2">
                                {(editable || (isHistorical2025 && permissionProfile.canCreate)) &&
                                task.status !== 'done' ? (
                                  <button
                                    type="button"
                                    disabled={
                                      isHistorical2025 ||
                                      markingTaskId === task.task_id
                                    }
                                    title={
                                      isHistorical2025
                                        ? READ_ONLY_2025_MESSAGE
                                        : undefined
                                    }
                                    onClick={() => handleQuickDone(task)}
                                    className="inline-flex items-center gap-1 text-[12px] font-medium text-[#315F52] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <Check
                                      className="h-3.5 w-3.5"
                                      aria-hidden="true"
                                    />
                                    {markingTaskId === task.task_id
                                      ? 'Saving...'
                                      : 'Mark done'}
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-[#788C83]">
                                    {formatTaskOrigin(task.origin)}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onOpenTask(task)}
                                  className="inline-flex items-center gap-1 text-[12px] font-medium text-[#315F52] hover:underline"
                                >
                                  Open
                                  <ArrowUpRight
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                </button>
                              </div>
                            </article>
                          );
                        })
                      ) : (
                        <p className="py-6 text-center text-[12px] text-[#788C83]">
                          No tasks
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DataStateWrapper>
      </section>
    </div>
  );
}
