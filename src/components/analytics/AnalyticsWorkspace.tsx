import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  Download,
  Lock,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSeason } from '../../contexts/SeasonContext';
import { READ_ONLY_2025_MESSAGE, formatEditionSwitcherLabel } from '../../lib/dateIst';
import {
  ANALYTICS_CHANNEL_GROUP_OPTIONS,
  ANALYTICS_SCENARIO_OPTIONS,
  AnalyticsApiError,
  CANONICAL_BETS,
  fetchAnalyticsComparisonRows,
  fetchAnalyticsCoreMetrics,
  fetchAnalyticsFilterCatalog,
  fetchAnalyticsReferenceBundle,
  fetchAnalyticsWeeklyPacing,
  fetchChannelGroupFunnelComparison,
  getAnalyticsPermissionProfile,
} from '../../services/analyticsApi';
import {
  DEFAULT_UNVERIFIED_PERMISSIONS,
  fetchCurrentUserPermissions,
} from '../../services/sponsorsApi';
import type {
  AnalyticsComparisonScope,
  AnalyticsFilters,
  AnalyticsRecordClass,
  AnalyticsTab,
  KpiReferenceRecord,
  MetricReferenceRecord,
} from '../../types/analytics';
import type { ApiErrorInfo, FilterOption } from '../../types/overview';
import type { PreviewStateMode } from '../overview/OverviewHeaderFilters';
import { DataStateWrapper } from '../ui/DataStateWrapper';
import { SelectControl } from '../ui/SelectControl';
import { CampaignChannelComparisonSection } from './CampaignChannelComparisonSection';
import { FunnelDiagnosticsSection } from './FunnelDiagnosticsSection';
import { MetricExplorerSection } from './MetricExplorerSection';
import { PerformancePacingSection } from './PerformancePacingSection';
import { StrategyPipelineCapacitySection } from './StrategyPipelineCapacitySection';

interface AnalyticsWorkspaceProps {
  showDevControls: boolean;
  onOpenCampaign?: (campaignId: string) => void;
  onOpenCampaigns?: () => void;
  onOpenSponsors?: () => void;
  onOpenPipeline?: () => void;
}

const ANALYTICS_TABS: ReadonlyArray<{ id: AnalyticsTab; label: string }> = [
  { id: 'performance', label: 'Performance & pacing' },
  { id: 'funnel', label: 'Funnel diagnostics' },
  { id: 'campaigns_channels', label: 'Campaigns & channels' },
  { id: 'strategy_pipeline', label: 'Strategy, pipeline & capacity' },
  { id: 'explorer', label: 'Metric explorer' },
];

