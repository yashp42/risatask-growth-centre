import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  READ_ONLY_2025_MESSAGE,
  isHistoricalReadOnlyEdition,
} from '../../lib/dateIst';
import {
  CAMPAIGN_EDITION_BY_CLASS,
  CAMPAIGN_METRIC_DICTIONARY,
  CAMPAIGN_RECORD_CLASS_OPTIONS,
  CAMPAIGN_STATUS_OPTIONS,
  CANONICAL_BETS,
  CANONICAL_CHANNELS,
  formatBetDisplay,
  formatCampaignStatus,
  formatChannelDisplay,
  formatMetricValue,
  formatRecordClassLabel,
  getDefaultEditionForClass,
  isCampaignReadOnly,
} from '../../services/campaignsApi';
import type {
  CampaignEntity,
  CampaignMetricId,
  CampaignPortfolioFilters,
  CampaignPortfolioRow,
  CampaignPortfolioSortKey,
  CampaignPortfolioSummary,
  CampaignRecordClass,
  MetricQueryResult,
} from '../../types/campaigns';
import type {
  ApiErrorInfo,
  DataLoadStatus,
  FilterOption,
  SortDirection,
} from '../../types/overview';
import type { PreviewStateMode } from '../overview/OverviewHeaderFilters';
import { DataStateWrapper } from '../ui/DataStateWrapper';
import { InfoHint } from '../ui/InfoHint';
import { SelectControl } from '../ui/SelectControl';

interface CampaignPortfolioPageProps {
  filters: CampaignPortfolioFilters;
  onChangeFilters: (next: CampaignPortfolioFilters) => void;
  rows: CampaignPortfolioRow[];
  summary: CampaignPortfolioSummary;
  ownerOptions: FilterOption[];
  status: DataLoadStatus;
  error: ApiErrorInfo | null;
  onRetry: () => void;
  onRefresh: () => void;
  onCreateCampaign: () => void;
  onEditCampaign: (campaign: CampaignEntity) => void;
  onOpenCampaign: (campaign: CampaignEntity) => void;
  showDevControls: boolean;
  previewMode: PreviewStateMode;
  onChangePreviewMode: (mode: PreviewStateMode) => void;
}

const CHANNEL_FILTER_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All channels' },
  ...CANONICAL_CHANNELS.map((ch) => ({
    value: ch.channel_id,
    label: ch.is_active ? ch.label : `${ch.label} — inactive`,
  })),
];

const BET_FILTER_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All bets' },
  ...CANONICAL_BETS.map((b) => ({
    value: b.bet_id,
    label: `${b.bet_id} · ${b.name}`,
  })),
];

const COLUMNS: ReadonlyArray<{
  key: CampaignPortfolioSortKey;
  label: string;
  align: 'left' | 'right';
  metricId?: CampaignMetricId;
}> = [
  { key: 'name', label: 'Campaign', align: 'left' },
  { key: 'channel_id', label: 'Channel', align: 'left' },
  { key: 'bet_id', label: 'Bet', align: 'left' },
  { key: 'owner_member_id', label: 'Owner', align: 'left' },
  { key: 'status', label: 'Status', align: 'left' },
  { key: 'M-23', label: 'Response rate', align: 'right', metricId: 'M-23' },
  { key: 'M-11', label: 'Meeting rate', align: 'right', metricId: 'M-11' },
  { key: 'M-13', label: 'Win rate', align: 'right', metricId: 'M-13' },
  { key: 'M-09', label: 'Confirmed', align: 'right', metricId: 'M-09' },
  { key: 'M-02', label: 'Signed value', align: 'right', metricId: 'M-02' },
  { key: 'M-17', label: 'Handoff leak', align: 'right', metricId: 'M-17' },
];

