import { Fragment } from 'react';
import { ArrowUpRight } from 'lucide-react';
import {
  formatAnalyticsMetricValue,
  formatAppliedFiltersSummary,
  formatNumeratorDenominator,
} from '../../services/analyticsApi';
import type {
  AnalyticsComparisonRow,
  AnalyticsComparisonScope,
  AnalyticsPermissionProfile,
  AnalyticsRecordClass,
  MetricReferenceRecord,
} from '../../types/analytics';
import type { CampaignMetricId, MetricQueryResult } from '../../types/campaigns';
import { EmptyStateNotice } from '../ui/DataStateWrapper';
import { InfoHint } from '../ui/InfoHint';

interface CampaignChannelComparisonSectionProps {
  scope: AnalyticsComparisonScope;
  onChangeScope: (scope: AnalyticsComparisonScope) => void;
  rows: AnalyticsComparisonRow[];
  metricDefsById: Map<string, MetricReferenceRecord>;
  recordClass: AnalyticsRecordClass;
  asOfDate: string;
  permissionProfile: AnalyticsPermissionProfile;
  loading: boolean;
  onOpenCampaign?: (campaignId: string) => void;
}

const COMPARISON_COLUMNS: ReadonlyArray<{
  id: CampaignMetricId | 'M-12';
  label: string;
  grain: string;
}> = [
  { id: 'M-23', label: 'Response rate', grain: 'Brand' },
  { id: 'M-11', label: 'Meeting rate', grain: 'Brand' },
  { id: 'M-12', label: 'Qual → Opp', grain: 'Brand' },
  { id: 'M-13', label: 'Win / proposal', grain: 'Opportunity' },
  { id: 'M-09', label: 'Confirmed', grain: 'Opportunity' },
  { id: 'M-02', label: 'Signed value', grain: 'Opportunity' },
  { id: 'M-17', label: 'Handoff leak', grain: 'Qualified brand' },
];

function didMetricApplyScope(
  result: MetricQueryResult | undefined,
  scope: AnalyticsComparisonScope
): boolean {
  if (!result || !result.applied_filters) return false;
  const key = scope === 'channel' ? 'channel_group' : 'campaign_id';
  const applied = result.applied_filters[key];
  return applied !== undefined && applied !== null && applied !== '';
}

