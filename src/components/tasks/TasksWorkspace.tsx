import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSeason } from '../../contexts/SeasonContext';
import { isHistoricalReadOnlyEdition } from '../../lib/dateIst';
import {
  DEFAULT_UNVERIFIED_PERMISSIONS,
  fetchCurrentUserPermissions,
} from '../../services/sponsorsApi';
import {
  TaskApiError,
  collectKnownTeamMembers,
  fetchLinkedRecordCatalog,
  fetchTasksList,
  fetchTeamRoster,
  getTaskPermissionProfile,
  updateTask,
  type TeamDirectoryMember,
} from '../../services/tasksApi';
import type { ApiErrorInfo, DataLoadStatus } from '../../types/overview';
import type { UserPermissionContext } from '../../types/sponsors';
import type {
  LinkedRecordCatalog,
  TaskFilters,
  TaskRecord,
} from '../../types/tasks';
import type { PreviewStateMode } from '../overview/OverviewHeaderFilters';
import { TaskDetailView } from './TaskDetailView';
import { TaskFormDrawer } from './TaskFormDrawer';
import { TasksDirectoryPage } from './TasksDirectoryPage';

interface TasksWorkspaceProps {
  showDevControls: boolean;
  initialTaskId?: string | null;
  onClearInitialTaskId?: () => void;
  onOpenSponsor?: (sponsorId: string) => void;
  onOpenOpportunity?: (opportunityId: string) => void;
  onOpenCampaign?: (campaignId: string) => void;
}

const EMPTY_LINKED_CATALOG: LinkedRecordCatalog = {
  sponsor: [],
  opportunity: [],
  campaign: [],
  referral: [],
  loaded: {
    sponsor: false,
    opportunity: false,
    campaign: false,
    referral: false,
  },
};

