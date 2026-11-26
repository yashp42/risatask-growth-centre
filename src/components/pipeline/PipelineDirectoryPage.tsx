import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  GitCommitHorizontal,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Table2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  READ_ONLY_2025_MESSAGE,
  isHistoricalReadOnlyEdition,
} from '../../lib/dateIst';
import {
  CANONICAL_BETS,
  formatBetDisplay,
  formatCurrencyInr,
  formatOpportunityStage,
  formatRecordClassLabel,
  formatSupportType,
} from '../../services/campaignsApi';
import {
  OPPORTUNITY_EDITION_BY_CLASS,
  OPPORTUNITY_RECORD_CLASS_OPTIONS,
  OPPORTUNITY_STAGE_OPTIONS,
  OPPORTUNITY_SUPPORT_TYPE_OPTIONS,
  PIPELINE_METRIC_DICTIONARY,
  canUserEditOpportunity,
  formatPipelineMetricValue,
  getDefaultPipelineEditionForClass,
  isClosedStage,
  isOpenStage,
  isOpportunityReadOnly,
} from '../../services/pipelineApi';
import type {
  ApiErrorInfo,
  DataLoadStatus,
  FilterOption,
  SortDirection,
} from '../../types/overview';
import {
  ALL_OPPORTUNITY_STAGES,
  CLOSED_OPPORTUNITY_STAGES,
  OPEN_OPPORTUNITY_STAGES,
  PIPELINE_SUMMARY_METRIC_IDS,
  type OpportunityEntity,
  type OpportunityRecordClass,
  type OpportunityStage,
  type PipelineDisplayMode,
  type PipelineFilters,
  type PipelineScopeView,
  type PipelineSortKey,
  type PipelineSummaryState,
} from '../../types/pipeline';
import type { UserPermissionContext } from '../../types/sponsors';
import type { PreviewStateMode } from '../overview/OverviewHeaderFilters';
import { DataStateWrapper } from '../ui/DataStateWrapper';
import { InfoHint } from '../ui/InfoHint';
import { SelectControl } from '../ui/SelectControl';

