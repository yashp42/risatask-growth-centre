import {
  AlertCircle,
  ArrowLeft,
  Check,
  Pencil,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  READ_ONLY_2025_MESSAGE,
  isHistoricalReadOnlyEdition,
} from '../../lib/dateIst';
import {
  CAMPAIGN_METRIC_DICTIONARY,
  CANONICAL_TASK_TYPE_OPTIONS,
  CampaignApiError,
  createCampaignTask,
  deriveCampaignSponsors,
  fetchCampaignById,
  fetchCampaignInteractions,
  fetchCampaignOpportunities,
  fetchCampaignOutreach,
  fetchCampaignTasks,
  formatBetDisplay,
  formatCampaignStatus,
  formatChannelDisplay,
  formatCurrencyInr,
  formatMetricValue,
  formatOpportunityStage,
  formatRecordClassLabel,
  formatSupportType,
  isCampaignReadOnly,
  queryMetrics,
  updateCampaignTaskStatus,
} from '../../services/campaignsApi';
import {
  CAMPAIGN_METRIC_IDS,
  type CampaignEntity,
  type CampaignMetricId,
  type CampaignOpportunityRecord,
  type CampaignRecordClass,
  type CampaignTaskRecord,
  type CanonicalTaskStatus,
  type CanonicalTaskType,
  type InteractionRecord,
  type MetricQueryResult,
  type OutreachAttemptRecord,
} from '../../types/campaigns';
import type { ApiErrorInfo, DataLoadStatus } from '../../types/overview';
import { DataStateWrapper } from '../ui/DataStateWrapper';
import { InfoHint } from '../ui/InfoHint';

type DetailTabId =
  | 'overview'
  | 'activity'
  | 'sponsors'
  | 'opportunities'
  | 'tasks';

interface CampaignDetailViewProps {
  campaignId: string;
  initialCampaign?: CampaignEntity | null;
  recordClass: CampaignRecordClass;
  editionId: string;
  asOfDate: string;
  reloadToken: number;
  onBack: () => void;
  onEditCampaign: (campaign: CampaignEntity) => void;
  onInvalidatePortfolio: () => void;
  onOpenSponsor?: (sponsorId: string) => void;
}

interface ActivityTimelineEntry {
  key: string;
  source: 'outreach' | 'interaction';
  event_type: string;
  sponsor_label: string | null;
  contact_label: string | null;
  outcome: string | null;
  summary: string | null;
  actor_label: string | null;
  occurred_at: string;
}