function MetricCell({
  result,
  highlight = false,
  error = false,
}: {
  result?: MetricQueryResult;
  highlight?: boolean;
  error?: boolean;
}) {
  if (error) {
    return (
      <span className="font-mono text-[12px] text-[#788C83]">Unavailable</span>
    );
  }
  if (!result) {
    return <span className="font-mono text-[#788C83]">—</span>;
  }
  if (!result.computable || result.value === null) {
    return (
      <span
        title={result.reason ?? 'Not computable'}
        className="font-mono text-[12px] text-[#788C83]"
      >
        Not computable
      </span>
    );
  }

  const formatted = formatMetricValue(result);
  const ratioDetail =
    result.unit === 'ratio' &&
    result.numerator !== null &&
    result.denominator !== null
      ? `${result.numerator}/${result.denominator}`
      : null;

  return (
    <div className="inline-flex flex-col items-end">
      <span
        className={`font-mono tabular-nums ${
          highlight ? 'font-medium text-[#315F52]' : 'text-[#202824]'
        }`}
      >
        {formatted}
      </span>
      {ratioDetail ? (
        <span className="font-mono text-[11px] tabular-nums text-[#788C83]">
          {ratioDetail}
        </span>
      ) : null}
    </div>
  );
}

export function CampaignPortfolioPage({
  filters,
  onChangeFilters,
  rows,
  summary,
  ownerOptions,
  status,
  error,
  onRetry,
  onRefresh,
  onCreateCampaign,
  onEditCampaign,
  onOpenCampaign,
  showDevControls,
  previewMode,
  onChangePreviewMode,
}: CampaignPortfolioPageProps) {
  const [sortKey, setSortKey] = useState<CampaignPortfolioSortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const isHistoricalView = isHistoricalReadOnlyEdition(
    filters.edition_id,
    filters.record_class
  );
  const editionOptions = CAMPAIGN_EDITION_BY_CLASS[filters.record_class];

  const handleSort = (key: CampaignPortfolioSortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection(
        key === 'name' ||
          key === 'channel_id' ||
          key === 'bet_id' ||
          key === 'owner_member_id' ||
          key === 'status'
          ? 'asc'
          : 'desc'
      );
    }
  };

  const sortedRows = useMemo(() => {
    if (rows.length === 0) return [];
    const copy = [...rows];
    const dir = sortDirection === 'asc' ? 1 : -1;

    copy.sort((a, b) => {
      const getVal = (row: CampaignPortfolioRow): string | number | null => {
        switch (sortKey) {
          case 'name':
            return row.campaign.name;
          case 'channel_id':
            return formatChannelDisplay(
              row.campaign.channel_id,
              row.campaign.channel_name
            );
          case 'bet_id':
            return row.campaign.bet_id ?? null;
          case 'owner_member_id':
            return (
              row.campaign.owner_name ?? row.campaign.owner_member_id ?? null
            );
          case 'status':
            return row.campaign.status;
          case 'M-23':
          case 'M-11':
          case 'M-13':
          case 'M-09':
          case 'M-02':
          case 'M-17': {
            const m = row.metrics[sortKey];
            return m && m.computable ? m.value : null;
          }
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
  }, [rows, sortKey, sortDirection]);

  const skeleton = (
    <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
      <div className="border-b border-[#E8E6E0] bg-[#FAF9F6] px-4 py-3">
        <div className="h-3.5 w-full rounded bg-[#E8E6E0]" />
      </div>
      {[0, 1, 2, 3].map((idx) => (
        <div
          key={idx}
          className="flex items-center gap-4 border-b border-[#E8E6E0] px-4 py-3.5 last:border-b-0"
        >
          <div className="h-3.5 w-44 rounded bg-[#E8E6E0]" />
          <div className="h-3.5 w-24 rounded bg-[#F3F1EB]" />
          <div className="ml-auto h-3.5 w-20 rounded bg-[#E8E6E0]" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-8 pb-8">
      {/* Page header */}
      <section className="border-b border-[#D9D7D0] pb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-[#202824]">
              Campaigns
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-[#788C83]">
              <span>{formatRecordClassLabel(filters.record_class)}</span>
              <span aria-hidden="true">·</span>
              <span>{filters.edition_id}</span>
              <span aria-hidden="true">·</span>
              <span>As of {filters.as_of}</span>
              {summary.data_version !== null && summary.data_version !== undefined ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>v{summary.data_version}</span>
                </>
              ) : null}
              {isHistoricalView ? (
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
                  aria-label="Developer preview campaigns data state"
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
              <RefreshCw className="h-3.5 w-3.5 text-[#525E58]" aria-hidden="true" />
              Refresh
            </button>

            <button
              type="button"
              onClick={onCreateCampaign}
              disabled={isHistoricalView}
              title={isHistoricalView ? READ_ONLY_2025_MESSAGE : undefined}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#315F52] px-3.5 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#264B40] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New campaign
            </button>
          </div>
        </div>

        {/* Search & filter controls */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="campaigns-search"
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
                id="campaigns-search"
                type="text"
                value={filters.search}
                onChange={(e) =>
                  onChangeFilters({ ...filters, search: e.target.value })
                }
                placeholder="Search campaigns..."
                className="h-9 w-full rounded-md border border-[#D9D7D0] bg-white pr-3 pl-8 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none"
              />
            </div>
          </div>

          <SelectControl
            id="campaigns-filter-record-class"
            label="Record class"
            value={filters.record_class}
            options={CAMPAIGN_RECORD_CLASS_OPTIONS}
            onChange={(value) => {
              const nextClass = value as CampaignRecordClass;
              onChangeFilters({
                ...filters,
                record_class: nextClass,
                edition_id: getDefaultEditionForClass(nextClass),
              });
            }}
          />

          <SelectControl
            id="campaigns-filter-edition"
            label="Festival edition"
            value={filters.edition_id}
            options={editionOptions}
            onChange={(edition_id) =>
              onChangeFilters({ ...filters, edition_id })
            }
          />

          <div className="flex flex-col gap-1">
            <label
              htmlFor="campaigns-as-of"
              className="text-[11px] font-medium text-[#788C83]"
            >
              As-of date
            </label>
            <input
              id="campaigns-as-of"
              type="date"
              value={filters.as_of}
              onChange={(e) =>
                onChangeFilters({
                  ...filters,
                  as_of: e.target.value || filters.as_of,
                })
              }
              className="h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectControl
            id="campaigns-filter-channel"
            label="Channel"
            value={filters.channel_id}
            options={CHANNEL_FILTER_OPTIONS}
            onChange={(channel_id) =>
              onChangeFilters({ ...filters, channel_id })
            }
          />

          <SelectControl
            id="campaigns-filter-bet"
            label="Strategic bet"
            value={filters.bet_id}
            options={BET_FILTER_OPTIONS}
            onChange={(bet_id) => onChangeFilters({ ...filters, bet_id })}
          />

          <SelectControl
            id="campaigns-filter-owner"
            label="Owner"
            value={filters.owner_member_id}
            options={ownerOptions}
            onChange={(owner_member_id) =>
              onChangeFilters({ ...filters, owner_member_id })
            }
          />

          <SelectControl
            id="campaigns-filter-status"
            label="Status"
            value={filters.status}
            options={CAMPAIGN_STATUS_OPTIONS}
            onChange={(nextStatus) =>
              onChangeFilters({ ...filters, status: nextStatus })
            }
          />
        </div>
      </section>

      {/* Summary indicators */}
      <section aria-label="Campaign portfolio summary">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
            <p className="text-[12px] font-medium text-[#788C83]">
              Active campaigns
            </p>
            <p className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-[#202824] tabular-nums">
              {summary.active_campaigns_count !== null
                ? summary.active_campaigns_count
                : '—'}
            </p>
          </div>

          <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#788C83]">
                <span>Open pipeline value</span>
                <InfoHint
                  label="Definition of Open pipeline value (M-21)"
                  content={`${CAMPAIGN_METRIC_DICTIONARY['M-21'].formula}. ${CAMPAIGN_METRIC_DICTIONARY['M-21'].inclusion_exclusion}`}
                />
              </span>
              <span className="font-mono text-[11px] text-[#788C83]">M-21</span>
            </div>
            <p className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-[#202824] tabular-nums">
              {formatMetricValue(summary.open_pipeline_metric)}
            </p>
          </div>

          <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#788C83]">
                <span>Signed (confirmed) value</span>
                <InfoHint
                  label="Definition of Signed (confirmed) value (M-02)"
                  content={`${CAMPAIGN_METRIC_DICTIONARY['M-02'].formula}. ${CAMPAIGN_METRIC_DICTIONARY['M-02'].inclusion_exclusion}`}
                />
              </span>
              <span className="font-mono text-[11px] text-[#788C83]">M-02</span>
            </div>
            <p className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-[#315F52] tabular-nums">
              {formatMetricValue(summary.signed_value_metric)}
            </p>
          </div>
        </div>
      </section>

      {/* Portfolio table */}
      <section aria-label="Campaign performance table">
        <DataStateWrapper
          status={status}
          error={error}
          onRetry={onRetry}
          loadingSkeleton={skeleton}
        >
          <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6]">
                    {COLUMNS.map((col) => {
                      const isActive = sortKey === col.key;
                      const SortIcon = !isActive
                        ? ArrowUpDown
                        : sortDirection === 'asc'
                          ? ArrowUp
                          : ArrowDown;
                      const metricMeta = col.metricId
                        ? CAMPAIGN_METRIC_DICTIONARY[col.metricId]
                        : null;
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
                          <div
                            className={`inline-flex items-center gap-1 ${
                              col.align === 'right' ? 'justify-end' : ''
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
                              {col.metricId ? (
                                <span className="font-mono text-[10px] text-[#788C83]">
                                  {col.metricId}
                                </span>
                              ) : null}
                              <SortIcon
                                className={`h-3 w-3 ${
                                  isActive ? 'text-[#315F52]' : 'text-[#788C83]'
                                }`}
                                aria-hidden="true"
                              />
                            </button>
                            {metricMeta ? (
                              <InfoHint
                                label={`${metricMeta.metric_id} ${metricMeta.name}`}
                                content={`${metricMeta.formula}. ${metricMeta.inclusion_exclusion}`}
                              />
                            ) : null}
                          </div>
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
                  {sortedRows.length > 0 ? (
                    sortedRows.map(({ campaign, metrics, metrics_error }) => {
                      const readOnly = isCampaignReadOnly(campaign);
                      return (
                        <tr
                          key={campaign.campaign_id}
                          className="transition-colors duration-150 hover:bg-[#FAF9F6]"
                        >
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => onOpenCampaign(campaign)}
                              className="text-left font-medium text-[#202824] hover:text-[#315F52] hover:underline"
                            >
                              {campaign.name}
                            </button>
                            {readOnly ? (
                              <span className="ml-2 font-mono text-[11px] text-[#788C83]">
                                Read-only
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-[#525E58] whitespace-nowrap">
                            {formatChannelDisplay(
                              campaign.channel_id,
                              campaign.channel_name
                            )}
                          </td>
                          <td className="px-4 py-3 text-[#525E58] whitespace-nowrap">
                            {formatBetDisplay(
                              campaign.bet_id,
                              campaign.bet_name
                            )}
                          </td>
                          <td className="px-4 py-3 text-[#525E58] whitespace-nowrap">
                            {campaign.owner_name ||
                              campaign.owner_member_id ||
                              '—'}
                          </td>
                          <td className="px-4 py-3 text-[#202824] whitespace-nowrap">
                            {formatCampaignStatus(campaign.status)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <MetricCell
                              result={metrics['M-23']}
                              error={metrics_error}
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <MetricCell
                              result={metrics['M-11']}
                              error={metrics_error}
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <MetricCell
                              result={metrics['M-13']}
                              error={metrics_error}
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <MetricCell
                              result={metrics['M-09']}
                              error={metrics_error}
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <MetricCell
                              result={metrics['M-02']}
                              highlight
                              error={metrics_error}
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <MetricCell
                              result={metrics['M-17']}
                              error={metrics_error}
                            />
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-3">
                              {!readOnly || isHistoricalView ? (
                                <button
                                  type="button"
                                  disabled={isHistoricalView || readOnly}
                                  title={
                                    isHistoricalView
                                      ? READ_ONLY_2025_MESSAGE
                                      : undefined
                                  }
                                  onClick={() => onEditCampaign(campaign)}
                                  className="text-[12px] font-medium text-[#525E58] hover:text-[#202824] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Edit
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => onOpenCampaign(campaign)}
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
                    })
                  ) : (
                    <tr>
                      <td colSpan={12} className="px-6 py-10 text-center">
                        <p className="text-[13px] font-medium text-[#202824]">
                          No campaigns yet
                        </p>
                        <div className="mt-3">
                          <button
                            type="button"
                            disabled={isHistoricalView}
                            title={
                              isHistoricalView
                                ? READ_ONLY_2025_MESSAGE
                                : undefined
                            }
                            onClick={onCreateCampaign}
                            className="inline-flex items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 py-1.5 text-[12px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Plus
                              className="h-3.5 w-3.5 text-[#315F52]"
                              aria-hidden="true"
                            />
                            Create campaign
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </DataStateWrapper>
      </section>
    </div>
  );
}
