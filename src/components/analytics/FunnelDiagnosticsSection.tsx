import {
  formatAnalyticsMetricValue,
  formatNumeratorDenominator,
} from '../../services/analyticsApi';
import type {
  AnalyticsPermissionProfile,
  AnalyticsRecordClass,
  ChannelGroupFunnelRow,
  MetricReferenceRecord,
} from '../../types/analytics';
import type { MetricQueryResult } from '../../types/campaigns';
import { EmptyStateNotice } from '../ui/DataStateWrapper';
import { AnalyticsMetricCard } from './AnalyticsMetricCard';

interface FunnelDiagnosticsSectionProps {
  metrics: Record<string, MetricQueryResult>;
  channelGroupFunnel: ChannelGroupFunnelRow[];
  channelFunnelLoading: boolean;
  metricDefsById: Map<string, MetricReferenceRecord>;
  recordClass: AnalyticsRecordClass;
  asOfDate: string;
  permissionProfile: AnalyticsPermissionProfile;
  loading: boolean;
  onOpenCampaigns?: () => void;
  onOpenSponsors?: () => void;
  onOpenPipeline?: () => void;
}

const CHANNEL_FUNNEL_COLUMNS = [
  { id: 'M-23', label: 'Response rate' },
  { id: 'M-11', label: 'Meeting rate' },
  { id: 'M-12', label: 'Qual → Opp rate' },
  { id: 'M-13', label: 'Win / proposal' },
  { id: 'M-09', label: 'Confirmed' },
  { id: 'M-02', label: 'Signed value' },
] as const;

