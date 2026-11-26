import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  GitCommitHorizontal,
  Pencil,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSeason } from '../../contexts/SeasonContext';
import {
  READ_ONLY_2025_MESSAGE,
  isHistoricalReadOnlyEdition,
} from '../../lib/dateIst';
import {
  CANONICAL_TASK_TYPE_OPTIONS,
  formatBetDisplay,
  formatCurrencyInr,
  formatOpportunityStage,
  formatRecordClassLabel,
  formatSupportType,
} from '../../services/campaignsApi';
import {
  PipelineApiError,
  canUserConfirmDeal,
  canUserEditOpportunity,
  createOpportunityTask,
  fetchOpportunityById,
  fetchOpportunityContracts,
  fetchOpportunityMeetings,
  fetchOpportunitySponsorInteractions,
  fetchOpportunityTasks,
  formatMeetingStatus,
  formatProposalStatus,
  isOpenStage,
  isOpportunityReadOnly,
  updateOpportunityTaskStatus,
} from '../../services/pipelineApi';
import type {
  CampaignTaskRecord,
  CanonicalTaskStatus,
  CanonicalTaskType,
  InteractionRecord,
} from '../../types/campaigns';
import type { ApiErrorInfo, DataLoadStatus } from '../../types/overview';
import type {
  MeetingRecord,
  OpportunityEntity,
  OpportunityRecordClass,
} from '../../types/pipeline';
import type {
  SponsorContractRecord,
  UserPermissionContext,
} from '../../types/sponsors';
import { DataStateWrapper } from '../ui/DataStateWrapper';
import { InfoHint } from '../ui/InfoHint';

type DetailTabId =
  | 'overview'
  | 'stage_history'
  | 'activity'
  | 'proposals'
  | 'tasks'
  | 'contract';

interface OpportunityDetailViewProps {
  opportunityId: string;
  initialOpportunity?: OpportunityEntity | null;
  recordClass: OpportunityRecordClass;
  editionId: string;
  permissions: UserPermissionContext;
  reloadToken: number;
  onBack: () => void;
  onEditMetadata: (opportunity: OpportunityEntity) => void;
  onUpdateStage: (opportunity: OpportunityEntity) => void;
  onConfirmDeal?: (opportunity: OpportunityEntity) => void;
  onOpenSponsor?: (sponsorId: string) => void;
  onOpenCampaign?: (campaignId: string) => void;
  onInvalidatePipeline: () => void;
}

interface ActivityEntry {
  key: string;
  kind: 'meeting' | 'interaction';
  title: string;
  status_or_outcome: string | null;
  note: string | null;
  occurred_at: string;
  actor: string | null;
}

