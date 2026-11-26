import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  ANALYTICS_METRIC_UI_HINTS,
  formatAnalyticsMetricValue,
  formatAppliedFiltersSummary,
  formatNumeratorDenominator,
  querySingleAnalyticsMetric,
} from '../../services/analyticsApi';
import type {
  AnalyticsFilters,
  AnalyticsPermissionProfile,
  KpiReferenceRecord,
  MetricReferenceRecord,
} from '../../types/analytics';
import type { MetricQueryResult } from '../../types/campaigns';
import { EmptyStateNotice } from '../ui/DataStateWrapper';

interface MetricExplorerSectionProps {
  metricDefinitions: MetricReferenceRecord[];
  kpiDefinitions: KpiReferenceRecord[];
  metricsAvailable: boolean;
  kpisAvailable: boolean;
  coreResults: Record<string, MetricQueryResult>;
  filters: AnalyticsFilters;
  permissionProfile: AnalyticsPermissionProfile;
}

const RESTRICTED_VIEWER_IDS = new Set(['M-01', 'M-06', 'M-07', 'M-25', 'M-27']);

export function MetricExplorerSection({
  metricDefinitions,
  kpiDefinitions,
  metricsAvailable,
  kpisAvailable,
  coreResults,
  filters,
  permissionProfile,
}: MetricExplorerSectionProps) {
  const [search, setSearch] = useState('');
  const [selectedMetricId, setSelectedMetricId] = useState<string>('');
  const [liveResult, setLiveResult] = useState<MetricQueryResult | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  const kpisById = useMemo(() => {
    const map = new Map<string, KpiReferenceRecord>();
    for (const k of kpiDefinitions) {
      map.set(k.kpi_id, k);
    }
    return map;
  }, [kpiDefinitions]);

  const filteredMetrics = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return metricDefinitions;
    return metricDefinitions.filter((m) => {
      const hay = [
        m.metric_id,
        m.name,
        m.kpi_id,
        m.business_meaning,
        m.formula,
        m.value_nature,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [metricDefinitions, search]);

  useEffect(() => {
    if (
      filteredMetrics.length > 0 &&
      !filteredMetrics.some((m) => m.metric_id === selectedMetricId)
    ) {
      setSelectedMetricId(filteredMetrics[0].metric_id);
    }
  }, [filteredMetrics, selectedMetricId]);

  const selectedMetric =
    filteredMetrics.find((m) => m.metric_id === selectedMetricId) ??
    filteredMetrics[0] ??
    null;

  const selectedKpi = selectedMetric?.kpi_id
    ? kpisById.get(selectedMetric.kpi_id) ??
      kpiDefinitions.find((k) => k.metric_id === selectedMetric.metric_id) ??
      null
    : selectedMetric
      ? kpiDefinitions.find((k) => k.metric_id === selectedMetric.metric_id) ??
        null
      : null;

  useEffect(() => {
    if (!selectedMetric) {
      setLiveResult(null);
      setQueryError(null);
      return;
    }

    if (
      permissionProfile.isViewerRestricted &&
      RESTRICTED_VIEWER_IDS.has(selectedMetric.metric_id)
    ) {
      setLiveResult(null);
      setQueryError('Restricted for your assigned role.');
      return;
    }

    if (coreResults[selectedMetric.metric_id]) {
      setLiveResult(coreResults[selectedMetric.metric_id]);
      setQueryError(null);
      return;
    }

    const controller = new AbortController();
    setQueryLoading(true);
    setQueryError(null);

    querySingleAnalyticsMetric(
      selectedMetric.metric_id,
      filters,
      controller.signal
    )
      .then((res) => {
        setLiveResult(res);
        setQueryLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLiveResult(null);
        setQueryError(
          err instanceof Error ? err.message : 'Unable to evaluate metric.'
        );
        setQueryLoading(false);
      });

    return () => controller.abort();
  }, [selectedMetric, coreResults, filters, permissionProfile.isViewerRestricted]);

  return (
    <section aria-labelledby="metric-explorer-heading" className="space-y-4">
      <div>
        <h2
          id="metric-explorer-heading"
          className="text-[16px] font-semibold tracking-[-0.01em] text-[#202824]"
        >
          Metric explorer and definitions
        </h2>
        <p className="text-[12px] text-[#525E58]">
          Read-only catalog sourced from the reference metric and KPI
          definitions, paired with live results for the active filters.
        </p>
      </div>

      {!metricsAvailable || metricDefinitions.length === 0 ? (
        <EmptyStateNotice
          title="Metric dictionary reference is currently unavailable"
          description="Metric definitions are served strictly from the backend reference catalog and are not duplicated in frontend code."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left: Searchable Metric List */}
          <div className="rounded-md border border-[#D9D7D0] bg-white lg:col-span-5">
            <div className="border-b border-[#D9D7D0] p-3">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#788C83]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by metric ID, name, or KPI..."
                  aria-label="Search metric definitions"
                  className="h-9 w-full rounded-md border border-[#D9D7D0] bg-[#FAF9F6] pl-9 pr-3 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            <div className="max-h-[540px] divide-y divide-[#E8E6E0] overflow-y-auto">
              {filteredMetrics.length === 0 ? (
                <p className="p-4 text-[13px] text-[#525E58]">
                  No metric definitions match your search.
                </p>
              ) : (
                filteredMetrics.map((m) => {
                  const isSelected =
                    selectedMetric?.metric_id === m.metric_id;
                  return (
                    <button
                      key={m.metric_id}
                      type="button"
                      onClick={() => setSelectedMetricId(m.metric_id)}
                      className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? 'bg-[#EBF1EE]/60'
                          : 'hover:bg-[#FAF9F6]'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-[#202824]">
                          {m.name}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-[#788C83]">
                          {[m.kpi_id, m.unit, m.value_nature]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-[11px] font-medium text-[#315F52]">
                        {m.metric_id}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Definition + Live Metric Result */}
          <div className="space-y-4 lg:col-span-7">
            {selectedMetric ? (
              <>
                {/* Live Computed Result Box */}
                <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#E8E6E0] pb-3">
                    <div>
                      <span className="font-mono text-[11px] text-[#788C83]">
                        {selectedMetric.metric_id}
                        {ANALYTICS_METRIC_UI_HINTS[selectedMetric.metric_id]
                          ?.grain
                          ? ` · ${ANALYTICS_METRIC_UI_HINTS[selectedMetric.metric_id].grain}`
                          : ''}
                      </span>
                      <h3 className="mt-0.5 text-[16px] font-semibold text-[#202824]">
                        {selectedMetric.name}
                      </h3>
                    </div>
                    {liveResult?.definition_version ? (
                      <span className="font-mono text-[11px] text-[#788C83]">
                        Def v{String(liveResult.definition_version)}
                      </span>
                    ) : null}
                  </div>

                  {queryLoading ? (
                    <div className="mt-4 h-10 w-36 animate-pulse rounded bg-[#FAF9F6]" />
                  ) : queryError ? (
                    <p className="mt-4 text-[13px] text-[#525E58]">
                      {queryError}
                    </p>
                  ) : !liveResult ? (
                    <p className="mt-4 text-[13px] text-[#525E58]">
                      Metric output is unavailable for the active context.
                    </p>
                  ) : !liveResult.computable ? (
                    <div className="mt-4 space-y-1">
                      <p className="font-mono text-[16px] font-medium text-[#525E58]">
                        Not computable
                      </p>
                      <p className="text-[12px] text-[#788C83]">
                        {liveResult.reason ||
                          'Required inputs are absent in this dataset.'}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap items-baseline justify-between gap-4">
                      <div>
                        <p className="font-mono text-[24px] font-semibold tabular-nums text-[#315F52]">
                          {formatAnalyticsMetricValue(
                            liveResult,
                            selectedMetric.unit
                          )}
                        </p>
                        {formatNumeratorDenominator(liveResult) ? (
                          <p className="mt-0.5 font-mono text-[12px] text-[#525E58]">
                            {formatNumeratorDenominator(liveResult)}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right font-mono text-[11px] text-[#788C83]">
                        <div>
                          {liveResult.record_class}
                          {liveResult.as_of ? ` · as of ${liveResult.as_of}` : ''}
                          {liveResult.data_version !== undefined &&
                          liveResult.data_version !== null
                            ? ` · v${String(liveResult.data_version)}`
                            : ''}
                        </div>
                        <div>
                          Filters:{' '}
                          {formatAppliedFiltersSummary(
                            liveResult.applied_filters
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Read-Only Reference Definition */}
                <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
                  <h4 className="border-b border-[#E8E6E0] pb-2.5 text-[13px] font-semibold text-[#202824]">
                    Reference definition
                  </h4>

                  <dl className="mt-3 divide-y divide-[#E8E6E0] text-[12px]">
                    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3">
                      <dt className="font-medium text-[#525E58]">
                        Business meaning
                      </dt>
                      <dd className="text-[#202824] sm:col-span-2">
                        {selectedMetric.business_meaning || '—'}
                      </dd>
                    </div>
                    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3">
                      <dt className="font-medium text-[#525E58]">Formula</dt>
                      <dd className="font-mono text-[#202824] sm:col-span-2">
                        {selectedMetric.formula}
                      </dd>
                    </div>
                    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3">
                      <dt className="font-medium text-[#525E58]">
                        Numerator / Denominator
                      </dt>
                      <dd className="text-[#202824] sm:col-span-2">
                        {selectedMetric.numerator || '—'} ÷{' '}
                        {selectedMetric.denominator || '—'}
                      </dd>
                    </div>
                    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3">
                      <dt className="font-medium text-[#525E58]">
                        Aggregation &amp; Unit
                      </dt>
                      <dd className="text-[#202824] sm:col-span-2">
                        {[selectedMetric.aggregation, selectedMetric.unit]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </dd>
                    </div>
                    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3">
                      <dt className="font-medium text-[#525E58]">
                        Time period
                      </dt>
                      <dd className="text-[#202824] sm:col-span-2">
                        {selectedMetric.time_period || '—'}
                      </dd>
                    </div>
                    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3">
                      <dt className="font-medium text-[#525E58]">
                        Inclusion / Exclusion
                      </dt>
                      <dd className="text-[#202824] sm:col-span-2">
                        {selectedMetric.inclusion_exclusion || '—'}
                      </dd>
                    </div>
                    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3">
                      <dt className="font-medium text-[#525E58]">
                        Value nature &amp; 2025 availability
                      </dt>
                      <dd className="text-[#202824] sm:col-span-2">
                        {selectedMetric.value_nature || '—'} · 2025 computable:{' '}
                        {selectedMetric.computable_2025 === true ||
                        selectedMetric.computable_2025 === 'yes'
                          ? 'Yes'
                          : selectedMetric.computable_2025 === false ||
                              selectedMetric.computable_2025 === 'no'
                            ? 'No'
                            : String(selectedMetric.computable_2025 || '—')}
                      </dd>
                    </div>
                    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3">
                      <dt className="font-medium text-[#525E58]">
                        Related KPI
                      </dt>
                      <dd className="text-[#202824] sm:col-span-2">
                        {selectedKpi ? (
                          <div>
                            <span className="font-mono font-medium">
                              {selectedKpi.kpi_id}
                            </span>{' '}
                            · {selectedKpi.name}
                            {selectedKpi.definition ? (
                              <span className="mt-0.5 block text-[#525E58]">
                                {selectedKpi.definition}
                              </span>
                            ) : null}
                          </div>
                        ) : selectedMetric.kpi_id ? (
                          <span className="font-mono">
                            {selectedMetric.kpi_id}
                            {!kpisAvailable ? ' (KPI catalog unavailable)' : ''}
                          </span>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
