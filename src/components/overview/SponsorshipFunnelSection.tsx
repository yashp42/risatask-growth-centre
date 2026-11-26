import { ArrowRight } from 'lucide-react';
import type {
  ApiErrorInfo,
  CashOutcomeSummary,
  DataLoadStatus,
  FunnelStageRecord,
} from '../../types/overview';
import { DataStateWrapper } from '../ui/DataStateWrapper';
import { InfoHint } from '../ui/InfoHint';
import { SectionHeader } from '../ui/SectionHeader';

interface SponsorshipFunnelSectionProps {
  stages: FunnelStageRecord[];
  cashOutcome: CashOutcomeSummary;
  status: DataLoadStatus;
  error: ApiErrorInfo | null;
  onRetry: () => void;
  selectedStageKey: string | null;
  onSelectStage: (stage: FunnelStageRecord) => void;
  onInspectCashOutcome: () => void;
}

export function SponsorshipFunnelSection({
  stages,
  cashOutcome,
  status,
  error,
  onRetry,
  selectedStageKey,
  onSelectStage,
  onInspectCashOutcome,
}: SponsorshipFunnelSectionProps) {
  const skeleton = (
    <div className="rounded-md border border-[#D9D7D0] bg-white p-5 space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((idx) => (
          <div
            key={idx}
            className="rounded border border-[#E8E6E0] bg-[#FAF9F6] p-4"
          >
            <div className="h-3 w-20 rounded bg-[#E8E6E0]" />
            <div className="mt-3 h-7 w-12 rounded bg-[#E8E6E0]" />
            <div className="mt-3 h-1.5 w-full rounded bg-[#E8E6E0]" />
          </div>
        ))}
      </div>
      <div className="border-t border-[#E8E6E0] pt-4">
        <div className="h-14 w-full rounded bg-[#FAF9F6]" />
      </div>
    </div>
  );

  return (
    <section
      id="section-funnel"
      aria-label="Sponsorship growth funnel"
      className="space-y-4"
    >
      <SectionHeader
        title="Sponsorship growth funnel"
        meta={
          cashOutcome.recordClassLabel && cashOutcome.asOfDate
            ? `${cashOutcome.recordClassLabel} · as of ${cashOutcome.asOfDate}`
            : undefined
        }
      />

      <DataStateWrapper
        status={status}
        error={error}
        onRetry={onRetry}
        loadingSkeleton={skeleton}
      >
        <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
          {/* Five count-based pipeline stages */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {stages.map((stage, index) => {
              const isSelected = selectedStageKey === stage.key;
              const isConfirmedStage = stage.key === 'confirmed_partnerships';
              const hasCount = stage.count !== null;

              return (
                <div
                  key={stage.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectStage(stage)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectStage(stage);
                    }
                  }}
                  className={`group relative flex cursor-pointer flex-col justify-between rounded border p-4 text-left transition-colors duration-150 ${
                    isSelected
                      ? 'border-[#315F52] bg-[#EBF1EE]/50'
                      : isConfirmedStage
                        ? 'border-[#315F52]/50 bg-[#FAF9F6] hover:border-[#315F52]'
                        : 'border-[#E8E6E0] bg-[#FAF9F6] hover:border-[#788C83] hover:bg-white'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-[11px] text-[#788C83] tabular-nums">
                        0{index + 1} · {stage.metricId}
                      </span>
                      {stage.rateFormatted ? (
                        <span className="font-mono text-[11px] text-[#315F52] tabular-nums">
                          {stage.rateFormatted}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-2 flex items-center gap-1.5">
                      <p className="text-[13px] font-semibold text-[#202824]">
                        {stage.label}
                      </p>
                      <span
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <InfoHint
                          label={stage.label}
                          content={stage.description}
                        />
                      </span>
                    </div>

                    <p
                      className={`mt-2 text-[24px] font-semibold tracking-[-0.02em] tabular-nums ${
                        hasCount ? 'text-[#202824]' : 'text-[#788C83]'
                      }`}
                    >
                      {hasCount ? stage.count : stage.reason || '—'}
                    </p>
                  </div>

                  <div className="mt-4">
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-xs bg-[#E8E6E0]"
                      aria-hidden="true"
                    >
                      <div
                        className="h-full bg-[#315F52] transition-all duration-150"
                        style={{
                          width:
                            stage.conversionFromPreviousPct !== null
                              ? `${Math.min(100, Math.max(4, stage.conversionFromPreviousPct))}%`
                              : '0%',
                        }}
                      />
                    </div>

                    <div className="mt-2.5 flex items-center justify-between text-[11px] text-[#525E58]">
                      <span className="tabular-nums truncate">
                        {stage.cashValueFormatted
                          ? stage.cashValueFormatted
                          : stage.inKindValueFormatted
                            ? stage.inKindValueFormatted
                            : 'Count stage'}
                      </span>
                      <ArrowRight
                        className="h-3 w-3 shrink-0 text-[#788C83] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[#315F52]"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Connected financial outcome: Cash Collected */}
          <div className="mt-5 border-t border-[#D9D7D0] pt-5">
            <div className="flex flex-col gap-4 rounded border border-[#315F52]/50 bg-[#FAF9F6] p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#315F52]">
                  <span>Confirmed Partnerships</span>
                  <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>Financial outcome</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <h3 className="text-[14px] font-semibold text-[#202824]">
                    Cash collected &amp; collection rate
                  </h3>
                  <InfoHint
                    label="Cash collection rate definition"
                    content={cashOutcome.definitionNote}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:flex-1 lg:max-w-xl">
                <div className="border-t border-[#E8E6E0] pt-2 sm:border-t-0 sm:border-l sm:pl-4 sm:pt-0">
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Cleared cash collected (M-01)
                  </p>
                  {cashOutcome.collectedCashFormatted ? (
                    <p className="mt-1 text-[20px] font-semibold text-[#202824] tabular-nums">
                      {cashOutcome.collectedCashFormatted}
                    </p>
                  ) : (
                    <p className="mt-1 text-[12px] font-medium text-[#788C83]">
                      {cashOutcome.collectedReason || 'Not computable'}
                    </p>
                  )}
                </div>

                <div className="border-t border-[#E8E6E0] pt-2 sm:border-t-0 sm:border-l sm:pl-4 sm:pt-0">
                  <p className="text-[11px] font-medium text-[#788C83]">
                    Collection rate (M-06)
                  </p>
                  {cashOutcome.collectionRateFormatted ? (
                    <p className="mt-1 text-[20px] font-semibold text-[#315F52] tabular-nums">
                      {cashOutcome.collectionRateFormatted}
                    </p>
                  ) : (
                    <p className="mt-1 text-[12px] font-medium text-[#788C83]">
                      {cashOutcome.collectionRateReason || 'Not computable'}
                    </p>
                  )}
                  <p className="mt-0.5 text-[11px] text-[#788C83] tabular-nums">
                    Signed cash (M-03): {cashOutcome.confirmedCashBasisFormatted ?? '—'}
                  </p>
                </div>

                <div className="border-t border-[#E8E6E0] pt-2 sm:border-t-0 sm:border-l sm:pl-4 sm:pt-0">
                  <p className="text-[11px] font-medium text-[#788C83]">
                    In-kind value (M-04, separate)
                  </p>
                  <p className="mt-1 font-mono text-[15px] font-medium text-[#525E58] tabular-nums">
                    {cashOutcome.inKindValueSeparateFormatted ?? '—'}
                  </p>
                </div>
              </div>

              <div className="shrink-0">
                <button
                  type="button"
                  onClick={onInspectCashOutcome}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] transition-colors duration-150 hover:border-[#315F52] hover:text-[#315F52] whitespace-nowrap"
                >
                  Inspect
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </DataStateWrapper>
    </section>
  );
}