export function OpportunityDetailView({
  opportunityId,
  initialOpportunity = null,
  recordClass,
  editionId,
  permissions,
  reloadToken,
  onBack,
  onEditMetadata,
  onUpdateStage,
  onConfirmDeal,
  onOpenSponsor,
  onOpenCampaign,
  onInvalidatePipeline,
}: OpportunityDetailViewProps) {
  const { asOf } = useSeason();
  const [activeTab, setActiveTab] = useState<DetailTabId>('overview');

  const [opportunity, setOpportunity] = useState<OpportunityEntity | null>(
    initialOpportunity
  );
  const [oppStatus, setOppStatus] = useState<DataLoadStatus>(
    initialOpportunity ? 'ready' : 'loading'
  );
  const [oppError, setOppError] = useState<ApiErrorInfo | null>(null);

  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [interactions, setInteractions] = useState<InteractionRecord[]>([]);
  const [activityStatus, setActivityStatus] =
    useState<DataLoadStatus>('loading');
  const [activityError, setActivityError] = useState<ApiErrorInfo | null>(null);

  const [tasks, setTasks] = useState<CampaignTaskRecord[]>([]);
  const [tasksStatus, setTasksStatus] = useState<DataLoadStatus>('loading');
  const [tasksError, setTasksError] = useState<ApiErrorInfo | null>(null);

  const [contracts, setContracts] = useState<SponsorContractRecord[]>([]);
  const [contractsStatus, setContractsStatus] =
    useState<DataLoadStatus>('loading');
  const [contractsError, setContractsError] = useState<ApiErrorInfo | null>(
    null
  );

  // Task creation state
  const [showNewTask, setShowNewTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskType, setTaskType] = useState<CanonicalTaskType>('follow_up');
  const [taskOwnerId, setTaskOwnerId] = useState('');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [taskFormError, setTaskFormError] = useState<string | null>(null);

  const [localReload, setLocalReload] = useState(0);

  const triggerReload = useCallback(() => {
    setLocalReload((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const effectiveClass = initialOpportunity?.record_class ?? recordClass;
    const effectiveEdition = initialOpportunity?.edition_id ?? editionId;

    if (!initialOpportunity || initialOpportunity.opportunity_id !== opportunityId) {
      setOppStatus('loading');
    }
    setOppError(null);
    setActivityStatus('loading');
    setActivityError(null);
    setTasksStatus('loading');
    setTasksError(null);
    setContractsStatus('loading');
    setContractsError(null);

    const loadRelated = (entity: OpportunityEntity) => {
      const sClass = entity.record_class;
      const sEdition = entity.edition_id;

      // Meetings & Interactions
      Promise.all([
        fetchOpportunityMeetings(
          entity.opportunity_id,
          sClass,
          sEdition,
          controller.signal
        ).catch(() => [] as MeetingRecord[]),
        fetchOpportunitySponsorInteractions(
          entity.sponsor_id,
          sClass,
          sEdition,
          controller.signal
        ),
      ])
        .then(([meetingList, interactionList]) => {
          setMeetings(meetingList);
          setInteractions(interactionList);
          setActivityStatus(
            meetingList.length > 0 || interactionList.length > 0
              ? 'ready'
              : 'empty'
          );
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setActivityStatus('error');
          setActivityError({
            code: 'ERROR',
            message:
              err instanceof PipelineApiError
                ? err.message
                : 'Unable to load activity.',
            endpoint: '',
          });
        });

      // Tasks
      fetchOpportunityTasks(
        entity.opportunity_id,
        sClass,
        sEdition,
        controller.signal
      )
        .then((list) => {
          setTasks(list);
          setTasksStatus(list.length > 0 ? 'ready' : 'empty');
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setTasksStatus('error');
          setTasksError({
            code: 'ERROR',
            message:
              err instanceof PipelineApiError
                ? err.message
                : 'Unable to load tasks.',
            endpoint: '',
          });
        });

      // Contracts
      fetchOpportunityContracts(
        entity.opportunity_id,
        sClass,
        controller.signal
      )
        .then((list) => {
          setContracts(list);
          setContractsStatus(list.length > 0 ? 'ready' : 'empty');
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setContractsStatus('error');
          setContractsError({
            code: 'ERROR',
            message:
              err instanceof PipelineApiError
                ? err.message
                : 'Unable to load contract details.',
            endpoint: '',
          });
        });
    };

    fetchOpportunityById(
      opportunityId,
      effectiveClass,
      effectiveEdition,
      controller.signal
    )
      .then((entity) => {
        setOpportunity(entity);
        setOppStatus('ready');
        if (!taskOwnerId && entity.current_stage_version?.owner_member_id) {
          setTaskOwnerId(entity.current_stage_version.owner_member_id);
        }
        loadRelated(entity);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (
          initialOpportunity &&
          initialOpportunity.opportunity_id === opportunityId
        ) {
          setOpportunity(initialOpportunity);
          setOppStatus('ready');
          loadRelated(initialOpportunity);
        } else {
          setOppStatus('error');
          setOppError({
            code: err instanceof PipelineApiError ? err.code : 'ERROR',
            message:
              err instanceof PipelineApiError
                ? err.message
                : 'Unable to load opportunity details.',
            endpoint: '',
          });
        }
      });

    return () => controller.abort();
  }, [
    opportunityId,
    initialOpportunity,
    recordClass,
    editionId,
    reloadToken,
    localReload,
  ]);

  const stageHistoryList = useMemo(() => {
    if (!opportunity) return [];
    if (opportunity.stage_history && opportunity.stage_history.length > 0) {
      return opportunity.stage_history;
    }
    return opportunity.current_stage_version
      ? [opportunity.current_stage_version]
      : [];
  }, [opportunity]);

  const activityItems = useMemo<ActivityEntry[]>(() => {
    const entries: ActivityEntry[] = [];

    for (const mt of meetings) {
      entries.push({
        key: `mtg-${mt.meeting_id}`,
        kind: 'meeting',
        title: mt.purpose
          ? `Meeting · ${mt.purpose.replace(/_/g, ' ')}`
          : 'Meeting',
        status_or_outcome: formatMeetingStatus(mt.status),
        note: mt.outcome_note ?? null,
        occurred_at: mt.scheduled_at,
        actor:
          mt.attendee_member_ids && mt.attendee_member_ids.length > 0
            ? mt.attendee_member_ids.join(', ')
            : null,
      });
    }

    for (const inter of interactions) {
      entries.push({
        key: `int-${inter.interaction_id}`,
        kind: 'interaction',
        title: inter.event_type.replace(/_/g, ' '),
        status_or_outcome: inter.outcome
          ? inter.outcome.replace(/_/g, ' ')
          : null,
        note: inter.summary ?? null,
        occurred_at: inter.occurred_at,
        actor: inter.logged_by_name || inter.logged_by || null,
      });
    }

    return entries.sort((a, b) =>
      (b.occurred_at || '').localeCompare(a.occurred_at || '')
    );
  }, [meetings, interactions]);

  const isHistorical2025 = isHistoricalReadOnlyEdition(
    opportunity?.edition_id ?? editionId,
    opportunity?.record_class ?? recordClass
  );
  const readOnly = opportunity
    ? isOpportunityReadOnly(opportunity) || isHistorical2025
    : isHistorical2025;
  const roleAllowsWrite =
    !permissions.verified_by_server || permissions.can_write_sponsors;
  const editable = opportunity
    ? !isHistorical2025 && canUserEditOpportunity(opportunity, permissions)
    : false;
  const confirmable = opportunity
    ? !isHistorical2025 &&
      isOpenStage(opportunity.current_stage_version?.stage) &&
      !opportunity.has_contract &&
      canUserConfirmDeal(opportunity, permissions)
    : false;
  const curStage = opportunity?.current_stage_version ?? null;
  const proposals = opportunity?.proposals ?? [];

  const handleCreateTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!opportunity || readOnly || !editable || taskSubmitting) return;

    const trimmedTitle = taskTitle.trim();
    const trimmedOwner = taskOwnerId.trim();
    if (!trimmedTitle || !trimmedOwner || !taskDueAt) {
      setTaskFormError('Title, owner member ID, and due date are required.');
      return;
    }

    setTaskSubmitting(true);
    setTaskFormError(null);

    try {
      await createOpportunityTask({
        title: trimmedTitle,
        task_type: taskType,
        owner_member_id: trimmedOwner,
        due_at: new Date(taskDueAt).toISOString(),
        status: 'open',
        linked_type: 'opportunity',
        linked_id: opportunity.opportunity_id,
        bet_id: opportunity.bet_id ?? null,
        origin: 'manual',
      });
      setTaskTitle('');
      setTaskDueAt('');
      setShowNewTask(false);
      triggerReload();
    } catch (err) {
      setTaskFormError(
        err instanceof PipelineApiError
          ? err.message
          : 'Unable to create task right now.'
      );
    } finally {
      setTaskSubmitting(false);
    }
  };

  const handleToggleTaskDone = async (task: CampaignTaskRecord) => {
    if (readOnly || !editable) return;
    const nextStatus: CanonicalTaskStatus =
      task.status === 'done' ? 'open' : 'done';
    try {
      await updateOpportunityTaskStatus(task.task_id, nextStatus);
      triggerReload();
      onInvalidatePipeline();
    } catch {
      // Leave current state intact on failure
    }
  };

  const tabs: ReadonlyArray<{ id: DetailTabId; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    {
      id: 'stage_history',
      label: 'Stage history',
      count: stageHistoryList.length > 0 ? stageHistoryList.length : undefined,
    },
    {
      id: 'activity',
      label: 'Activity',
      count: activityStatus === 'ready' ? activityItems.length : undefined,
    },
    {
      id: 'proposals',
      label: 'Proposals',
      count: proposals.length > 0 ? proposals.length : undefined,
    },
    {
      id: 'tasks',
      label: 'Tasks',
      count: tasksStatus === 'ready' ? tasks.length : undefined,
    },
    {
      id: 'contract',
      label: 'Contract',
      count: contractsStatus === 'ready' ? contracts.length : undefined,
    },
  ];

  return (
    <div className="space-y-6 pb-8">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#525E58] transition-colors duration-150 hover:text-[#202824]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to Pipeline
        </button>
      </div>

      <DataStateWrapper
        status={oppStatus}
        error={oppError}
        onRetry={triggerReload}
        loadingSkeleton={
          <div className="border-b border-[#D9D7D0] pb-6">
            <div className="h-7 w-72 rounded bg-[#E8E6E0]" />
            <div className="mt-2 h-4 w-80 rounded bg-[#F3F1EB]" />
          </div>
        }
      >
        {opportunity ? (
          <div className="border-b border-[#D9D7D0] pb-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-[#788C83]">
                  <span>
                    {opportunity.sponsor_name || opportunity.sponsor_id}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatSupportType(opportunity.support_type)}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      curStage?.stage === 'partner_confirmed'
                        ? 'font-medium text-[#315F52]'
                        : curStage?.stage === 'lost' ||
                            curStage?.stage === 'withdrawn'
                          ? 'font-medium text-[#9B3B32]'
                          : 'font-medium text-[#202824]'
                    }
                  >
                    {formatOpportunityStage(curStage?.stage)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[11px]">
                    {formatRecordClassLabel(opportunity.record_class)} ·{' '}
                    {opportunity.edition_id}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[11px]">
                    As of {asOf}
                  </span>
                  {readOnly ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-[11px] text-[#525E58]">
                        {isHistorical2025 ? READ_ONLY_2025_MESSAGE : 'Read-only'}
                      </span>
                    </>
                  ) : null}
                </div>
                <h1 className="mt-1.5 text-[28px] font-semibold tracking-[-0.025em] text-[#202824]">
                  {opportunity.name || opportunity.opportunity_id}
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={triggerReload}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
                >
                  <RefreshCw
                    className="h-3.5 w-3.5 text-[#525E58]"
                    aria-hidden="true"
                  />
                  Refresh
                </button>
                {editable || (isHistorical2025 && roleAllowsWrite) ? (
                  <>
                    <button
                      type="button"
                      disabled={!editable || isHistorical2025}
                      title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                      onClick={() => {
                        if (!editable || isHistorical2025) return;
                        onEditMetadata(opportunity);
                      }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3.5 text-[13px] font-medium text-[#202824] hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Pencil
                        className="h-3.5 w-3.5 text-[#525E58]"
                        aria-hidden="true"
                      />
                      Edit details
                    </button>
                    <button
                      type="button"
                      disabled={!editable || isHistorical2025}
                      title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                      onClick={() => {
                        if (!editable || isHistorical2025) return;
                        onUpdateStage(opportunity);
                      }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3.5 text-[13px] font-medium text-[#202824] hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <GitCommitHorizontal
                        className="h-3.5 w-3.5 text-[#525E58]"
                        aria-hidden="true"
                      />
                      Update stage
                    </button>
                    {confirmable && onConfirmDeal ? (
                      <button
                        type="button"
                        onClick={() => onConfirmDeal(opportunity)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#315F52] px-3.5 text-[13px] font-medium text-white hover:bg-[#264B40]"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        Confirm deal
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>

            <div
              role="tablist"
              aria-label="Opportunity workspace sections"
              className="mt-6 flex flex-wrap gap-1 border-t border-[#E8E6E0] pt-4"
            >
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 whitespace-nowrap ${
                      isActive
                        ? 'bg-[#315F52] text-white'
                        : 'text-[#525E58] hover:bg-white hover:text-[#202824]'
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.count !== undefined ? (
                      <span
                        className={`ml-1.5 font-mono text-[11px] tabular-nums ${
                          isActive ? 'text-white/80' : 'text-[#788C83]'
                        }`}
                      >
                        {tab.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </DataStateWrapper>

      {opportunity && oppStatus === 'ready' ? (
        <>
          {/* 1. Overview */}
          {activeTab === 'overview' ? (
            <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Sponsor
                  </p>
                  {onOpenSponsor ? (
                    <button
                      type="button"
                      onClick={() => onOpenSponsor(opportunity.sponsor_id)}
                      className="mt-1 inline-flex items-center gap-1 text-[14px] font-medium text-[#315F52] hover:underline"
                    >
                      {opportunity.sponsor_name || opportunity.sponsor_id}
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : (
                    <p className="mt-1 text-[14px] font-medium text-[#202824]">
                      {opportunity.sponsor_name || opportunity.sponsor_id}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Primary contact
                  </p>
                  <p className="mt-1 text-[14px] text-[#202824]">
                    {opportunity.primary_contact_name ||
                      opportunity.primary_contact_id ||
                      '—'}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Support type
                  </p>
                  <p className="mt-1 text-[14px] text-[#202824]">
                    {formatSupportType(opportunity.support_type)}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Current stage
                  </p>
                  <p className="mt-1 text-[14px] font-medium text-[#202824]">
                    {formatOpportunityStage(curStage?.stage)}
                  </p>
                </div>

                <div>
                  <div className="flex items-center gap-1">
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Originating campaign
                    </p>
                    <InfoHint
                      label="Immutable attribution"
                      content="Originating campaign is set when the opportunity is created and never modified."
                    />
                  </div>
                  {opportunity.originating_campaign_id && onOpenCampaign ? (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenCampaign(opportunity.originating_campaign_id!)
                      }
                      className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-[#315F52] hover:underline"
                    >
                      {opportunity.originating_campaign_name ||
                        opportunity.originating_campaign_id}
                      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : (
                    <p className="mt-1 text-[13px] text-[#202824]">
                      {opportunity.originating_campaign_name ||
                        opportunity.originating_campaign_id ||
                        '—'}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Strategic bet
                  </p>
                  <p className="mt-1 text-[13px] text-[#202824]">
                    {opportunity.bet_id
                      ? formatBetDisplay(
                          opportunity.bet_id,
                          opportunity.bet_name
                        )
                      : '—'}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Current owner
                  </p>
                  <p className="mt-1 text-[13px] text-[#202824]">
                    {curStage?.owner_name || curStage?.owner_member_id || '—'}
                  </p>
                </div>

                <div>
                  <div className="flex items-center gap-1">
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Proposed face value
                    </p>
                    <InfoHint
                      label="Face value"
                      content="Unweighted face value from the current stage version; not a probability-weighted forecast."
                    />
                  </div>
                  <p className="mt-1 font-mono text-[14px] font-medium tabular-nums text-[#202824]">
                    {formatCurrencyInr(curStage?.proposed_value)}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-5 border-t border-[#E8E6E0] pt-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <div className="flex items-center gap-1">
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Confirmed signed value
                    </p>
                    <InfoHint
                      label="Signed value definition"
                      content="Populated only when stage is partner_confirmed. Signed value is a leading indicator and never cash collected."
                    />
                  </div>
                  <p className="mt-1 font-mono text-[14px] font-semibold tabular-nums text-[#315F52]">
                    {curStage?.stage === 'partner_confirmed'
                      ? formatCurrencyInr(curStage?.confirmed_value)
                      : '—'}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Renewal status
                  </p>
                  <p className="mt-1 text-[13px] text-[#202824]">
                    {opportunity.is_renewal ? 'Renewal' : 'New partnership'}
                    {opportunity.renewal_route
                      ? ` · ${opportunity.renewal_route}`
                      : ''}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Opportunity ID
                  </p>
                  <p className="mt-1 font-mono text-[12px] text-[#525E58]">
                    {opportunity.opportunity_id}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Provenance
                  </p>
                  <p className="mt-1 font-mono text-[12px] text-[#525E58]">
                    {formatRecordClassLabel(opportunity.record_class)}
                    {opportunity.source_ref
                      ? ` · ${opportunity.source_ref}`
                      : ''}
                    {opportunity.data_version !== null &&
                    opportunity.data_version !== undefined
                      ? ` · v${opportunity.data_version}`
                      : ''}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {/* 2. Stage history */}
          {activeTab === 'stage_history' ? (
            <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
              {stageHistoryList.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6] text-[12px] font-medium text-[#525E58]">
                        <th className="px-4 py-3">Effective / recorded</th>
                        <th className="px-4 py-3">Stage</th>
                        <th className="px-4 py-3">Owner</th>
                        <th className="px-4 py-3 text-right">Proposed value</th>
                        <th className="px-4 py-3 text-right">
                          Confirmed value
                        </th>
                        <th className="px-4 py-3">Drop / loss reason</th>
                        <th className="px-4 py-3">Version ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8E6E0] text-[13px]">
                      {stageHistoryList.map((ver) => (
                        <tr key={ver.history_id} className="hover:bg-[#FAF9F6]">
                          <td className="px-4 py-3 font-mono text-[12px] text-[#525E58] tabular-nums whitespace-nowrap">
                            {ver.valid_from || ver.created_at || '—'}
                            {ver.is_current ? (
                              <span className="ml-1.5 text-[11px] font-medium text-[#315F52]">
                                Current
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 font-medium text-[#202824] whitespace-nowrap">
                            {formatOpportunityStage(ver.stage)}
                          </td>
                          <td className="px-4 py-3 text-[#525E58] whitespace-nowrap">
                            {ver.owner_name || ver.owner_member_id || '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-[#202824]">
                            {formatCurrencyInr(ver.proposed_value)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums font-medium text-[#315F52]">
                            {ver.stage === 'partner_confirmed'
                              ? formatCurrencyInr(ver.confirmed_value)
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-[12px] text-[#525E58]">
                            {ver.drop_reason || ver.loss_reason
                              ? [
                                  ver.drop_reason?.replace(/_/g, ' '),
                                  ver.loss_reason?.replace(/_/g, ' '),
                                ]
                                  .filter(Boolean)
                                  .join(' · ')
                              : '—'}
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] text-[#788C83]">
                            {ver.history_id}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-6 py-10 text-center">
                  <p className="text-[13px] font-medium text-[#202824]">
                    No stage versions recorded
                  </p>
                </div>
              )}
            </div>
          ) : null}

          {/* 3. Activity (Meetings + Interactions) */}
          {activeTab === 'activity' ? (
            <DataStateWrapper
              status={activityStatus}
              error={activityError}
              onRetry={triggerReload}
              loadingSkeleton={
                <div className="space-y-3 rounded-md border border-[#D9D7D0] bg-white p-5">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-10 rounded bg-[#FAF9F6]" />
                  ))}
                </div>
              }
            >
              <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
                {activityItems.length > 0 ? (
                  <ul className="divide-y divide-[#E8E6E0]">
                    {activityItems.map((item) => (
                      <li key={item.key} className="px-5 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#788C83]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium capitalize text-[#315F52]">
                              {item.title}
                            </span>
                            {item.status_or_outcome ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono text-[11px] text-[#525E58]">
                                  {item.status_or_outcome}
                                </span>
                              </>
                            ) : null}
                          </div>
                          <span className="font-mono text-[11px] tabular-nums">
                            {item.occurred_at}
                          </span>
                        </div>
                        {item.note ? (
                          <p className="mt-1.5 text-[13px] text-[#202824]">
                            {item.note}
                          </p>
                        ) : null}
                        {item.actor ? (
                          <p className="mt-1 text-[12px] text-[#788C83]">
                            {item.actor}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="px-6 py-10 text-center">
                    <p className="text-[13px] font-medium text-[#202824]">
                      No meetings or interactions recorded yet
                    </p>
                  </div>
                )}
              </div>
            </DataStateWrapper>
          ) : null}

          {/* 4. Proposals */}
          {activeTab === 'proposals' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-[12px] text-[#788C83]">
                <span>Versioned proposals</span>
                <InfoHint
                  label="Proposal vs contract"
                  content="Proposals are versioned commercial offers. Accepting a proposal does not confirm a partnership or replace a signed contract."
                />
              </div>

              <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
                {proposals.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6] text-[12px] font-medium text-[#525E58]">
                          <th className="px-4 py-3">Proposal ID</th>
                          <th className="px-4 py-3">Package</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Exclusivity requested</th>
                          <th className="px-4 py-3 text-right">
                            Proposed value
                          </th>
                          <th className="px-4 py-3">Sent at</th>
                          <th className="px-4 py-3">Valid until</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E8E6E0] text-[13px]">
                        {proposals.map((prop) => (
                          <tr
                            key={prop.proposal_id}
                            className="hover:bg-[#FAF9F6]"
                          >
                            <td className="px-4 py-3 font-mono font-medium text-[#202824]">
                              {prop.proposal_id}
                            </td>
                            <td className="px-4 py-3 text-[#525E58]">
                              {prop.package_name || prop.package_id || 'Custom'}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span
                                className={
                                  prop.status === 'accepted'
                                    ? 'font-medium text-[#315F52]'
                                    : prop.status === 'declined'
                                      ? 'font-medium text-[#9B3B32]'
                                      : 'text-[#202824]'
                                }
                              >
                                {formatProposalStatus(prop.status)}
                              </span>
                            </td>
                            <td className="px-4 py-3 capitalize text-[#525E58]">
                              {prop.exclusivity_requested ?? 'none'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-[#202824]">
                              {formatCurrencyInr(prop.proposed_value)}
                            </td>
                            <td className="px-4 py-3 font-mono text-[12px] text-[#525E58]">
                              {prop.sent_at ? prop.sent_at.slice(0, 10) : '—'}
                            </td>
                            <td className="px-4 py-3 font-mono text-[12px] text-[#525E58]">
                              {prop.valid_until || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-6 py-10 text-center">
                    <p className="text-[13px] font-medium text-[#202824]">
                      No proposals recorded for this opportunity
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* 5. Tasks */}
          {activeTab === 'tasks' ? (
            <div className="space-y-4">
              {(editable || (isHistorical2025 && roleAllowsWrite)) && !showNewTask ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={!editable || isHistorical2025}
                    title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                    onClick={() => {
                      if (!editable || isHistorical2025) return;
                      setShowNewTask(true);
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white hover:bg-[#264B40] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    New task
                  </button>
                </div>
              ) : null}

              {showNewTask && editable ? (
                <form
                  onSubmit={handleCreateTask}
                  className="rounded-md border border-[#D9D7D0] bg-white p-4 space-y-3"
                >
                  <p className="text-[13px] font-semibold text-[#202824]">
                    Add opportunity task
                  </p>
                  {taskFormError ? (
                    <p className="text-[12px] text-[#9B3B32]">{taskFormError}</p>
                  ) : null}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <input
                      type="text"
                      required
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      placeholder="Task title"
                      className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
                    />
                    <select
                      value={taskType}
                      onChange={(e) =>
                        setTaskType(e.target.value as CanonicalTaskType)
                      }
                      className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
                    >
                      {CANONICAL_TASK_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      required
                      value={taskOwnerId}
                      onChange={(e) => setTaskOwnerId(e.target.value)}
                      placeholder="Owner member ID"
                      className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
                    />
                    <input
                      type="date"
                      required
                      value={taskDueAt}
                      onChange={(e) => setTaskDueAt(e.target.value)}
                      className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNewTask(false)}
                      className="h-8 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={taskSubmitting}
                      className="h-8 rounded-md bg-[#315F52] px-3.5 text-[12px] font-medium text-white hover:bg-[#264B40] disabled:opacity-60"
                    >
                      {taskSubmitting ? 'Adding...' : 'Add task'}
                    </button>
                  </div>
                </form>
              ) : null}

              <DataStateWrapper
                status={tasksStatus}
                error={tasksError}
                onRetry={triggerReload}
                loadingSkeleton={
                  <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
                    <div className="h-24 rounded bg-[#FAF9F6]" />
                  </div>
                }
              >
                <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
                  {tasks.length > 0 ? (
                    <ul className="divide-y divide-[#E8E6E0]">
                      {tasks.map((task) => (
                        <li
                          key={task.task_id}
                          className="flex items-center justify-between gap-4 px-5 py-3.5"
                        >
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              disabled={!editable || isHistorical2025}
                              title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                              onClick={() => handleToggleTaskDone(task)}
                              aria-label={`Toggle task ${task.title}`}
                              className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded border transition-colors duration-150 ${
                                task.status === 'done'
                                  ? 'border-[#315F52] bg-[#315F52] text-white'
                                  : 'border-[#D9D7D0] bg-white'
                              } disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                              {task.status === 'done' ? (
                                <Check className="h-3 w-3" aria-hidden="true" />
                              ) : null}
                            </button>
                            <div>
                              <p
                                className={`text-[13px] font-medium ${
                                  task.status === 'done'
                                    ? 'line-through text-[#788C83]'
                                    : 'text-[#202824]'
                                }`}
                              >
                                {task.title}
                              </p>
                              <p className="mt-0.5 text-[12px] text-[#788C83]">
                                <span className="capitalize">
                                  {task.task_type.replace(/_/g, ' ')}
                                </span>
                                <span aria-hidden="true"> · </span>
                                <span>
                                  {task.owner_name || task.owner_member_id}
                                </span>
                                <span aria-hidden="true"> · </span>
                                <span className="capitalize">
                                  {task.status.replace(/_/g, ' ')}
                                </span>
                              </p>
                            </div>
                          </div>
                          <span className="font-mono text-[12px] text-[#525E58] tabular-nums whitespace-nowrap">
                            {task.due_at ? task.due_at.slice(0, 10) : '—'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="px-6 py-10 text-center">
                      <p className="text-[13px] font-medium text-[#202824]">
                        No tasks linked to this opportunity
                      </p>
                    </div>
                  )}
                </div>
              </DataStateWrapper>
            </div>
          ) : null}

          {/* 6. Contract */}
          {activeTab === 'contract' ? (
            <DataStateWrapper
              status={contractsStatus}
              error={contractsError}
              onRetry={triggerReload}
              loadingSkeleton={
                <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
                  <div className="h-24 rounded bg-[#FAF9F6]" />
                </div>
              }
            >
              <div className="space-y-4">
                {contracts.length > 0 ? (
                  contracts.map((contract) => (
                    <div
                      key={contract.contract_id}
                      className="rounded-md border border-[#D9D7D0] bg-white p-5 space-y-4"
                    >
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                        <div>
                          <p className="text-[11px] font-medium text-[#788C83]">
                            Contract ID
                          </p>
                          <p className="mt-1 font-mono text-[13px] font-medium text-[#202824]">
                            {contract.contract_id}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium text-[#788C83]">
                            Signed at
                          </p>
                          <p className="mt-1 font-mono text-[13px] text-[#202824]">
                            {contract.signed_at
                              ? contract.signed_at.slice(0, 10)
                              : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium text-[#788C83]">
                            Payment terms
                          </p>
                          <p className="mt-1 text-[13px] text-[#202824]">
                            {contract.payment_terms || '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium text-[#788C83]">
                            Status
                          </p>
                          <p className="mt-1 capitalize text-[13px] font-medium text-[#202824]">
                            {contract.status}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium text-[#788C83]">
                            Signed value total
                          </p>
                          <p className="mt-1 font-mono text-[14px] font-semibold tabular-nums text-[#315F52]">
                            {formatCurrencyInr(contract.signed_value_total)}
                          </p>
                        </div>
                      </div>

                      {contract.lines && contract.lines.length > 0 ? (
                        <div className="border-t border-[#E8E6E0] pt-4">
                          <p className="mb-2 text-[12px] font-medium text-[#525E58]">
                            Contract lines (cash vs in-kind separated)
                          </p>
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-left">
                              <thead>
                                <tr className="border-b border-[#E8E6E0] text-[11px] font-medium text-[#788C83]">
                                  <th className="py-2 pr-4">Line ID</th>
                                  <th className="py-2 pr-4">Asset</th>
                                  <th className="py-2 pr-4">
                                    Consideration type
                                  </th>
                                  <th className="py-2 text-right">Value</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#F3F1EB] text-[13px]">
                                {contract.lines.map((line) => (
                                  <tr key={line.contract_line_id}>
                                    <td className="py-2 pr-4 font-mono text-[12px] text-[#525E58]">
                                      {line.contract_line_id}
                                    </td>
                                    <td className="py-2 pr-4 text-[#202824]">
                                      {line.asset_name || line.asset_id || '—'}
                                    </td>
                                    <td className="py-2 pr-4 text-[#525E58]">
                                      {line.consideration_type === 'in_kind'
                                        ? 'In-kind'
                                        : 'Cash'}
                                    </td>
                                    <td className="py-2 text-right font-mono tabular-nums text-[#202824]">
                                      {formatCurrencyInr(line.value)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border border-[#D9D7D0] bg-white px-6 py-10 text-center">
                    <p className="text-[13px] font-medium text-[#202824]">
                      No contract recorded for this opportunity
                    </p>
                  </div>
                )}
              </div>
            </DataStateWrapper>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
