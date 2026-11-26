import { Lock, RefreshCw } from 'lucide-react';
import { useSeason } from '../../contexts/SeasonContext';
import {
  READ_ONLY_2025_MESSAGE,
  formatEditionSwitcherLabel,
} from '../../lib/dateIst';
import { DEFAULT_FILTER_OPTIONS } from '../../services/overviewApi';
import type {
  DataClassFilter,
  FilterOption,
  OverviewFilterState,
} from '../../types/overview';
import { SelectControl } from '../ui/SelectControl';

export type PreviewStateMode = 'default' | 'loading' | 'error';

interface OverviewHeaderFiltersProps {
  filters: OverviewFilterState;
  campaignOptions: FilterOption[];
  onChangeDataClass: (dataClass: DataClassFilter) => void;
  onChangeCampaignId: (campaignId: string) => void;
  showDevControls: boolean;
  previewMode: PreviewStateMode;
  onChangePreviewMode: (mode: PreviewStateMode) => void;
  onRefresh: () => void;
  asOfTimestamp: string | null;
}

export function OverviewHeaderFilters({
  filters,
  campaignOptions,
  onChangeDataClass,
  onChangeCampaignId,
  showDevControls,
  previewMode,
  onChangePreviewMode,
  onRefresh,
  asOfTimestamp,
}: OverviewHeaderFiltersProps) {
  const {
    editions,
    editionId,
    recordClass,
    asOf,
    isReadOnlyHistorical,
    setEditionId,
    setAsOf,
  } = useSeason();

  const editionOptions: FilterOption[] = editions.map((ed) => ({
    value: ed.edition_id,
    label: formatEditionSwitcherLabel(ed.edition_id, ed.name),
  }));

  return (
    <section
      aria-labelledby="overview-heading"
      className="border-b border-[#D9D7D0] pb-6"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1
              id="overview-heading"
              className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-[#202824]"
            >
              Growth overview
            </h1>
            {isReadOnlyHistorical ? (
              <span className="inline-flex items-center gap-1 rounded border border-[#D9D7D0] bg-[#FAF9F6] px-2 py-0.5 font-mono text-[11px] font-medium text-[#525E58]">
                <Lock className="h-3 w-3 text-[#788C83]" aria-hidden="true" />
                {READ_ONLY_2025_MESSAGE}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[14px] text-[#525E58]">
            Sponsorship performance, pacing gates, and rule status.{' '}
            <span className="font-mono text-[12px] text-[#788C83]">
              {editionId} · {recordClass} · As of {asOfTimestamp || asOf}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {showDevControls ? (
            <div className="flex items-center gap-2 rounded-md border border-dashed border-[#D9D7D0] bg-[#FAF9F6] px-2.5 py-1">
              <span className="font-mono text-[11px] text-[#788C83] whitespace-nowrap">
                Dev state
              </span>
              <div
                role="group"
                aria-label="Developer preview dashboard data state"
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
                    className={`rounded px-2.5 py-0.5 text-[12px] font-medium transition-colors duration-150 whitespace-nowrap ${
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

          <span className="font-mono text-[11px] text-[#788C83] tabular-nums whitespace-nowrap">
            As of {asOfTimestamp || asOf} · {recordClass}
          </span>

          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6] whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5 text-[#525E58]" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {/* Global filter bar bound to SeasonContext */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectControl
          id="filter-edition"
          label="Festival edition"
          value={editionId}
          options={editionOptions}
          onChange={(nextEditionId) => setEditionId(nextEditionId)}
        />

        <div className="flex flex-col gap-1">
          <label
            htmlFor="filter-as-of"
            className="text-[11px] font-medium text-[#788C83]"
          >
            As of date (IST)
          </label>
          <input
            id="filter-as-of"
            type="date"
            value={asOf}
            onChange={(e) => {
              if (e.target.value) setAsOf(e.target.value);
            }}
            className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
          />
        </div>

        <SelectControl
          id="filter-data-class"
          label="Support type view"
          value={filters.dataClass}
          options={DEFAULT_FILTER_OPTIONS.dataClasses}
          onChange={(value) => onChangeDataClass(value as DataClassFilter)}
        />

        <SelectControl
          id="filter-campaign"
          label="Campaign"
          value={filters.campaignId}
          options={
            campaignOptions.length > 0
              ? campaignOptions
              : DEFAULT_FILTER_OPTIONS.campaigns
          }
          onChange={(campaignId) => onChangeCampaignId(campaignId)}
        />
      </div>
    </section>
  );
}