interface PipelineDirectoryPageProps {
  filters: PipelineFilters;
  onChangeFilters: (next: PipelineFilters) => void;
  opportunities: OpportunityEntity[];
  summary: PipelineSummaryState;
  ownerOptions: FilterOption[];
  campaignOptions: FilterOption[];
  categoryOptions: FilterOption[];
  permissions: UserPermissionContext;
  status: DataLoadStatus;
  error: ApiErrorInfo | null;
  onRetry: () => void;
  onRefresh: () => void;
  onCreateOpportunity: () => void;
  onUpdateStage: (opportunity: OpportunityEntity) => void;
  onOpenOpportunity: (opportunity: OpportunityEntity) => void;
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

const TABLE_COLUMNS: ReadonlyArray<{
  key: PipelineSortKey;
  label: string;
  align: 'left' | 'right';
}> = [
  { key: 'name', label: 'Opportunity', align: 'left' },
  { key: 'sponsor_name', label: 'Sponsor', align: 'left' },
  { key: 'stage', label: 'Stage', align: 'left' },
  { key: 'support_type', label: 'Support type', align: 'left' },
  { key: 'proposed_value', label: 'Proposed value', align: 'right' },
  { key: 'confirmed_value', label: 'Confirmed value', align: 'right' },
  { key: 'owner_member_id', label: 'Owner', align: 'left' },
  { key: 'originating_campaign_id', label: 'Campaign', align: 'left' },
  { key: 'bet_id', label: 'Bet', align: 'left' },
  { key: 'updated_at', label: 'Last stage update', align: 'left' },
];

function formatDateShort(ts?: string | null): string {
  if (!ts) return '—';
  return ts.slice(0, 10);
}

export function PipelineDirectoryPage({
  filters,
  onChangeFilters,
  opportunities,
  summary,
  ownerOptions,
  campaignOptions,
  categoryOptions,
  permissions,
  status,
  error,
  onRetry,
  onRefresh,
  onCreateOpportunity,
  onUpdateStage,
  onOpenOpportunity,
  showDevControls,
  previewMode,
  onChangePreviewMode,
}: PipelineDirectoryPageProps) {
  const [scopeView, setScopeView] = useState<PipelineScopeView>('active');
  const [displayMode, setDisplayMode] = useState<PipelineDisplayMode>('board');
  const [sortKey, setSortKey] = useState<PipelineSortKey>('updated_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const isHistorical2025 = isHistoricalReadOnlyEdition(
    filters.edition_id,
    filters.record_class
  );
  const roleAllowsWrite =
    !permissions.verified_by_server || permissions.can_write_sponsors;
  const canCreate = !isHistorical2025 && roleAllowsWrite;

  const editionOptions = OPPORTUNITY_EDITION_BY_CLASS[filters.record_class];

  // Scope filter: active pipeline vs outcomes vs all stages.
  // If user selects an explicit stage in the stage dropdown, respect it directly.
  const scopedOpportunities = useMemo(() => {
    return opportunities.filter((opp) => {
      const stage = opp.current_stage_version?.stage;
      if (filters.stage !== 'all') {
        return stage === filters.stage;
      }
      if (scopeView === 'active') return isOpenStage(stage);
      if (scopeView === 'outcomes') return isClosedStage(stage);
      return true;
    });
  }, [opportunities, filters.stage, scopeView]);

  const boardStages = useMemo<ReadonlyArray<OpportunityStage>>(() => {
    if (filters.stage !== 'all') {
      return [filters.stage as OpportunityStage];
    }
    if (scopeView === 'active') return OPEN_OPPORTUNITY_STAGES;
    if (scopeView === 'outcomes') return CLOSED_OPPORTUNITY_STAGES;
    return ALL_OPPORTUNITY_STAGES;
  }, [filters.stage, scopeView]);

  const sortedTableRows = useMemo(() => {
    if (scopedOpportunities.length === 0) return [];
    const copy = [...scopedOpportunities];
    const dir = sortDirection === 'asc' ? 1 : -1;

    copy.sort((a, b) => {
      const getVal = (opp: OpportunityEntity): string | number | null => {
        const cur = opp.current_stage_version;
        switch (sortKey) {
          case 'name':
            return opp.name || opp.opportunity_id;
          case 'sponsor_name':
            return opp.sponsor_name || opp.sponsor_id;
          case 'stage':
            return cur?.stage ?? null;
          case 'support_type':
            return opp.support_type;
          case 'proposed_value':
            return cur?.proposed_value ?? null;
          case 'confirmed_value':
            return cur?.stage === 'partner_confirmed'
              ? cur?.confirmed_value ?? null
              : null;
          case 'owner_member_id':
            return cur?.owner_name || cur?.owner_member_id || null;
          case 'originating_campaign_id':
            return (
              opp.originating_campaign_name ||
              opp.originating_campaign_id ||
              null
            );
          case 'bet_id':
            return opp.bet_id ?? null;
          case 'updated_at':
            return cur?.valid_from ?? cur?.created_at ?? opp.created_at ?? null;
        }
      };

      const av = getVal(a);
      const bv = getVal(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });

    return copy;
  }, [scopedOpportunities, sortKey, sortDirection]);

  const handleSort = (key: PipelineSortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection(
        key === 'proposed_value' ||
          key === 'confirmed_value' ||
          key === 'updated_at'
          ? 'desc'
          : 'asc'
      );
    }
  };

  const skeleton = (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      {[0, 1, 2, 3].map((col) => (
        <div
          key={col}
          className="rounded-md border border-[#D9D7D0] bg-white p-4"
        >
          <div className="h-4 w-28 rounded bg-[#E8E6E0]" />
          <div className="mt-4 space-y-3">
            <div className="h-24 rounded bg-[#FAF9F6]" />
            <div className="h-24 rounded bg-[#FAF9F6]" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-8 pb-8">
      {/* Header */}
      <section className="border-b border-[#D9D7D0] pb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-[#202824]">
              Pipeline
            </h1>
            <p className="mt-1 text-[13px] text-[#525E58]">
              Commercial opportunities, stage progression, and deal outcomes.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-[#788C83]">
              <span>{formatRecordClassLabel(filters.record_class)}</span>
              <span aria-hidden="true">·</span>
              <span>{filters.edition_id}</span>
              <span aria-hidden="true">·</span>
              <span>As of {filters.as_of}</span>
              {isHistorical2025 ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-[#525E58]">
                    {READ_ONLY_2025_MESSAGE}
                  </span>
                </>
              ) : null}
              {summary.data_version !== null &&
              summary.data_version !== undefined ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>v{summary.data_version}</span>
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
                  aria-label="Developer preview pipeline data state"
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
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6] whitespace-nowrap"
            >
              <RefreshCw
                className="h-3.5 w-3.5 text-[#525E58]"
                aria-hidden="true"
              />
              Refresh
            </button>

            {roleAllowsWrite ? (
              <button
                type="button"
                onClick={onCreateOpportunity}
                disabled={!canCreate}
                title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#315F52] px-3.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#264B40] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                New opportunity
              </button>
            ) : null}
          </div>
        </div>

        {/* Summary Strip — strictly populated from POST /api/metrics/query */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          {PIPELINE_SUMMARY_METRIC_IDS.map((metricId) => {
            const meta = PIPELINE_METRIC_DICTIONARY[metricId];
            const result = summary.metrics[metricId];
            const formatted = formatPipelineMetricValue(result, meta.unit);
            const reasonHint =
              result && !result.computable && result.reason
                ? `${meta.formula} — ${result.reason}`
                : `${meta.formula}. ${meta.inclusion_exclusion}`;
            return (
              <div
                key={metricId}
                className="rounded-md border border-[#D9D7D0] bg-white px-3.5 py-3"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[11px] font-medium text-[#788C83]">
                    {meta.name}
                  </span>
                  <InfoHint
                    label={`${metricId} definition`}
                    content={reasonHint}
                  />
                </div>
                <p
                  className={`mt-1.5 font-mono text-[17px] font-semibold tabular-nums ${
                    metricId === 'M-02' || metricId === 'M-03'
                      ? 'text-[#315F52]'
                      : 'text-[#202824]'
                  }`}
                >
                  {formatted}
                </p>
              </div>
            );
          })}
        </div>

        {/* Filter Bar */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="pipeline-search"
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
                id="pipeline-search"
                type="text"
                value={filters.search}
                onChange={(e) =>
                  onChangeFilters({ ...filters, search: e.target.value })
                }
                placeholder="Search opportunity or sponsor..."
                className="h-9 w-full rounded-md border border-[#D9D7D0] bg-white pr-3 pl-8 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none"
              />
            </div>
          </div>

          <SelectControl
            id="pipeline-filter-record-class"
            label="Record class"
            value={filters.record_class}
            options={OPPORTUNITY_RECORD_CLASS_OPTIONS}
            onChange={(value) => {
              const nextClass = value as OpportunityRecordClass;
              onChangeFilters({
                ...filters,
                record_class: nextClass,
                edition_id: getDefaultPipelineEditionForClass(nextClass),
              });
            }}
          />

          <SelectControl
            id="pipeline-filter-edition"
            label="Festival edition"
            value={filters.edition_id}
            options={editionOptions}
            onChange={(edition_id) =>
              onChangeFilters({ ...filters, edition_id })
            }
          />

          <SelectControl
            id="pipeline-filter-stage"
            label="Stage"
            value={filters.stage}
            options={OPPORTUNITY_STAGE_OPTIONS}
            onChange={(stage) => onChangeFilters({ ...filters, stage })}
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SelectControl
            id="pipeline-filter-owner"
            label="Owner"
            value={filters.owner_member_id}
            options={ownerOptions}
            onChange={(owner_member_id) =>
              onChangeFilters({ ...filters, owner_member_id })
            }
          />

          <SelectControl
            id="pipeline-filter-campaign"
            label="Originating campaign"
            value={filters.originating_campaign_id}
            options={campaignOptions}
            onChange={(originating_campaign_id) =>
              onChangeFilters({ ...filters, originating_campaign_id })
            }
          />

          <SelectControl
            id="pipeline-filter-bet"
            label="Strategic bet"
            value={filters.bet_id}
            options={BET_FILTER_OPTIONS}
            onChange={(bet_id) => onChangeFilters({ ...filters, bet_id })}
          />

          <SelectControl
            id="pipeline-filter-support"
            label="Support type"
            value={filters.support_type}
            options={OPPORTUNITY_SUPPORT_TYPE_OPTIONS}
            onChange={(support_type) =>
              onChangeFilters({ ...filters, support_type })
            }
          />

          <SelectControl
            id="pipeline-filter-category"
            label="Category"
            value={filters.category_id}
            options={categoryOptions}
            onChange={(category_id) =>
              onChangeFilters({ ...filters, category_id })
            }
          />
        </div>

        {/* Scope & View Toggles */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-1">
          <div
            role="group"
            aria-label="Pipeline stage scope"
            className="inline-flex rounded-md border border-[#D9D7D0] bg-[#FAF9F6] p-0.5"
          >
            {(
              [
                { id: 'active', label: 'Active pipeline' },
                { id: 'outcomes', label: 'Confirmed & closed' },
                { id: 'all', label: 'All stages' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setScopeView(opt.id);
                  if (filters.stage !== 'all') {
                    onChangeFilters({ ...filters, stage: 'all' });
                  }
                }}
                className={`rounded px-3 py-1 text-[12px] font-medium transition-colors duration-150 whitespace-nowrap ${
                  scopeView === opt.id && filters.stage === 'all'
                    ? 'bg-white text-[#202824] shadow-xs'
                    : 'text-[#525E58] hover:text-[#202824]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div
            role="group"
            aria-label="Pipeline display view"
            className="inline-flex rounded-md border border-[#D9D7D0] bg-[#FAF9F6] p-0.5"
          >
            <button
              type="button"
              onClick={() => setDisplayMode('board')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-[12px] font-medium transition-colors duration-150 whitespace-nowrap ${
                displayMode === 'board'
                  ? 'bg-white text-[#202824] shadow-xs'
                  : 'text-[#525E58] hover:text-[#202824]'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
              Board
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('table')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-[12px] font-medium transition-colors duration-150 whitespace-nowrap ${
                displayMode === 'table'
                  ? 'bg-white text-[#202824] shadow-xs'
                  : 'text-[#525E58] hover:text-[#202824]'
              }`}
            >
              <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
              Table
            </button>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section aria-label="Pipeline opportunities">
        <DataStateWrapper
          status={status}
          error={error}
          onRetry={onRetry}
          loadingSkeleton={skeleton}
        >
          {scopedOpportunities.length === 0 ? (
            <div className="rounded-md border border-[#D9D7D0] bg-white px-6 py-12 text-center">
              <p className="text-[13px] font-medium text-[#202824]">
                No opportunities yet
              </p>
              {roleAllowsWrite ? (
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={!canCreate}
                    title={
                      isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined
                    }
                    onClick={onCreateOpportunity}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 py-1.5 text-[12px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus
                      className="h-3.5 w-3.5 text-[#315F52]"
                      aria-hidden="true"
                    />
                    Create opportunity
                  </button>
                </div>
              ) : null}
            </div>
          ) : displayMode === 'board' ? (
            <div
              className={`grid grid-cols-1 gap-4 ${
                boardStages.length === 1
                  ? 'md:grid-cols-1'
                  : boardStages.length === 3
                    ? 'md:grid-cols-3'
                    : 'md:grid-cols-2 xl:grid-cols-4'
              }`}
            >
              {boardStages.map((stageKey) => {
                const columnItems = scopedOpportunities.filter(
                  (opp) => opp.current_stage_version?.stage === stageKey
                );
                return (
                  <div
                    key={stageKey}
                    className="flex flex-col rounded-md border border-[#D9D7D0] bg-[#FAF9F6]/70"
                  >
                    <div className="flex items-center justify-between border-b border-[#D9D7D0] bg-white px-3.5 py-2.5 rounded-t-md">
                      <span
                        className={`text-[12px] font-semibold ${
                          stageKey === 'partner_confirmed'
                            ? 'text-[#315F52]'
                            : stageKey === 'lost' || stageKey === 'withdrawn'
                              ? 'text-[#9B3B32]'
                              : 'text-[#202824]'
                        }`}
                      >
                        {formatOpportunityStage(stageKey)}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[#788C83]">
                        {columnItems.length}
                      </span>
                    </div>

                    <div className="space-y-2.5 p-2.5">
                      {columnItems.length > 0 ? (
                        columnItems.map((opp) => {
                          const cur = opp.current_stage_version;
                          const readOnly = isOpportunityReadOnly(opp);
                          const editable = canUserEditOpportunity(
                            opp,
                            permissions
                          );
                          const updatedAt =
                            cur?.valid_from ??
                            cur?.created_at ??
                            opp.created_at;

                          return (
                            <article
                              key={opp.opportunity_id}
                              className="rounded-md border border-[#D9D7D0] bg-white p-3.5 transition-colors duration-150 hover:border-[#315F52]/50"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-[11px] font-medium text-[#788C83] truncate">
                                  {opp.sponsor_name || opp.sponsor_id}
                                </p>
                                <span className="font-mono text-[11px] text-[#525E58] shrink-0">
                                  {formatSupportType(opp.support_type)}
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={() => onOpenOpportunity(opp)}
                                className="mt-1 block text-left text-[14px] font-semibold leading-snug text-[#202824] hover:text-[#315F52] hover:underline"
                              >
                                {opp.name || opp.opportunity_id}
                              </button>

                              <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-[#E8E6E0] pt-2">
                                <div>
                                  <span className="block text-[10px] text-[#788C83]">
                                    {cur?.stage === 'partner_confirmed'
                                      ? 'Signed value'
                                      : 'Proposed face value'}
                                  </span>
                                  <span
                                    className={`font-mono text-[14px] font-semibold tabular-nums ${
                                      cur?.stage === 'partner_confirmed'
                                        ? 'text-[#315F52]'
                                        : 'text-[#202824]'
                                    }`}
                                  >
                                    {cur?.stage === 'partner_confirmed'
                                      ? formatCurrencyInr(cur?.confirmed_value)
                                      : formatCurrencyInr(cur?.proposed_value)}
                                  </span>
                                </div>
                                <span className="font-mono text-[11px] text-[#788C83] tabular-nums">
                                  {formatDateShort(updatedAt)}
                                </span>
                              </div>

                              <dl className="mt-2.5 space-y-1 text-[11px] text-[#525E58]">
                                <div className="flex items-center justify-between gap-2">
                                  <dt className="text-[#788C83]">Owner</dt>
                                  <dd className="truncate font-medium text-[#202824]">
                                    {cur?.owner_name ||
                                      cur?.owner_member_id ||
                                      '—'}
                                  </dd>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <dt className="text-[#788C83]">Contact</dt>
                                  <dd className="truncate">
                                    {opp.primary_contact_name ||
                                      opp.primary_contact_id ||
                                      '—'}
                                  </dd>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <dt className="text-[#788C83]">Campaign</dt>
                                  <dd className="truncate">
                                    {opp.originating_campaign_name ||
                                      opp.originating_campaign_id ||
                                      '—'}
                                  </dd>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <dt className="text-[#788C83]">Bet</dt>
                                  <dd className="truncate font-mono">
                                    {opp.bet_id
                                      ? formatBetDisplay(
                                          opp.bet_id,
                                          opp.bet_name
                                        )
                                      : '—'}
                                  </dd>
                                </div>
                              </dl>

                              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#E8E6E0] pt-2.5">
                                {editable || (isHistorical2025 && roleAllowsWrite) ? (
                                  <button
                                    type="button"
                                    disabled={!editable || isHistorical2025}
                                    title={
                                      isHistorical2025
                                        ? READ_ONLY_2025_MESSAGE
                                        : undefined
                                    }
                                    onClick={() => onUpdateStage(opp)}
                                    className="inline-flex items-center gap-1 text-[12px] font-medium text-[#525E58] hover:text-[#202824] disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <GitCommitHorizontal
                                      className="h-3.5 w-3.5"
                                      aria-hidden="true"
                                    />
                                    Update stage
                                  </button>
                                ) : (
                                  <span className="font-mono text-[11px] text-[#788C83]">
                                    {readOnly ? 'Read-only' : ''}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onOpenOpportunity(opp)}
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
                          No opportunities
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
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
                            className={`px-4 py-3 text-[12px] font-medium text-[#525E58] whitespace-nowrap ${
                              col.align === 'right' ? 'text-right' : 'text-left'
                            }`}
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
                    {sortedTableRows.map((opp) => {
                      const cur = opp.current_stage_version;
                      const editable = canUserEditOpportunity(opp, permissions);
                      const updatedAt =
                        cur?.valid_from ?? cur?.created_at ?? opp.created_at;
                      return (
                        <tr
                          key={opp.opportunity_id}
                          className="transition-colors duration-150 hover:bg-[#FAF9F6]"
                        >
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => onOpenOpportunity(opp)}
                              className="text-left font-medium text-[#202824] hover:text-[#315F52] hover:underline"
                            >
                              {opp.name || opp.opportunity_id}
                            </button>
                            {opp.primary_contact_name ? (
                              <span className="mt-0.5 block text-[11px] text-[#788C83]">
                                {opp.primary_contact_name}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-[#202824] whitespace-nowrap">
                            {opp.sponsor_name || opp.sponsor_id}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={
                                cur?.stage === 'partner_confirmed'
                                  ? 'font-medium text-[#315F52]'
                                  : cur?.stage === 'lost' ||
                                      cur?.stage === 'withdrawn'
                                    ? 'font-medium text-[#9B3B32]'
                                    : 'text-[#202824]'
                              }
                            >
                              {formatOpportunityStage(cur?.stage)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[#525E58] whitespace-nowrap">
                            {formatSupportType(opp.support_type)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-[#202824] whitespace-nowrap">
                            {formatCurrencyInr(cur?.proposed_value)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums font-medium text-[#315F52] whitespace-nowrap">
                            {cur?.stage === 'partner_confirmed'
                              ? formatCurrencyInr(cur?.confirmed_value)
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-[#525E58] whitespace-nowrap">
                            {cur?.owner_name || cur?.owner_member_id || '—'}
                          </td>
                          <td className="px-4 py-3 text-[#525E58] whitespace-nowrap">
                            {opp.originating_campaign_name ||
                              opp.originating_campaign_id ||
                              '—'}
                          </td>
                          <td className="px-4 py-3 font-mono text-[12px] text-[#525E58] whitespace-nowrap">
                            {opp.bet_id || '—'}
                          </td>
                          <td className="px-4 py-3 font-mono text-[12px] text-[#788C83] tabular-nums whitespace-nowrap">
                            {formatDateShort(updatedAt)}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-3">
                              {editable || (isHistorical2025 && roleAllowsWrite) ? (
                                <button
                                  type="button"
                                  disabled={!editable || isHistorical2025}
                                  title={
                                    isHistorical2025
                                      ? READ_ONLY_2025_MESSAGE
                                      : undefined
                                  }
                                  onClick={() => onUpdateStage(opp)}
                                  className="text-[12px] font-medium text-[#525E58] hover:text-[#202824] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Stage
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => onOpenOpportunity(opp)}
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
          )}
        </DataStateWrapper>
      </section>
    </div>
  );
}