export function CampaignChannelComparisonSection({
  scope,
  onChangeScope,
  rows,
  metricDefsById,
  recordClass,
  asOfDate,
  permissionProfile,
  loading,
  onOpenCampaign,
}: CampaignChannelComparisonSectionProps) {
  return (
    <section aria-labelledby="analytics-comparison-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="analytics-comparison-heading"
            className="text-[16px] font-semibold tracking-[-0.01em] text-[#202824]"
          >
            Campaign and channel comparison
          </h2>
          <p className="text-[12px] text-[#525E58]">
            Scoped by channel_group or campaign_id via POST /api/metrics/query ({recordClass} · as of {asOfDate}). When viewing by channel group, a separate ED-2025 &ldquo;2025 synthetic&rdquo; comparison row is displayed underneath each group.
          </p>
        </div>

        <div
          role="group"
          aria-label="Comparison dimension"
          className="inline-flex rounded-md border border-[#D9D7D0] bg-white p-0.5"
        >
          {(
            [
              { id: 'channel', label: 'By channel group' },
              { id: 'campaign', label: 'By campaign' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChangeScope(opt.id)}
              className={`rounded px-3 py-1 text-[12px] font-medium transition-colors whitespace-nowrap ${
                scope === opt.id
                  ? 'bg-[#315F52] text-white'
                  : 'text-[#525E58] hover:text-[#202824]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
          <div className="space-y-2.5">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-9 animate-pulse rounded bg-[#FAF9F6]"
              />
            ))}
          </div>
        </div>
      ) : rows.length === 0 ? (
        <EmptyStateNotice
          title={
            scope === 'campaign'
              ? 'No campaigns match the active filters'
              : 'No channel groups available for comparison'
          }
          description="Adjust the global filters or switch between channel group and campaign comparison."
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6] text-[12px] font-medium text-[#525E58]">
                  <th className="px-4 py-3">
                    {scope === 'channel' ? 'Channel group' : 'Campaign'}
                  </th>
                  {COMPARISON_COLUMNS.map((col) => {
                    const def = metricDefsById.get(col.id);
                    return (
                      <th key={col.id} className="px-4 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <span>{col.label}</span>
                          {def ? (
                            <InfoHint
                              label={`${col.label} (${col.id})`}
                              content={`${col.id} (${col.grain}): ${def.formula}`}
                            />
                          ) : null}
                        </div>
                        <span className="block font-mono text-[10px] font-normal text-[#788C83]">
                          {col.id} · {col.grain}
                        </span>
                      </th>
                    );
                  })}
                  <th className="px-4 py-3">Provenance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8E6E0] text-[13px]">
                {rows.map((row) => {
                  const sampleMetric = Object.values(row.metrics)[0];
                  const showSyntheticRow =
                    scope === 'channel' &&
                    row.synthetic2025Metrics &&
                    Object.keys(row.synthetic2025Metrics).length > 0;
                  return (
                    <Fragment key={row.id}>
                      <tr className="align-top hover:bg-[#FAF9F6]">
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            {scope === 'campaign' &&
                            onOpenCampaign &&
                            permissionProfile.canDrillToCampaigns ? (
                              <button
                                type="button"
                                onClick={() => onOpenCampaign(row.id)}
                                className="inline-flex w-fit items-center gap-1 text-left font-medium text-[#202824] hover:text-[#315F52]"
                              >
                                <span>{row.label}</span>
                                <ArrowUpRight className="h-3.5 w-3.5 text-[#788C83]" />
                              </button>
                            ) : (
                              <span className="font-medium text-[#202824]">
                                {row.label}
                              </span>
                            )}
                            <span className="font-mono text-[11px] text-[#788C83]">
                              {row.id}
                              {row.subtitle ? ` · ${row.subtitle}` : ''}
                              {row.betId ? ` · ${row.betId}` : ''}
                            </span>
                          </div>
                        </td>

                        {COMPARISON_COLUMNS.map((col) => {
                          if (row.forbidden) {
                            return (
                              <td
                                key={col.id}
                                className="px-4 py-3 text-right text-[12px] text-[#788C83]"
                              >
                                Restricted
                              </td>
                            );
                          }
                          if (row.error) {
                            return (
                              <td
                                key={col.id}
                                className="px-4 py-3 text-right text-[12px] text-[#9B3B32]"
                              >
                                Error
                              </td>
                            );
                          }
                          const result = row.metrics[col.id];
                          if (!result) {
                            return (
                              <td
                                key={col.id}
                                className="px-4 py-3 text-right font-mono text-[12px] text-[#788C83]"
                              >
                                Unavailable
                              </td>
                            );
                          }
                          if (!didMetricApplyScope(result, scope)) {
                            return (
                              <td
                                key={col.id}
                                className="px-4 py-3 text-right text-[11px] text-[#788C83]"
                                title={`Applied filters: ${formatAppliedFiltersSummary(result.applied_filters)}`}
                              >
                                Not scoped to {scope}
                              </td>
                            );
                          }
                          if (!result.computable) {
                            return (
                              <td
                                key={col.id}
                                className="px-4 py-3 text-right text-[11px] text-[#525E58]"
                                title={result.reason || 'Not computable'}
                              >
                                {result.reason || 'Not computable'}
                              </td>
                            );
                          }
                          const ratio = formatNumeratorDenominator(result);
                          return (
                            <td
                              key={col.id}
                              className="px-4 py-3 text-right font-mono tabular-nums"
                            >
                              <div className="font-medium text-[#202824]">
                                {formatAnalyticsMetricValue(result)}
                              </div>
                              {ratio ? (
                                <div className="text-[11px] text-[#788C83]">
                                  {ratio}
                                </div>
                              ) : null}
                            </td>
                          );
                        })}

                        <td className="px-4 py-3 font-mono text-[11px] text-[#788C83]">
                          <div>{sampleMetric?.record_class || recordClass}</div>
                          <div>as of {sampleMetric?.as_of || asOfDate}</div>
                        </td>
                      </tr>

                      {showSyntheticRow ? (
                        <tr
                          key={`${row.id}-2025`}
                          className="bg-[#FAF9F6]/70 align-top"
                        >
                          <td className="px-4 py-2 pl-8 font-mono text-[11px] text-[#525E58]">
                            2025 synthetic ({row.id})
                          </td>
                          {COMPARISON_COLUMNS.map((col) => {
                            const syn = row.synthetic2025Metrics?.[col.id];
                            if (!syn) {
                              return (
                                <td
                                  key={col.id}
                                  className="px-4 py-2 text-right font-mono text-[11px] text-[#788C83]"
                                >
                                  —
                                </td>
                              );
                            }
                            if (!syn.computable) {
                              return (
                                <td
                                  key={col.id}
                                  className="px-4 py-2 text-right text-[11px] text-[#788C83]"
                                  title={syn.reason || 'Not computable'}
                                >
                                  {syn.reason || 'Not computable'}
                                </td>
                              );
                            }
                            return (
                              <td
                                key={col.id}
                                className="px-4 py-2 text-right font-mono text-[12px] text-[#525E58] tabular-nums"
                              >
                                {formatAnalyticsMetricValue(syn)}
                              </td>
                            );
                          })}
                          <td className="px-4 py-2 font-mono text-[10px] text-[#788C83]">
                            <div>historical_synthetic</div>
                            <div>ED-2025 · as of 2025-12-31</div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
