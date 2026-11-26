import {
  formatAnalyticsMetricValue,
  formatAppliedFiltersSummary,
  formatNumeratorDenominator,
} from '../../services/analyticsApi';
import { formatRecordClassLabel } from '../../services/analystApi';
import type { MetricQueryResult } from '../../types/campaigns';

interface MetricEvidenceCardProps {
  metric: MetricQueryResult;
  compact?: boolean;
}

export function MetricEvidenceCard({
  metric,
  compact = false,
}: MetricEvidenceCardProps) {
  const ratio = formatNumeratorDenominator(metric);

  return (
    <div className="rounded-md border border-[#D9D7D0] bg-white p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold text-[#315F52]">
          {metric.metric_id}
        </span>
        <span className="font-mono text-[11px] text-[#788C83]">
          {formatRecordClassLabel(metric.record_class)}
          {metric.data_version !== undefined && metric.data_version !== null
            ? ` · v${String(metric.data_version)}`
            : ''}
        </span>
      </div>

      {!metric.computable ? (
        <div className="mt-1.5">
          <p className="font-mono text-[14px] font-medium text-[#525E58]">
            Not computable
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-[#788C83]">
            {metric.reason || 'Underlying data is unavailable for this scope.'}
          </p>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <span
            className={`font-mono font-semibold tabular-nums text-[#202824] ${
              compact ? 'text-[17px]' : 'text-[20px]'
            }`}
          >
            {formatAnalyticsMetricValue(metric)}
          </span>
          {ratio ? (
            <span className="font-mono text-[12px] text-[#525E58] tabular-nums">
              {ratio}
            </span>
          ) : null}
        </div>
      )}

      <div className="mt-2 border-t border-[#E8E6E0] pt-2 text-[11px] text-[#788C83]">
        <div
          className="truncate"
          title={formatAppliedFiltersSummary(metric.applied_filters)}
        >
          Filters: {formatAppliedFiltersSummary(metric.applied_filters)}
        </div>
        {metric.definition_version !== undefined &&
        metric.definition_version !== null ? (
          <div className="font-mono">
            Definition v{String(metric.definition_version)}
            {metric.unit ? ` · ${metric.unit}` : ''}
          </div>
        ) : null}
      </div>
    </div>
  );
}