export function TasksWorkspace({
  showDevControls,
  initialTaskId = null,
  onClearInitialTaskId,
  onOpenSponsor,
  onOpenOpportunity,
  onOpenCampaign,
}: TasksWorkspaceProps) {
  const { editionId, recordClass, setEditionAndClass } = useSeason();

  const [filters, setFilters] = useState<TaskFilters>(() => ({
    search: '',
    record_class: recordClass,
    edition_id: editionId,
    status: 'all',
    task_type: 'all',
    owner_member_id: 'all',
    due_from: '',
    due_to: '',
    linked_type: 'all',
    bet_id: 'all',
    origin: 'all',
  }));

  const [previewMode, setPreviewMode] = useState<PreviewStateMode>('default');
  const [reloadNonce, setReloadNonce] = useState(0);

  const [permissions, setPermissions] = useState<UserPermissionContext>(
    DEFAULT_UNVERIFIED_PERMISSIONS
  );
  const permissionProfile = useMemo(
    () => getTaskPermissionProfile(permissions),
    [permissions]
  );

  const [status, setStatus] = useState<DataLoadStatus>('loading');
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [linkedCatalog, setLinkedCatalog] =
    useState<LinkedRecordCatalog>(EMPTY_LINKED_CATALOG);
  const [teamRoster, setTeamRoster] = useState<TeamDirectoryMember[]>([]);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    initialTaskId
  );
  const [selectedTaskSeed, setSelectedTaskSeed] = useState<TaskRecord | null>(
    null
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);

  useEffect(() => {
    setFilters((prev) =>
      prev.edition_id === editionId && prev.record_class === recordClass
        ? prev
        : { ...prev, edition_id: editionId, record_class: recordClass }
    );
  }, [editionId, recordClass]);

  useEffect(() => {
    if (initialTaskId) {
      setSelectedTaskId(initialTaskId);
    }
  }, [initialTaskId]);

  const handleChangeFilters = useCallback(
    (updater: TaskFilters | ((prev: TaskFilters) => TaskFilters)) => {
      setFilters((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (
          next.edition_id !== prev.edition_id ||
          next.record_class !== prev.record_class
        ) {
          setEditionAndClass(next.edition_id, next.record_class);
        }
        return next;
      });
    },
    [setEditionAndClass]
  );

  useEffect(() => {
    if (!showDevControls && previewMode !== 'default') {
      setPreviewMode('default');
    }
  }, [showDevControls, previewMode]);

  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentUserPermissions(controller.signal).then((ctx) => {
      setPermissions(ctx);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    if (showDevControls && previewMode === 'loading') {
      setStatus('loading');
      setError(null);
      return () => controller.abort();
    }

    if (showDevControls && previewMode === 'error') {
      setStatus('error');
      setError({
        code: 'UNAVAILABLE',
        message: 'Task data could not be retrieved right now.',
        endpoint: '',
      });
      return () => controller.abort();
    }

    setStatus('loading');
    setError(null);

    fetchTasksList(filters, controller.signal)
      .then((list) => {
        setTasks(list);
        setStatus(list.length > 0 ? 'ready' : 'empty');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus('error');
        setError({
          code: err instanceof TaskApiError ? err.code : 'ERROR',
          message:
            err instanceof TaskApiError ? err.message : 'Unable to load tasks.',
          endpoint: '',
        });
      });

    return () => controller.abort();
  }, [filters, previewMode, showDevControls, reloadNonce]);

  useEffect(() => {
    const controller = new AbortController();
    fetchLinkedRecordCatalog(
      filters.record_class,
      filters.edition_id,
      controller.signal
    )
      .then((catalog) => {
        setLinkedCatalog(catalog);
      })
      .catch(() => {
        setLinkedCatalog(EMPTY_LINKED_CATALOG);
      });
    fetchTeamRoster(filters.edition_id, filters.record_class, controller.signal)
      .then((members) => {
        setTeamRoster(members);
      })
      .catch(() => {
        setTeamRoster([]);
      });
    return () => controller.abort();
  }, [filters.record_class, filters.edition_id, reloadNonce]);

  const knownTeamMembers = useMemo(
    () => collectKnownTeamMembers(permissions, tasks, teamRoster),
    [permissions, tasks, teamRoster]
  );

  const isHistoricalReadOnly = isHistoricalReadOnlyEdition(
    filters.edition_id,
    filters.record_class
  );

  const invalidateAll = useCallback(() => {
    setPreviewMode('default');
    setReloadNonce((n) => n + 1);
  }, []);

  const handleMarkDone = useCallback(
    async (task: TaskRecord) => {
      if (isHistoricalReadOnly) return;
      await updateTask(task.task_id, { status: 'done' });
      invalidateAll();
    },
    [invalidateAll, isHistoricalReadOnly]
  );

  return (
    <>
      {selectedTaskId ? (
        <TaskDetailView
          taskId={selectedTaskId}
          initialTask={selectedTaskSeed}
          recordClass={filters.record_class}
          editionId={filters.edition_id}
          knownTeamMembers={knownTeamMembers}
          permissionProfile={permissionProfile}
          reloadToken={reloadNonce}
          onBack={() => {
            setSelectedTaskId(null);
            setSelectedTaskSeed(null);
            onClearInitialTaskId?.();
          }}
          onEditTask={(task) => {
            if (isHistoricalReadOnly) return;
            setEditingTask(task);
            setFormOpen(true);
          }}
          onInvalidateTasks={invalidateAll}
          onOpenSponsor={onOpenSponsor}
          onOpenOpportunity={onOpenOpportunity}
          onOpenCampaign={onOpenCampaign}
          onOpenTask={(nextId) => {
            setSelectedTaskSeed(
              tasks.find((t) => t.task_id === nextId) ?? null
            );
            setSelectedTaskId(nextId);
          }}
        />
      ) : (
        <TasksDirectoryPage
          filters={filters}
          onChangeFilters={handleChangeFilters}
          tasks={tasks}
          knownTeamMembers={knownTeamMembers}
          permissionProfile={permissionProfile}
          status={status}
          error={error}
          onRetry={invalidateAll}
          onRefresh={invalidateAll}
          onCreateTask={() => {
            if (isHistoricalReadOnly) return;
            setEditingTask(null);
            setFormOpen(true);
          }}
          onEditTask={(task) => {
            if (isHistoricalReadOnly) return;
            setEditingTask(task);
            setFormOpen(true);
          }}
          onMarkDone={handleMarkDone}
          onOpenTask={(task) => {
            setSelectedTaskSeed(task);
            setSelectedTaskId(task.task_id);
          }}
          onOpenSponsor={onOpenSponsor}
          onOpenOpportunity={onOpenOpportunity}
          onOpenCampaign={onOpenCampaign}
          showDevControls={showDevControls}
          previewMode={previewMode}
          onChangePreviewMode={setPreviewMode}
        />
      )}

      <TaskFormDrawer
        open={formOpen}
        editingTask={editingTask}
        activeRecordClass={filters.record_class}
        activeEditionId={filters.edition_id}
        knownTeamMembers={knownTeamMembers}
        linkedCatalog={linkedCatalog}
        permissionProfile={permissionProfile}
        onClose={() => {
          setFormOpen(false);
          setEditingTask(null);
        }}
        onSaved={(saved) => {
          setFormOpen(false);
          setEditingTask(null);
          if (selectedTaskId === saved.task_id) {
            setSelectedTaskSeed(saved);
          }
          invalidateAll();
        }}
      />
    </>
  );
}
