import type {
  ApiErrorInfo,
  DataLoadStatus,
  GrowthPulseMetric,
} from '../../types/overview';
import { DataStateWrapper } from '../ui/DataStateWrapper';
import { InfoHint } from '../ui/InfoHint';
import { SectionHeader } from '../ui/SectionHeader';

interface GrowthPulseSectionProps {
  metrics: GrowthPulseMetric[];
  status: DataLoadStatus;
  error: ApiErrorInfo | null;
  onRetry: () => void;
  onInspectMetric?: (metric: GrowthPulseMetric) => void;
  recordClass?: string;
  asOfDate?: string;
}

export function GrowthPulseSection({
  metrics,
  status,
  error,
  onRetry,
  onInspectMetric,
  recordClass,
  asOfDate,
}: GrowthPulseSectionProps) {
  const skeleton = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((idx) => (
        <div
          key={idx}
          className="rounded-md border border-[#D9D7D0] bg-white p-5"
        >
          <div className="h-3.5 w-28 rounded bg-[#E8E6E0]" />
          <div className="mt-4 h-8 w-24 rounded bg-[#E8E6E0]" />
          <div className="mt-3 h-3 w-20 rounded bg-[#F3F1EB]" />
        </div>
      ))}
    </div>
  );

  return (
    <section id="section-pulse" aria-label="Growth pulse" className="space-y-4">
      <SectionHeader
        title="Growth pulse"
        meta={
          recordClass && asOfDate ? `${recordClass} · as of ${asOfDate}` : undefined
        }
      />

      <DataStateWrapper
        status={status}
        error={error}
        onRetry={onRetry}
        loadingSkeleton={skeleton}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => {
            const isNorthStar = Boolean(metric.isNorthStar);
            const hasValue = metric.computable && metric.formattedValue !== null;

            return (
              <div
                key={metric.id}
                onClick={() => onInspectMetric?.(metric)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onInspectMetric?.(metric);
                  }
                }}
                role="button"
                tabIndex={0}
                className={`flex cursor-pointer flex-col justify-between rounded-md border p-5 text-left transition-colors duration-150 ${
                  isNorthStar
                    ? 'border-[#315F52] bg-white hover:bg-[#FAF9F6]'
                    : 'border-[#D9D7D0] bg-white hover:border-[#788C83] hover:bg-[#FAF9F6]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-[13px] font-medium text-[#525E58]">
                    <span>{metric.label}</span>
                    <InfoHint
                      label={`Definition for ${metric.label}`}
                      content={metric.supportingLabel}
                    />
                  </span>
                  <span className="font-mono text-[11px] font-medium text-[#788C83] whitespace-nowrap">
                    {isNorthStar ? `North Star · ${metric.metricId}` : metric.metricId}
                  </span>
                </div>

                <div className="mt-3 flex items-baseline justify-between gap-2">
                  {hasValue ? (
                    <span className="text-[28px] font-semibold tracking-[-0.02em] text-[#202824] tabular-nums">
                      {metric.formattedValue}
                    </span>
                  ) : (
                    <span className="text-[13px] font-medium text-[#788C83]">
                      {metric.reason || 'Not computable'}
                    </span>
                  )}
                  {metric.comparisonText && hasValue ? (
                    <span className="font-mono text-[12px] text-[#525E58] tabular-nums">
                      {metric.comparisonText}
                    </span>
                  ) : null}
                </div>

                <div className="mt-2.5 flex flex-col gap-0.5">
                  {metric.secondaryBreakdownLabel ? (
                    <p className="text-[11px] text-[#788C83]">
                      {metric.secondaryBreakdownLabel}
                    </p>
                  ) : null}
                  {metric.recordClassLabel && metric.asOfDate ? (
                    <p className="font-mono text-[10px] text-[#788C83]">
                      {metric.recordClassLabel} · as of {metric.asOfDate}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </DataStateWrapper>
    </section>
  );
}