export function FunnelDiagnosticsSection({
  metrics,
  channelGroupFunnel,
  channelFunnelLoading,
  metricDefsById,
  recordClass,
  asOfDate,
  permissionProfile,
  loading,
  onOpenCampaigns,
  onOpenSponsors,
  onOpenPipeline,
}: FunnelDiagnosticsSectionProps) {
  return (
    <div className="space-y-8">
      {/* Stage Group 1: Brand-level outreach & meeting engagement */}
      <section aria-labelledby="funnel-engagement-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2
              id="funnel-engagement-heading"
              className="text-[16px] font-semibold tracking-[-0.01em] text-[#202824]"
            >
              Outreach engagement and proposal reach (brand grain)
            </h2>
            <p className="text-[12px] text-[#525E58]">
              Brand-level response, meeting, and qualification-to-opportunity rates.
            </p>
          </div>
          <span className="font-mono text-[11px] text-[#788C83]">
            {recordClass} · as of {asOfDate}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <AnalyticsMetricCard
            metricId="M-23"
            result={metrics['M-23']}
            definition={metricDefsById.get('M-23') ?? null}
            loading={loading}
            recordClass={recordClass}
            asOfDate={asOfDate}
            drillThroughLabel={
              permissionProfile.canDrillToCampaigns
                ? 'Inspect campaigns'
                : undefined
            }
            onDrillThrough={onOpenCampaigns}
          />
          <AnalyticsMetricCard
            metricId="M-11"
            result={metrics['M-11']}
            definition={metricDefsById.get('M-11') ?? null}
            loading={loading}
            recordClass={recordClass}
            asOfDate={asOfDate}
            drillThroughLabel={
              permissionProfile.canDrillToCampaigns
                ? 'Inspect campaigns'
                : undefined
            }
            onDrillThrough={onOpenCampaigns}
          />
          <AnalyticsMetricCard
            metricId="M-12"
            result={metrics['M-12']}
            definition={metricDefsById.get('M-12') ?? null}
            loading={loading}
            recordClass={recordClass}
            asOfDate={asOfDate}
            drillThroughLabel={
              permissionProfile.canDrillToSponsors
                ? 'Inspect sponsors'
                : undefined
            }
            onDrillThrough={onOpenSponsors}
          />
        </div>
      </section>

      {/* Channel Group Funnel + Separate "2025 synthetic" comparison series */}
      <section aria-labelledby="funnel-by-channel-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2
              id="funnel-by-channel-heading"
              className="text-[16px] font-semibold tracking-[-0.01em] text-[#202824]"
            >
              Funnel by channel group vs 2025 synthetic
            </h2>
            <p className="text-[12px] text-[#525E58]">
              M-23, M-11, M-12, M-13, M-09, and M-02 per channel_group. Active edition ({recordClass} · as of {asOfDate}) is queried separately from the ED-2025 historical_synthetic baseline (&ldquo;2025 synthetic&rdquo;).
            </p>
          </div>
          <span className="font-mono text-[11px] text-[#788C83]">
            Separate queries · Never mixed
          </span>
        </div>

        {channelFunnelLoading ? (
          <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
            <div className="space-y-2.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-[#FAF9F6]" />
              ))}
            </div>
          </div>
        ) : channelGroupFunnel.length === 0 ? (
          <EmptyStateNotice
            title="No channel-group funnel metrics returned"
            description="Adjust filters or verify metrics service connectivity."
          />
        ) : (
          <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6] text-[#525E58]">
                    <th className="px-4 py-3 font-medium">Channel group</th>
                    <th className="px-4 py-3 font-medium">Series</th>
                    {CHANNEL_FUNNEL_COLUMNS.map((col) => (
                      <th key={col.id} className="px-4 py-3 text-right font-medium">
                        <div>{col.label}</div>
                        <div className="font-mono text-[10px] font-normal text-[#788C83]">
                          {col.id}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8E6E0]">
                  {channelGroupFunnel.map((row) => (
                    <FragmentRowGroup
                      key={row.channel_group}
                      row={row}
                      recordClass={recordClass}
                      asOfDate={asOfDate}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Stage Group 2: Qualified lead handoff & SLA cohort */}
      <section aria-labelledby="funnel-handoff-heading" className="space-y-3">
        <div>
          <h2
            id="funnel-handoff-heading"
            className="text-[16px] font-semibold tracking-[-0.01em] text-[#202824]"
          >
            Qualification handoff and SLA timing (qualified-lead grain)
          </h2>
          <p className="text-[12px] text-[#525E58]">
            Scoped to warm and inbound qualified brands unless stated otherwise;
            excludes cold outreach and respects cohort timing eligibility.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <AnalyticsMetricCard
            metricId="M-17"
            result={metrics['M-17']}
            definition={metricDefsById.get('M-17') ?? null}
            loading={loading}
            recordClass={recordClass}
            asOfDate={asOfDate}
            extraNote="Scope: qualified warm and inbound brands without an opportunity; cold channels excluded unless stated."
            drillThroughLabel={
              permissionProfile.canDrillToSponsors
                ? 'Review sponsors'
                : undefined
            }
            onDrillThrough={onOpenSponsors}
          />
          <AnalyticsMetricCard
            metricId="M-18"
            result={metrics['M-18']}
            definition={metricDefsById.get('M-18') ?? null}
            loading={loading}
            recordClass={recordClass}
            asOfDate={asOfDate}
            extraNote="Cohort timing: newly qualified leads within 5-day deal creation window; partial cohorts are not season-wide totals."
            drillThroughLabel={
              permissionProfile.canDrillToPipeline
                ? 'Open pipeline'
                : undefined
            }
            onDrillThrough={onOpenPipeline}
          />
          <AnalyticsMetricCard
            metricId="M-19"
            result={metrics['M-19']}
            definition={metricDefsById.get('M-19') ?? null}
            loading={loading}
            recordClass={recordClass}
            asOfDate={asOfDate}
            extraNote="Cohort timing: qualified leads with proposal sent within 10 days (B1 SLA gate at W4, n ≥ 12)."
            drillThroughLabel={
              permissionProfile.canDrillToPipeline
                ? 'Open pipeline'
                : undefined
            }
            onDrillThrough={onOpenPipeline}
          />
        </div>
      </section>

      {/* Stage Group 3: Proposal conversion, brand attribution & deal velocity */}
      <section aria-labelledby="funnel-conversion-heading" className="space-y-3">
        <div>
          <h2
            id="funnel-conversion-heading"
            className="text-[16px] font-semibold tracking-[-0.01em] text-[#202824]"
          >
            Conversion and sales-cycle diagnostics (opportunity and won-deal
            grains)
          </h2>
          <p className="text-[12px] text-[#525E58]">
            Separate grains: opportunity win rates and counts (M-13, M-09) vs
            first-touch brand win rate (M-14) vs mean confirmation cycle days
            (M-20).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AnalyticsMetricCard
            metricId="M-13"
            result={metrics['M-13']}
            definition={metricDefsById.get('M-13') ?? null}
            loading={loading}
            recordClass={recordClass}
            asOfDate={asOfDate}
            drillThroughLabel={
              permissionProfile.canDrillToPipeline
                ? 'Inspect deals'
                : undefined
            }
            onDrillThrough={onOpenPipeline}
          />
          <AnalyticsMetricCard
            metricId="M-14"
            result={metrics['M-14']}
            definition={metricDefsById.get('M-14') ?? null}
            loading={loading}
            recordClass={recordClass}
            asOfDate={asOfDate}
            extraNote="Attribution rule: first-touch attribution unless explicitly overridden by the metric service."
            drillThroughLabel={
              permissionProfile.canDrillToSponsors
                ? 'Inspect sponsors'
                : undefined
            }
            onDrillThrough={onOpenSponsors}
          />
          <AnalyticsMetricCard
            metricId="M-09"
            result={metrics['M-09']}
            definition={metricDefsById.get('M-09') ?? null}
            loading={loading}
            recordClass={recordClass}
            asOfDate={asOfDate}
            extraNote="Opportunity count (partner_confirmed); distinct from unique sponsor brands."
            drillThroughLabel={
              permissionProfile.canDrillToPipeline
                ? 'Inspect confirmed deals'
                : undefined
            }
            onDrillThrough={onOpenPipeline}
          />
          <AnalyticsMetricCard
            metricId="M-20"
            result={metrics['M-20']}
            definition={metricDefsById.get('M-20') ?? null}
            loading={loading}
            recordClass={recordClass}
            asOfDate={asOfDate}
            extraNote="Mean days from opportunity creation to confirmation across won deals only."
            drillThroughLabel={
              permissionProfile.canDrillToPipeline
                ? 'Inspect deals'
                : undefined
            }
            onDrillThrough={onOpenPipeline}
          />
        </div>
      </section>
    </div>
  );
}

function FragmentRowGroup({
  row,
  recordClass,
  asOfDate,
}: {
  row: ChannelGroupFunnelRow;
  recordClass: AnalyticsRecordClass;
  asOfDate: string;
}) {
  const renderCell = (
    result: MetricQueryResult | undefined,
    error: string | null | undefined
  ) => {
    if (error) {
      return (
        <td className="px-4 py-2.5 text-right text-[11px] text-[#9B3B32]">
          Error
        </td>
      );
    }
    if (!result) {
      return (
        <td className="px-4 py-2.5 text-right font-mono text-[11px] text-[#788C83]">
          —
        </td>
      );
    }
    if (!result.computable) {
      return (
        <td
          className="px-4 py-2.5 text-right text-[11px] text-[#788C83]"
          title={result.reason || 'Not computable'}
        >
          {result.reason || 'Not computable'}
        </td>
      );
    }
    const ratio = formatNumeratorDenominator(result);
    return (
      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
        <div className="font-medium text-[#202824]">
          {formatAnalyticsMetricValue(result)}
        </div>
        {ratio ? (
          <div className="text-[10px] text-[#788C83]">{ratio}</div>
        ) : null}
      </td>
    );
  };

  return (
    <>
      <tr className="bg-white hover:bg-[#FAF9F6]">
        <td className="px-4 py-2.5 font-medium text-[#202824]" rowSpan={2}>
          <div>{row.label}</div>
          <div className="font-mono text-[10px] text-[#788C83]">
            channel_group: {row.channel_group}
          </div>
        </td>
        <td className="px-4 py-2.5 font-mono text-[11px] text-[#315F52]">
          <div>Active ({recordClass})</div>
          <div className="text-[10px] text-[#788C83]">as of {asOfDate}</div>
        </td>
        {CHANNEL_FUNNEL_COLUMNS.map((col) => (
          <FragmentCell
            key={`${row.channel_group}-cur-${col.id}`}
            cell={renderCell(row.currentMetrics[col.id], row.currentError)}
          />
        ))}
      </tr>
      <tr className="bg-[#FAF9F6]/80">
        <td className="px-4 py-2 font-mono text-[11px] text-[#525E58]">
          <div>2025 synthetic</div>
          <div className="text-[10px] text-[#788C83]">
            ED-2025 · historical_synthetic
          </div>
        </td>
        {CHANNEL_FUNNEL_COLUMNS.map((col) => (
          <FragmentCell
            key={`${row.channel_group}-2025-${col.id}`}
            cell={renderCell(
              row.synthetic2025Metrics[col.id],
              row.syntheticError
            )}
          />
        ))}
      </tr>
    </>
  );
}

function FragmentCell({ cell }: { cell: React.ReactNode }) {
  return <>{cell}</>;
}
