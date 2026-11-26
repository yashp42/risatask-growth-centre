import type {
  ApiErrorInfo,
  DataLoadStatus,
  StrategicBetSlot,
} from '../../types/overview';
import { DataStateWrapper } from '../ui/DataStateWrapper';
import { SectionHeader } from '../ui/SectionHeader';

interface StrategicBetsSectionProps {
  bets: StrategicBetSlot[];
  status: DataLoadStatus;
  error: ApiErrorInfo | null;
  onRetry: () => void;
  recordClass?: string;
  asOfDate?: string;
}

export function StrategicBetsSection({
  bets,
  status,
  error,
  onRetry,
  recordClass,
  asOfDate,
}: StrategicBetsSectionProps) {
  const skeleton = (
    <div className="divide-y divide-[#E8E6E0] rounded-md border border-[#D9D7D0] bg-white">
      {[0, 1, 2, 3, 4].map((idx) => (
        <div
          key={idx}
          className="flex items-center justify-between gap-4 px-5 py-3.5"
        >
          <div className="h-3.5 w-48 rounded bg-[#E8E6E0]" />
          <div className="h-2 w-32 rounded bg-[#F3F1EB]" />
          <div className="h-3.5 w-16 rounded bg-[#E8E6E0]" />
        </div>
      ))}
    </div>
  );

  return (
    <section
      id="section-bets"
      aria-label="Strategic bets"
      className="space-y-4"
    >
      <SectionHeader
        title="Strategic bets &amp; rules"
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
        <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
          {recordClass === 'historical_synthetic' ? (
            <div className="border-b border-[#E8E6E0] bg-[#FAF9F6] px-5 py-2.5 text-[12px] font-medium text-[#525E58]">
              Reference only: rules apply to the 2026 season
            </div>
          ) : null}
          <ul className="divide-y divide-[#E8E6E0]">
            {bets.map((bet) => {
              const hasProgress = bet.progressPct !== null;
              const statusTone =
                bet.band === 'keep'
                  ? 'text-[#315F52]'
                  : bet.band === 'escalate' || bet.band === 'stop'
                    ? 'text-[#9B3B32]'
                    : 'text-[#525E58]';

              return (
                <li
                  key={bet.id}
                  className="grid grid-cols-1 items-center gap-3 px-5 py-3.5 sm:grid-cols-12"
                >
                  <div className="flex items-baseline gap-3 sm:col-span-5">
                    <span className="font-mono text-[11px] font-medium text-[#788C83] shrink-0">
                      {bet.indexLabel}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-[#202824]">
                        {bet.title}
                      </p>
                      {bet.metricSummary ? (
                        <p className="truncate text-[12px] text-[#788C83]">
                          {bet.metricSummary}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 sm:col-span-4">
                    <div
                      className="h-1.5 flex-1 overflow-hidden rounded-xs bg-[#E8E6E0]"
                      aria-hidden="true"
                    >
                      <div
                        className="h-full bg-[#315F52]"
                        style={{
                          width: hasProgress
                            ? `${Math.min(100, Math.max(0, bet.progressPct ?? 0))}%`
                            : '0%',
                        }}
                      />
                    </div>
                    <span className="w-10 text-right font-mono text-[12px] text-[#525E58] tabular-nums">
                      {hasProgress ? `${bet.progressPct}%` : '—'}
                    </span>
                  </div>

                  <div className="sm:col-span-3 sm:text-right">
                    <span className={`font-mono text-[11px] font-medium ${statusTone}`}>
                      {bet.thresholdStatus ?? '—'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </DataStateWrapper>
    </section>
  );
}