function readInitialAnalyticsUrlParams() {
  if (typeof window === 'undefined') {
    return {
      tab: 'performance' as AnalyticsTab,
      campaignId: 'all',
      channelGroup: 'all',
      betId: 'all',
      scenarioId: 'all',
      comparisonScope: 'channel' as AnalyticsComparisonScope,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const rawTab = params.get('analyticsTab');
  const validTab = ANALYTICS_TABS.some((t) => t.id === rawTab)
    ? (rawTab as AnalyticsTab)
    : 'performance';
  const rawScope = params.get('comparisonScope');
  return {
    tab: validTab,
    campaignId: params.get('campaignId') || 'all',
    channelGroup: params.get('channelGroup') || 'all',
    betId: params.get('betId') || 'all',
    scenarioId: params.get('scenarioId') || 'all',
    comparisonScope:
      rawScope === 'campaign'
        ? ('campaign' as AnalyticsComparisonScope)
        : ('channel' as AnalyticsComparisonScope),
  };
}

function getRecordClassBannerLabel(recordClass: AnalyticsRecordClass): string {
  if (recordClass === 'historical_synthetic') {
    return 'historical_synthetic (ED-2025, fictional, read-only)';
  }
  if (recordClass === 'live') {
    return 'live';
  }
  return 'simulated (2026 demo)';
}

export function AnalyticsWorkspace({
  showDevControls,
  onOpenCampaign,
  onOpenCampaigns,
  onOpenSponsors,
  onOpenPipeline,
}: AnalyticsWorkspaceProps) {
  const {
    editions,
    editionId,
    recordClass,
    asOf,
    isReadOnlyHistorical,
    setEditionId,
    setAsOf,
    resetToDefault,
  } = useSeason();

  const initialUrl = useMemo(() => readInitialAnalyticsUrlParams(), []);

  const [campaignId, setCampaignId] = useState<string>(initialUrl.campaignId);
  const [channelGroup, setChannelGroup] = useState<string>(initialUrl.channelGroup);
  const [betId, setBetId] = useState<string>(initialUrl.betId);
  const [scenarioId, setScenarioId] = useState<string>(initialUrl.scenarioId);
  const [activeTab, setActiveTab] = useState<AnalyticsTab>(initialUrl.tab);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(
    null
  );
  const [comparisonScope, setComparisonScope] =
    useState<AnalyticsComparisonScope>(initialUrl.comparisonScope);
  const [previewMode, setPreviewMode] = useState<PreviewStateMode>('default');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('analyticsTab', activeTab);
    url.searchParams.set('comparisonScope', comparisonScope);
    const setOrDelete = (k: string, val: string) => {
      if (val && val !== 'all') url.searchParams.set(k, val);
      else url.searchParams.delete(k);
    };
    setOrDelete('campaignId', campaignId);
    setOrDelete('channelGroup', channelGroup);
    setOrDelete('betId', betId);
    setOrDelete('scenarioId', scenarioId);
    window.history.replaceState(
      null,
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  }, [activeTab, comparisonScope, campaignId, channelGroup, betId, scenarioId]);

  useEffect(() => {
    if (!showDevControls && previewMode !== 'default') {
      setPreviewMode('default');
    }
  }, [showDevControls, previewMode]);

  const filters: AnalyticsFilters = useMemo(
    () => ({
      record_class: recordClass,
      edition_id: editionId,
      as_of: asOf,
      campaign_id: campaignId,
      channel_group: channelGroup,
      bet_id: betId,
      scenario_id: scenarioId,
    }),
    [recordClass, editionId, asOf, campaignId, channelGroup, betId, scenarioId]
  );

  const permissionsQuery = useQuery({
    queryKey: ['permissions', 'me'],
    queryFn: ({ signal }) => fetchCurrentUserPermissions(signal),
    staleTime: 60_000,
  });

  const permissions = permissionsQuery.data ?? DEFAULT_UNVERIFIED_PERMISSIONS;
  const permissionProfile = useMemo(
    () => getAnalyticsPermissionProfile(permissions),
    [permissions]
  );

  const catalogQuery = useQuery({
    queryKey: ['analytics', 'catalog', recordClass, editionId],
    queryFn: ({ signal }) =>
      fetchAnalyticsFilterCatalog(recordClass, editionId, signal),
    staleTime: 30_000,
  });

  const referenceQuery = useQuery({
    queryKey: ['analytics', 'references', recordClass, editionId, asOf],
    queryFn: ({ signal }) =>
      fetchAnalyticsReferenceBundle(recordClass, editionId, asOf, signal),
    staleTime: 30_000,
  });

  const referenceBundle = referenceQuery.data;
  const catalog = catalogQuery.data;

  useEffect(() => {
    const approved = referenceBundle?.approvedScenarios ?? [];
    if (approved.length > 0) {
      setSelectedScenarioId((prev) =>
        prev && approved.some((s) => s.scenario_id === prev)
          ? prev
          : approved[0].scenario_id
      );
    }
  }, [referenceBundle?.approvedScenarios]);

  const coreMetricsQuery = useQuery({
    queryKey: ['analytics', 'coreMetrics', filters, permissionProfile.isViewerRestricted, permissionProfile.canViewAnalytics],
    queryFn: ({ signal }) =>
      fetchAnalyticsCoreMetrics(filters, permissionProfile, signal),
    enabled:
      !(showDevControls && previewMode !== 'default') &&
      (!permissionProfile.verifiedByServer || permissionProfile.canViewAnalytics),
  });

  const pacingQuery = useQuery({
    queryKey: [
      'analytics',
      'pacing',
      filters,
      selectedScenarioId,
      referenceBundle?.gateWeeks.length ?? 0,
    ],
    queryFn: ({ signal }) =>
      fetchAnalyticsWeeklyPacing(
        filters,
        permissionProfile,
        referenceBundle?.gateWeeks ?? [],
        referenceBundle?.gateWeeklyPacing ?? [],
        referenceBundle?.gates ?? [],
        selectedScenarioId,
        signal
      ),
    enabled:
      Boolean(referenceBundle && referenceBundle.gateWeeks.length > 0) &&
      !(showDevControls && previewMode !== 'default') &&
      (!permissionProfile.verifiedByServer || permissionProfile.canViewAnalytics),
  });

  const channelFunnelQuery = useQuery({
    queryKey: ['analytics', 'channelFunnel', filters, permissionProfile.canViewAnalytics],
    queryFn: ({ signal }) =>
      fetchChannelGroupFunnelComparison(filters, permissionProfile, signal),
    enabled:
      activeTab === 'funnel' &&
      !(showDevControls && previewMode !== 'default') &&
      (!permissionProfile.verifiedByServer || permissionProfile.canViewAnalytics),
  });

  const comparisonQuery = useQuery({
    queryKey: [
      'analytics',
      'comparison',
      comparisonScope,
      filters,
      catalog?.campaigns.length ?? 0,
      permissionProfile.canViewAnalytics,
    ],
    queryFn: ({ signal }) =>
      fetchAnalyticsComparisonRows(
        comparisonScope,
        filters,
        catalog?.campaigns ?? [],
        permissionProfile,
        signal
      ),
    enabled:
      activeTab === 'campaigns_channels' &&
      !(showDevControls && previewMode !== 'default') &&
      (!permissionProfile.verifiedByServer || permissionProfile.canViewAnalytics),
  });

  const metricDefsById = useMemo(() => {
    const map = new Map<string, MetricReferenceRecord>();
    for (const def of referenceBundle?.metricDefinitions ?? []) {
      map.set(def.metric_id, def);
    }
    return map;
  }, [referenceBundle?.metricDefinitions]);

  const kpiDefsById = useMemo(() => {
    const map = new Map<string, KpiReferenceRecord>();
    for (const def of referenceBundle?.kpiDefinitions ?? []) {
      map.set(def.kpi_id, def);
    }
    return map;
  }, [referenceBundle?.kpiDefinitions]);

  const editionOptions = useMemo<FilterOption[]>(
    () =>
      editions.map((ed) => ({
        value: ed.edition_id,
        label: formatEditionSwitcherLabel(ed.edition_id, ed.name),
      })),
    [editions]
  );

  const campaignOptions = useMemo<FilterOption[]>(() => {
    return [
      { value: 'all', label: 'All campaigns' },
      ...(catalog?.campaigns ?? []).map((c) => ({
        value: c.campaign_id,
        label: c.name ? `${c.name} (${c.campaign_id})` : c.campaign_id,
      })),
    ];
  }, [catalog?.campaigns]);

  const betOptions = useMemo<FilterOption[]>(() => {
    return [
      { value: 'all', label: 'All strategic bets' },
      ...CANONICAL_BETS.map((b) => ({
        value: b.bet_id,
        label: `${b.bet_id} · ${b.name}`,
      })),
    ];
  }, []);

  const handleRefresh = useCallback(() => {
    setPreviewMode('default');
    void referenceQuery.refetch();
    void catalogQuery.refetch();
    void coreMetricsQuery.refetch();
    void pacingQuery.refetch();
    void channelFunnelQuery.refetch();
    void comparisonQuery.refetch();
  }, [
    referenceQuery,
    catalogQuery,
    coreMetricsQuery,
    pacingQuery,
    channelFunnelQuery,
    comparisonQuery,
  ]);

  const handleResetFilters = useCallback(() => {
    resetToDefault();
    setCampaignId('all');
    setChannelGroup('all');
    setBetId('all');
    setScenarioId('all');
  }, [resetToDefault]);

  const coreData = coreMetricsQuery.data;
  const coreMetrics = coreData?.results ?? {};
  const m30ByScenario = coreData?.m30ByScenario ?? {};
  const restrictedForbidden = coreData?.restrictedForbidden ?? false;

  const firstMetricWithVersion = Object.values(coreMetrics).find(
    (r) => r.data_version !== undefined && r.data_version !== null
  );
  const dataVersion = firstMetricWithVersion?.data_version ?? null;

  let loadStatus: 'loading' | 'error' | 'ready' = 'ready';
  let loadError: ApiErrorInfo | null = null;

  if (showDevControls && previewMode === 'loading') {
    loadStatus = 'loading';
  } else if (showDevControls && previewMode === 'error') {
    loadStatus = 'error';
    loadError = {
      code: 'METRICS_UNAVAILABLE',
      message: 'Analytics metrics could not be retrieved right now.',
      endpoint: '',
    };
  } else if (coreMetricsQuery.isLoading || referenceQuery.isLoading) {
    loadStatus = 'loading';
  } else if (coreMetricsQuery.error || coreData?.error) {
    loadStatus = 'error';
    const err = coreData?.error ?? coreMetricsQuery.error;
    loadError = {
      code: err instanceof AnalyticsApiError ? err.code : 'METRICS_ERROR',
      message:
        err instanceof Error ? err.message : 'Unable to retrieve analytics data.',
      endpoint: '/api/metrics/query',
    };
  }

  const loadingSkeleton = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((idx) => (
          <div
            key={idx}
            className="h-36 animate-pulse rounded-md border border-[#D9D7D0] bg-white p-4"
          />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-md border border-[#D9D7D0] bg-white" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Page Header & Actions */}
      <section
        aria-labelledby="analytics-heading"
        className="border-b border-[#D9D7D0] pb-6"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1
              id="analytics-heading"
              className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-[#202824]"
            >
              Analytics
            </h1>
            <p className="mt-1 text-[14px] text-[#525E58]">
              Performance pacing, funnel diagnostics, channel attribution, and
              strategic bet scorecards.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-[#788C83]">
              <span>{getRecordClassBannerLabel(recordClass)}</span>
              <span>·</span>
              <span>Edition: {editionId}</span>
              <span>·</span>
              <span>As of: {asOf}</span>
              {dataVersion !== null && dataVersion !== undefined ? (
                <>
                  <span>·</span>
                  <span>Data v{String(dataVersion)}</span>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {showDevControls ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed border-[#D9D7D0] bg-[#FAF9F6] px-2.5 py-1">
                <span className="font-mono text-[11px] text-[#788C83] whitespace-nowrap">
                  Dev state
                </span>
                <div
                  role="group"
                  aria-label="Developer preview analytics state"
                  className="inline-flex rounded border border-[#D9D7D0] bg-white p-0.5"
                >
                  {(['default', 'loading', 'error'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPreviewMode(mode)}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium capitalize transition-colors ${
                        previewMode === mode
                          ? 'bg-[#315F52] text-white'
                          : 'text-[#525E58] hover:text-[#202824]'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              disabled
              title="Audited analytics export requires a server-side export service and is unavailable in this release."
              className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-3 text-[13px] font-medium text-[#788C83]"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] font-medium text-[#202824] transition-colors hover:bg-[#FAF9F6]"
            >
              <RotateCcw
                className="h-3.5 w-3.5 text-[#525E58]"
                aria-hidden="true"
              />
              <span>Reset</span>
            </button>

            <button
              type="button"
              onClick={handleRefresh}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] font-medium text-[#202824] transition-colors hover:bg-[#FAF9F6]"
            >
              <RefreshCw
                className="h-3.5 w-3.5 text-[#525E58]"
                aria-hidden="true"
              />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Global Analytical Controls Bar (strictly mapped to Global SeasonContext + allowed metric filter keys) */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <SelectControl
            id="analytics-filter-edition"
            label="Season edition"
            value={editionId}
            options={editionOptions}
            onChange={(val) => {
              setEditionId(val);
              setCampaignId('all');
            }}
          />
          <div className="flex flex-col gap-1">
            <label
              htmlFor="analytics-filter-as-of"
              className="text-[11px] font-medium text-[#788C83] whitespace-nowrap"
            >
              As of date (IST)
            </label>
            <input
              id="analytics-filter-as-of"
              type="date"
              value={asOf}
              onChange={(e) => {
                if (e.target.value) {
                  setAsOf(e.target.value);
                }
              }}
              className="h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] font-medium text-[#202824] transition-colors duration-150 hover:border-[#788C83] focus:border-[#315F52] focus:outline-none"
            />
          </div>
          <SelectControl
            id="analytics-filter-channel-group"
            label="Channel group"
            value={channelGroup}
            options={ANALYTICS_CHANNEL_GROUP_OPTIONS}
            onChange={setChannelGroup}
          />
          <SelectControl
            id="analytics-filter-bet"
            label="Strategic bet"
            value={betId}
            options={betOptions}
            onChange={setBetId}
          />
          <SelectControl
            id="analytics-filter-campaign"
            label="Campaign"
            value={campaignId}
            options={campaignOptions}
            onChange={setCampaignId}
          />
          <SelectControl
            id="analytics-filter-scenario"
            label="Scenario (M-30)"
            value={scenarioId}
            options={ANALYTICS_SCENARIO_OPTIONS}
            onChange={setScenarioId}
          />
        </div>
      </section>

      {/* Role & Provenance Notices */}
      {permissionProfile.verifiedByServer &&
      !permissionProfile.canViewAnalytics ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-md border border-[#D9D7D0] bg-white p-5"
        >
          <Lock
            className="mt-0.5 h-4 w-4 shrink-0 text-[#9B3B32]"
            aria-hidden="true"
          />
          <div>
            <h2 className="text-[14px] font-semibold text-[#202824]">
              Analytics access restricted (403)
            </h2>
            <p className="mt-1 text-[13px] text-[#525E58]">
              Your current account does not hold an operational business or
              viewer role required for sponsorship analytics.
            </p>
          </div>
        </div>
      ) : (
        <>
          {permissionProfile.isViewerRestricted || restrictedForbidden ? (
            <div className="flex items-start gap-2.5 rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-4 py-3 text-[12px] text-[#525E58]">
              <Lock
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#788C83]"
                aria-hidden="true"
              />
              <span>
                Viewer role active: cash collections (M-01, M-06, M-07), B2 advance timing (M-25), and logged staff hours (M-27) are restricted.
              </span>
            </div>
          ) : null}

          {isReadOnlyHistorical ? (
            <div className="flex items-start gap-2.5 rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-4 py-3 text-[12px] text-[#525E58]">
              <AlertCircle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#788C83]"
                aria-hidden="true"
              />
              <span>
                {READ_ONLY_2025_MESSAGE}. Displaying ED-2025 (historical_synthetic) — payment collections and staff hours logs are absent and remain not computable rather than zero.
              </span>
            </div>
          ) : null}

          {/* Sub-navigation Tabs */}
          <nav
            aria-label="Analytics sections"
            className="flex flex-wrap gap-1 border-b border-[#D9D7D0]"
          >
            {ANALYTICS_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'border-[#315F52] text-[#202824]'
                      : 'border-transparent text-[#525E58] hover:text-[#202824]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Main Section Content */}
          <DataStateWrapper
            status={loadStatus}
            error={loadError}
            onRetry={handleRefresh}
            loadingSkeleton={loadingSkeleton}
          >
            {activeTab === 'performance' ? (
              <PerformancePacingSection
                metrics={coreMetrics}
                m30ByScenario={m30ByScenario}
                metricDefsById={metricDefsById}
                approvedScenarios={referenceBundle?.approvedScenarios ?? []}
                selectedScenarioId={selectedScenarioId}
                onSelectScenario={setSelectedScenarioId}
                weeklyPacing={pacingQuery.data?.points ?? []}
                latestPassedGateWeek={referenceBundle?.latestPassedGateWeek ?? null}
                cashGate={referenceBundle?.cashGate ?? null}
                weeklyPacingUnavailable={pacingQuery.data?.unavailable ?? false}
                scenariosAvailable={referenceBundle?.availability.scenarios ?? false}
                gatesAvailable={referenceBundle?.availability.gates ?? false}
                recordClass={recordClass}
                asOfDate={asOf}
                restrictedForbidden={restrictedForbidden}
                permissionProfile={permissionProfile}
                loading={coreMetricsQuery.isLoading}
              />
            ) : activeTab === 'funnel' ? (
              <FunnelDiagnosticsSection
                metrics={coreMetrics}
                channelGroupFunnel={channelFunnelQuery.data ?? []}
                channelFunnelLoading={channelFunnelQuery.isLoading}
                metricDefsById={metricDefsById}
                recordClass={recordClass}
                asOfDate={asOf}
                permissionProfile={permissionProfile}
                loading={coreMetricsQuery.isLoading}
                onOpenCampaigns={onOpenCampaigns}
                onOpenSponsors={onOpenSponsors}
                onOpenPipeline={onOpenPipeline}
              />
            ) : activeTab === 'campaigns_channels' ? (
              <CampaignChannelComparisonSection
                scope={comparisonScope}
                onChangeScope={setComparisonScope}
                rows={comparisonQuery.data ?? []}
                metricDefsById={metricDefsById}
                recordClass={recordClass}
                asOfDate={asOf}
                permissionProfile={permissionProfile}
                loading={comparisonQuery.isLoading || coreMetricsQuery.isLoading}
                onOpenCampaign={onOpenCampaign}
              />
            ) : activeTab === 'strategy_pipeline' ? (
              <StrategyPipelineCapacitySection
                metrics={coreMetrics}
                metricDefsById={metricDefsById}
                kpiDefsById={kpiDefsById}
                rules={referenceBundle?.rules ?? []}
                rulesAvailable={referenceBundle?.availability.rules ?? false}
                assumptions={referenceBundle?.assumptions ?? []}
                assumptionsAvailable={referenceBundle?.availability.assumptions ?? false}
                experiments={referenceBundle?.experiments ?? []}
                experimentResults={referenceBundle?.experimentResults ?? []}
                forecasts={referenceBundle?.forecasts ?? []}
                recordClass={recordClass}
                asOfDate={asOf}
                restrictedForbidden={restrictedForbidden}
                permissionProfile={permissionProfile}
                loading={coreMetricsQuery.isLoading}
                onOpenPipeline={onOpenPipeline}
              />
            ) : (
              <MetricExplorerSection
                metricDefinitions={referenceBundle?.metricDefinitions ?? []}
                kpiDefinitions={referenceBundle?.kpiDefinitions ?? []}
                metricsAvailable={referenceBundle?.availability.metrics ?? false}
                kpisAvailable={referenceBundle?.availability.kpis ?? false}
                coreResults={coreMetrics}
                filters={filters}
                permissionProfile={permissionProfile}
              />
            )}
          </DataStateWrapper>
        </>
      )}
    </div>
  );
}