export function CampaignDetailView({
  campaignId,
  initialCampaign = null,
  recordClass,
  editionId,
  asOfDate,
  reloadToken,
  onBack,
  onEditCampaign,
  onInvalidatePortfolio,
  onOpenSponsor,
}: CampaignDetailViewProps) {
  const [activeTab, setActiveTab] = useState<DetailTabId>('overview');

  const [campaign, setCampaign] = useState<CampaignEntity | null>(
    initialCampaign
  );
  const [campaignStatus, setCampaignStatus] = useState<DataLoadStatus>(
    initialCampaign ? 'ready' : 'loading'
  );
  const [campaignError, setCampaignError] = useState<ApiErrorInfo | null>(null);

  const [metricsById, setMetricsById] = useState<
    Partial<Record<CampaignMetricId, MetricQueryResult>>
  >({});
  const [metricsLoading, setMetricsLoading] = useState(true);

  const [outreach, setOutreach] = useState<OutreachAttemptRecord[]>([]);
  const [interactions, setInteractions] = useState<InteractionRecord[]>([]);
  const [activityStatus, setActivityStatus] =
    useState<DataLoadStatus>('loading');
  const [activityError, setActivityError] = useState<ApiErrorInfo | null>(null);

  const [opportunities, setOpportunities] = useState<
    CampaignOpportunityRecord[]
  >([]);
  const [opportunitiesStatus, setOpportunitiesStatus] =
    useState<DataLoadStatus>('loading');
  const [opportunitiesError, setOpportunitiesError] =
    useState<ApiErrorInfo | null>(null);

  const [tasks, setTasks] = useState<CampaignTaskRecord[]>([]);
  const [tasksStatus, setTasksStatus] = useState<DataLoadStatus>('loading');
  const [tasksError, setTasksError] = useState<ApiErrorInfo | null>(null);

  const [localReload, setLocalReload] = useState(0);

  // Task creation form state (canonical TASK entity)
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskType, setTaskType] = useState<CanonicalTaskType>('follow_up');
  const [taskOwnerId, setTaskOwnerId] = useState('');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [taskFormError, setTaskFormError] = useState<string | null>(null);

  const triggerReload = useCallback(() => {
    setLocalReload((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const effectiveClass = initialCampaign?.record_class ?? recordClass;
    const effectiveEdition = initialCampaign?.edition_id ?? editionId;

    if (!initialCampaign || initialCampaign.campaign_id !== campaignId) {
      setCampaignStatus('loading');
    }
    setCampaignError(null);
    setMetricsLoading(true);
    setActivityStatus('loading');
    setActivityError(null);
    setOpportunitiesStatus('loading');
    setOpportunitiesError(null);
    setTasksStatus('loading');
    setTasksError(null);

    const loadChildResources = (
      entityId: string,
      entityClass: CampaignRecordClass,
      entityEdition: string
    ) => {
      // Metrics query (POST /api/metrics/query)
      queryMetrics(
        {
          metric_ids: CAMPAIGN_METRIC_IDS,
          record_class: entityClass,
          edition_id: entityEdition,
          as_of: asOfDate,
          filters: { campaign_id: entityId },
        },
        controller.signal
      )
        .then((results) => {
          const map: Partial<Record<CampaignMetricId, MetricQueryResult>> = {};
          for (const item of results) {
            if (CAMPAIGN_METRIC_IDS.includes(item.metric_id as CampaignMetricId)) {
              map[item.metric_id as CampaignMetricId] = item;
            }
          }
          setMetricsById(map);
        })
        .catch(() => {
          setMetricsById({});
        })
        .finally(() => setMetricsLoading(false));

      // Outreach attempts + Interactions
      Promise.all([
        fetchCampaignOutreach(
          entityId,
          entityClass,
          entityEdition,
          controller.signal
        ),
        fetchCampaignInteractions(
          entityId,
          entityClass,
          entityEdition,
          controller.signal
        ),
      ])
        .then(([outreachList, interactionList]) => {
          setOutreach(outreachList);
          setInteractions(interactionList);
          setActivityStatus(
            outreachList.length > 0 || interactionList.length > 0
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
              err instanceof CampaignApiError
                ? err.message
                : 'Unable to load campaign activity.',
            endpoint: '',
          });
        });

      // Opportunities (filtered by originating_campaign_id)
      fetchCampaignOpportunities(
        entityId,
        entityClass,
        entityEdition,
        controller.signal
      )
        .then((list) => {
          setOpportunities(list);
          setOpportunitiesStatus(list.length > 0 ? 'ready' : 'empty');
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setOpportunitiesStatus('error');
          setOpportunitiesError({
            code: 'ERROR',
            message:
              err instanceof CampaignApiError
                ? err.message
                : 'Unable to load campaign opportunities.',
            endpoint: '',
          });
        });

      // Tasks (linked_type='campaign', linked_id=campaign_id)
      fetchCampaignTasks(
        entityId,
        entityClass,
        entityEdition,
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
              err instanceof CampaignApiError
                ? err.message
                : 'Unable to load campaign tasks.',
            endpoint: '',
          });
        });
    };

    fetchCampaignById(
      campaignId,
      effectiveClass,
      effectiveEdition,
      controller.signal
    )
      .then((entity) => {
        setCampaign(entity);
        setCampaignStatus('ready');
        loadChildResources(
          entity.campaign_id,
          entity.record_class,
          entity.edition_id
        );
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (initialCampaign && initialCampaign.campaign_id === campaignId) {
          setCampaign(initialCampaign);
          setCampaignStatus('ready');
          loadChildResources(
            initialCampaign.campaign_id,
            initialCampaign.record_class,
            initialCampaign.edition_id
          );
        } else {
          setMetricsLoading(false);
          setCampaignStatus('error');
          setCampaignError({
            code: err instanceof CampaignApiError ? err.code : 'ERROR',
            message:
              err instanceof CampaignApiError
                ? err.message
                : 'Unable to load campaign details.',
            endpoint: '',
          });
        }
      });

    return () => controller.abort();
  }, [
    campaignId,
    initialCampaign,
    recordClass,
    editionId,
    asOfDate,
    reloadToken,
    localReload,
  ]);

  const timelineEntries = useMemo<ActivityTimelineEntry[]>(() => {
    const attemptMap = new Map<string, OutreachAttemptRecord>();
    for (const att of outreach) {
      attemptMap.set(att.attempt_id, att);
    }

    const items: ActivityTimelineEntry[] = [];

    for (const att of outreach) {
      items.push({
        key: `att-${att.attempt_id}`,
        source: 'outreach',
        event_type: att.root_event_type.replace(/_/g, ' '),
        sponsor_label: att.sponsor_name || att.sponsor_id || null,
        contact_label: att.contact_name || null,
        outcome: null,
        summary: null,
        actor_label: att.owner_name || att.owner_member_id || null,
        occurred_at: att.started_at,
      });
    }

    for (const inter of interactions) {
      const att = attemptMap.get(inter.attempt_id);
      items.push({
        key: `int-${inter.interaction_id}`,
        source: 'interaction',
        event_type: inter.event_type.replace(/_/g, ' '),
        sponsor_label:
          inter.sponsor_name ||
          inter.sponsor_id ||
          att?.sponsor_name ||
          att?.sponsor_id ||
          null,
        contact_label: inter.contact_name || att?.contact_name || null,
        outcome: inter.outcome ?? null,
        summary: inter.summary ?? null,
        actor_label: inter.logged_by_name || inter.logged_by || null,
        occurred_at: inter.occurred_at,
      });
    }

    return items.sort((a, b) =>
      (b.occurred_at || '').localeCompare(a.occurred_at || '')
    );
  }, [outreach, interactions]);

  const sponsorAssociations = useMemo(
    () => deriveCampaignSponsors(outreach, interactions, opportunities),
    [outreach, interactions, opportunities]
  );

  const isHistorical2025 = isHistoricalReadOnlyEdition(
    campaign?.edition_id ?? editionId,
    campaign?.record_class ?? recordClass
  );
  const readOnly = campaign
    ? isCampaignReadOnly(campaign) || isHistorical2025
    : isHistorical2025;

  const handleCreateTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!campaign || readOnly || taskSubmitting) return;

    const trimmedTitle = taskTitle.trim();
    const trimmedOwner = taskOwnerId.trim();
    if (!trimmedTitle) {
      setTaskFormError('Task title is required.');
      return;
    }
    if (!trimmedOwner) {
      setTaskFormError('Owner member ID is required.');
      return;
    }
    if (!taskDueAt) {
      setTaskFormError('Due date is required.');
      return;
    }

    setTaskSubmitting(true);
    setTaskFormError(null);

    try {
      await createCampaignTask({
        title: trimmedTitle,
        task_type: taskType,
        owner_member_id: trimmedOwner,
        due_at: taskDueAt,
        status: 'open',
        linked_type: 'campaign',
        linked_id: campaign.campaign_id,
        bet_id: campaign.bet_id ?? null,
        origin: 'manual',
      });
      setTaskTitle('');
      setTaskType('follow_up');
      setTaskOwnerId('');
      setTaskDueAt('');
      setShowTaskForm(false);
      triggerReload();
      onInvalidatePortfolio();
    } catch (err) {
      setTaskFormError(
        err instanceof CampaignApiError
          ? err.message
          : 'Unable to create task.'
      );
    } finally {
      setTaskSubmitting(false);
    }
  };

  const handleToggleTaskStatus = async (task: CampaignTaskRecord) => {
    if (readOnly) return;
    const nextStatus: CanonicalTaskStatus =
      task.status === 'done' ? 'open' : 'done';
    try {
      await updateCampaignTaskStatus(task.task_id, nextStatus);
      triggerReload();
      onInvalidatePortfolio();
    } catch (err) {
      setTasksError({
        code: 'ERROR',
        message:
          err instanceof CampaignApiError
            ? err.message
            : 'Unable to update task status.',
        endpoint: '',
      });
      setTasksStatus('error');
    }
  };

  const tabs: ReadonlyArray<{ id: DetailTabId; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    {
      id: 'activity',
      label: 'Activity',
      count: activityStatus === 'ready' ? timelineEntries.length : undefined,
    },
    {
      id: 'sponsors',
      label: 'Sponsors & contacts',
      count:
        activityStatus === 'ready' || opportunitiesStatus === 'ready'
          ? sponsorAssociations.length
          : undefined,
    },
    {
      id: 'opportunities',
      label: 'Opportunities',
      count: opportunitiesStatus === 'ready' ? opportunities.length : undefined,
    },
    {
      id: 'tasks',
      label: 'Tasks',
      count: tasksStatus === 'ready' ? tasks.length : undefined,
    },
  ];

  return (
    <div className="space-y-6 pb-8">
      {/* Back navigation */}
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#525E58] transition-colors duration-150 hover:text-[#202824]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to Campaigns
        </button>
      </div>

      {/* Campaign header */}
      <DataStateWrapper
        status={campaignStatus}
        error={campaignError}
        onRetry={triggerReload}
        loadingSkeleton={
          <div className="border-b border-[#D9D7D0] pb-6">
            <div className="h-7 w-64 rounded bg-[#E8E6E0]" />
            <div className="mt-2 h-4 w-80 rounded bg-[#F3F1EB]" />
          </div>
        }
      >
        {campaign ? (
          <div className="border-b border-[#D9D7D0] pb-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-[#788C83]">
                  <span>
                    {formatChannelDisplay(
                      campaign.channel_id,
                      campaign.channel_name
                    )}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatCampaignStatus(campaign.status)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[11px]">
                    {formatRecordClassLabel(campaign.record_class)} ·{' '}
                    {campaign.edition_id}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[11px]">
                    As of {asOfDate}
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
                  {campaign.name}
                </h1>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={triggerReload}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-[#525E58]" aria-hidden="true" />
                  Refresh
                </button>
                {!readOnly || isHistorical2025 ? (
                  <button
                    type="button"
                    disabled={readOnly}
                    title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                    onClick={() => {
                      if (!readOnly) onEditCampaign(campaign);
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3.5 text-[13px] font-medium text-[#202824] hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Pencil className="h-3.5 w-3.5 text-[#525E58]" aria-hidden="true" />
                    Edit
                  </button>
                ) : null}
              </div>
            </div>

            {/* Section tabs */}
            <div
              role="tablist"
              aria-label="Campaign workspace sections"
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

      {/* Tab content */}
      {campaign && campaignStatus === 'ready' ? (
        <>
          {/* 1. Overview tab */}
          {activeTab === 'overview' ? (
            <div className="space-y-6">
              <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Owner
                    </p>
                    <p className="mt-1 text-[14px] font-medium text-[#202824]">
                      {campaign.owner_name || campaign.owner_member_id || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Channel
                    </p>
                    <p className="mt-1 text-[14px] font-medium text-[#202824]">
                      {formatChannelDisplay(
                        campaign.channel_id,
                        campaign.channel_name
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Strategic bet
                    </p>
                    <p className="mt-1 text-[14px] font-medium text-[#202824]">
                      {formatBetDisplay(campaign.bet_id, campaign.bet_name)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Planned window
                    </p>
                    <p className="mt-1 font-mono text-[13px] text-[#202824]">
                      {campaign.planned_start || campaign.planned_end
                        ? `${campaign.planned_start ?? '—'} → ${campaign.planned_end ?? '—'}`
                        : '—'}
                    </p>
                  </div>
                </div>

                {campaign.objective ? (
                  <div className="mt-4 border-t border-[#E8E6E0] pt-4">
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Objective
                    </p>
                    <p className="mt-1 text-[13px] text-[#202824]">
                      {campaign.objective}
                    </p>
                  </div>
                ) : null}
              </div>

              {/* Canonical campaign metrics: M-23, M-11, M-13, M-09, M-02, M-17 */}
              <div>
                <h2 className="mb-3 text-[15px] font-semibold text-[#202824]">
                  Campaign performance metrics
                </h2>
                {metricsLoading ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className="rounded-md border border-[#D9D7D0] bg-white p-4"
                      >
                        <div className="h-3 w-24 rounded bg-[#E8E6E0]" />
                        <div className="mt-3 h-7 w-20 rounded bg-[#E8E6E0]" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {CAMPAIGN_METRIC_IDS.map((metricId) => {
                      const def = CAMPAIGN_METRIC_DICTIONARY[metricId];
                      const entry = metricsById[metricId];
                      const hasRatioParts =
                        entry &&
                        entry.computable &&
                        entry.numerator !== null &&
                        entry.denominator !== null &&
                        def.denominator_label !== '—';

                      return (
                        <div
                          key={metricId}
                          className="rounded-md border border-[#D9D7D0] bg-white p-4"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1 text-[13px] font-medium text-[#525E58]">
                              <span>{def.name}</span>
                              <InfoHint
                                label={`${def.metric_id} ${def.name}`}
                                content={`${def.formula}. ${def.inclusion_exclusion}`}
                              />
                            </span>
                            <span className="font-mono text-[11px] text-[#788C83]">
                              {metricId}
                            </span>
                          </div>

                          <p className="mt-2.5 text-[24px] font-semibold tracking-[-0.02em] text-[#202824] tabular-nums">
                            {formatMetricValue(entry)}
                          </p>

                          <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[11px] text-[#788C83]">
                            <span>
                              {hasRatioParts
                                ? `${entry.numerator} / ${entry.denominator}`
                                : entry && !entry.computable && entry.reason
                                  ? entry.reason
                                  : def.denominator_label !== '—'
                                    ? def.denominator_label
                                    : def.numerator_label}
                            </span>
                            {entry?.data_version !== null &&
                            entry?.data_version !== undefined ? (
                              <span>v{entry.data_version}</span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* 2. Activity tab (OUTREACH_ATTEMPT + INTERACTION) */}
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
                {timelineEntries.length > 0 ? (
                  <ul className="divide-y divide-[#E8E6E0]">
                    {timelineEntries.map((item) => (
                      <li key={item.key} className="px-5 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#788C83]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium capitalize text-[#315F52]">
                              {item.event_type}
                            </span>
                            {item.sponsor_label ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-medium text-[#202824]">
                                  {item.sponsor_label}
                                </span>
                              </>
                            ) : null}
                            {item.contact_label ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{item.contact_label}</span>
                              </>
                            ) : null}
                            {item.outcome ? (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono text-[11px] text-[#525E58]">
                                  {item.outcome.replace(/_/g, ' ')}
                                </span>
                              </>
                            ) : null}
                          </div>
                          <span className="font-mono text-[11px] tabular-nums">
                            {item.occurred_at}
                          </span>
                        </div>
                        {item.summary ? (
                          <p className="mt-1.5 text-[13px] text-[#202824]">
                            {item.summary}
                          </p>
                        ) : null}
                        {item.actor_label ? (
                          <p className="mt-1 text-[12px] text-[#788C83]">
                            {item.actor_label}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="px-6 py-10 text-center">
                    <p className="text-[13px] font-medium text-[#202824]">
                      No activity yet
                    </p>
                  </div>
                )}
              </div>
            </DataStateWrapper>
          ) : null}

          {/* 3. Sponsors & contacts tab */}
          {activeTab === 'sponsors' ? (
            <DataStateWrapper
              status={
                activityStatus === 'error' && opportunitiesStatus === 'error'
                  ? 'error'
                  : activityStatus === 'loading' &&
                      opportunitiesStatus === 'loading'
                    ? 'loading'
                    : 'ready'
              }
              error={activityError ?? opportunitiesError}
              onRetry={triggerReload}
              loadingSkeleton={
                <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
                  <div className="h-24 rounded bg-[#FAF9F6]" />
                </div>
              }
            >
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-[12px] text-[#788C83]">
                  <span>Associated organisations</span>
                  <InfoHint
                    label="Cross-campaign sponsor attribution"
                    content="A sponsor organisation may appear in multiple campaigns; campaign totals are not mutually exclusive."
                  />
                </div>

                <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
                  {sponsorAssociations.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left">
                        <thead>
                          <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6] text-[12px] font-medium text-[#525E58]">
                            <th className="px-4 py-3">Organisation</th>
                            <th className="px-4 py-3">Contacts</th>
                            <th className="px-4 py-3 text-right">Attempts</th>
                            <th className="px-4 py-3 text-right">
                              Interactions
                            </th>
                            <th className="px-4 py-3 text-right">
                              Last activity
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E8E6E0] text-[13px]">
                          {sponsorAssociations.map((sp) => (
                            <tr
                              key={sp.sponsor_key}
                              className="hover:bg-[#FAF9F6]"
                            >
                              <td className="px-4 py-3 font-medium text-[#202824]">
                                {sp.sponsor_id && onOpenSponsor ? (
                                  <button
                                    type="button"
                                    onClick={() => onOpenSponsor(sp.sponsor_id!)}
                                    className="text-left hover:text-[#315F52] hover:underline"
                                  >
                                    {sp.sponsor_name}
                                  </button>
                                ) : (
                                  sp.sponsor_name
                                )}
                              </td>
                              <td className="px-4 py-3 text-[#525E58]">
                                {sp.contacts.length > 0
                                  ? sp.contacts
                                      .map((c) =>
                                        c.role ? `${c.name} (${c.role})` : c.name
                                      )
                                      .join(', ')
                                  : '—'}
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums text-[#202824]">
                                {sp.attempt_count}
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums text-[#202824]">
                                {sp.interaction_count}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-[12px] tabular-nums text-[#788C83]">
                                {sp.latest_activity_at ?? '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-6 py-10 text-center">
                      <p className="text-[13px] font-medium text-[#202824]">
                        No associated sponsors yet
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </DataStateWrapper>
          ) : null}

          {/* 4. Opportunities tab */}
          {activeTab === 'opportunities' ? (
            <DataStateWrapper
              status={opportunitiesStatus}
              error={opportunitiesError}
              onRetry={triggerReload}
              loadingSkeleton={
                <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
                  <div className="h-24 rounded bg-[#FAF9F6]" />
                </div>
              }
            >
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-[12px] text-[#788C83]">
                  <span>Originated opportunities</span>
                  <InfoHint
                    label="Support type and monetary separation"
                    content="Cash and in-kind support are tracked separately via support_type. Confirmed value reflects M-02 (includes in-kind when applicable; never cash)."
                  />
                </div>

                <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
                  {opportunities.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left">
                        <thead>
                          <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6] text-[12px] font-medium text-[#525E58]">
                            <th className="px-4 py-3">Opportunity</th>
                            <th className="px-4 py-3">Sponsor</th>
                            <th className="px-4 py-3">Support type</th>
                            <th className="px-4 py-3">Stage</th>
                            <th className="px-4 py-3 text-right">
                              Proposed value
                            </th>
                            <th className="px-4 py-3 text-right">
                              Confirmed value
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E8E6E0] text-[13px]">
                          {opportunities.map((opp) => (
                            <tr
                              key={opp.opportunity_id}
                              className="hover:bg-[#FAF9F6]"
                            >
                              <td className="px-4 py-3 font-medium text-[#202824]">
                                {opp.name || opp.opportunity_id}
                              </td>
                              <td className="px-4 py-3 text-[#525E58]">
                                {opp.sponsor_name || opp.sponsor_id}
                              </td>
                              <td className="px-4 py-3 text-[#525E58]">
                                {formatSupportType(opp.support_type)}
                              </td>
                              <td className="px-4 py-3 text-[#202824]">
                                {formatOpportunityStage(opp.stage)}
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums text-[#202824]">
                                {formatCurrencyInr(opp.proposed_value)}
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums font-medium text-[#315F52]">
                                {formatCurrencyInr(opp.confirmed_value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-6 py-10 text-center">
                      <p className="text-[13px] font-medium text-[#202824]">
                        No opportunities yet
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </DataStateWrapper>
          ) : null}

          {/* 5. Tasks tab */}
          {activeTab === 'tasks' ? (
            <div className="space-y-4">
              {!readOnly || isHistorical2025 ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={readOnly}
                    title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                    onClick={() => {
                      if (readOnly) return;
                      setTaskFormError(null);
                      setShowTaskForm((prev) => !prev);
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-[#264B40] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    New task
                  </button>
                </div>
              ) : null}

              {showTaskForm && !readOnly ? (
                <form
                  onSubmit={handleCreateTask}
                  className="space-y-3 rounded-md border border-[#D9D7D0] bg-white p-4"
                >
                  {taskFormError ? (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded border border-[#9B3B32]/30 bg-[#9B3B32]/5 px-3 py-2 text-[12px] text-[#9B3B32]"
                    >
                      <AlertCircle
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span>{taskFormError}</span>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label
                        htmlFor="campaign-task-title"
                        className="block text-[11px] font-medium text-[#788C83]"
                      >
                        Task title
                      </label>
                      <input
                        id="campaign-task-title"
                        type="text"
                        required
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        placeholder="Follow up on proposal"
                        className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="campaign-task-type"
                        className="block text-[11px] font-medium text-[#788C83]"
                      >
                        Task type
                      </label>
                      <select
                        id="campaign-task-type"
                        value={taskType}
                        onChange={(e) =>
                          setTaskType(e.target.value as CanonicalTaskType)
                        }
                        className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
                      >
                        {CANONICAL_TASK_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="campaign-task-owner"
                        className="block text-[11px] font-medium text-[#788C83]"
                      >
                        Owner member ID
                      </label>
                      <input
                        id="campaign-task-owner"
                        type="text"
                        required
                        value={taskOwnerId}
                        onChange={(e) => setTaskOwnerId(e.target.value)}
                        placeholder="e.g. TM-01"
                        className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] placeholder:font-sans focus:border-[#315F52] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="campaign-task-due"
                        className="block text-[11px] font-medium text-[#788C83]"
                      >
                        Due date
                      </label>
                      <input
                        id="campaign-task-due"
                        type="date"
                        required
                        value={taskDueAt}
                        onChange={(e) => setTaskDueAt(e.target.value)}
                        className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowTaskForm(false)}
                      className="h-8 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={taskSubmitting}
                      className="h-8 rounded-md bg-[#315F52] px-3.5 text-[12px] font-medium text-white hover:bg-[#264B40] disabled:opacity-60"
                    >
                      {taskSubmitting ? 'Saving...' : 'Create task'}
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
                    <div className="h-20 rounded bg-[#FAF9F6]" />
                  </div>
                }
              >
                <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
                  {tasks.length > 0 ? (
                    <ul className="divide-y divide-[#E8E6E0]">
                      {tasks.map((task) => {
                        const completed = task.status === 'done';
                        return (
                          <li
                            key={task.task_id}
                            className="flex items-center justify-between gap-4 px-5 py-3.5"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <button
                                type="button"
                                disabled={readOnly}
                                title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                                onClick={() => handleToggleTaskStatus(task)}
                                aria-label={
                                  completed
                                    ? `Mark "${task.title}" open`
                                    : `Mark "${task.title}" done`
                                }
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                                  completed
                                    ? 'border-[#315F52] bg-[#315F52] text-white'
                                    : 'border-[#D9D7D0] bg-white hover:border-[#315F52]'
                                } disabled:cursor-not-allowed disabled:opacity-60`}
                              >
                                {completed ? (
                                  <Check className="h-3 w-3" aria-hidden="true" />
                                ) : null}
                              </button>
                              <div className="min-w-0">
                                <p
                                  className={`truncate text-[13px] font-medium ${
                                    completed
                                      ? 'line-through text-[#788C83]'
                                      : 'text-[#202824]'
                                  }`}
                                >
                                  {task.title}
                                </p>
                                <p className="text-[12px] text-[#788C83]">
                                  {task.task_type.replace(/_/g, ' ')} ·{' '}
                                  {task.owner_name || task.owner_member_id}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-4 shrink-0 text-[12px]">
                              <span className="font-mono text-[#525E58] tabular-nums">
                                {task.due_at ? task.due_at.slice(0, 10) : '—'}
                              </span>
                              <span className="font-mono text-[11px] text-[#788C83]">
                                {task.status.replace(/_/g, ' ')}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="px-6 py-10 text-center">
                      <p className="text-[13px] font-medium text-[#202824]">
                        No tasks yet
                      </p>
                    </div>
                  )}
                </div>
              </DataStateWrapper>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
