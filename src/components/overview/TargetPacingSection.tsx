import type {
  ApiErrorInfo,
  DataLoadStatus,
  ScenarioKey,
  TargetPacingSnapshot,
} from '../../types/overview';
import { DataStateWrapper } from '../ui/DataStateWrapper';
import { InfoHint } from '../ui/InfoHint';
import { SectionHeader } from '../ui/SectionHeader';

interface TargetPacingSectionProps {
  pacing: TargetPacingSnapshot;
  selectedScenario: ScenarioKey;
  onSelectScenario: (scenario: ScenarioKey) => void;
  status: DataLoadStatus;
  error: ApiErrorInfo | null;
  onRetry: () => void;
  recordClass?: string;
  asOfDate?: string;
}

const SCENARIO_ORDER: ScenarioKey[] = ['base', 'plan', 'stretch'];

export function TargetPacingSection({
  pacing,
  selectedScenario,
  onSelectScenario,
  status,
  error,
  onRetry,
  recordClass,
  asOfDate,
}: TargetPacingSectionProps) {
  const activeScenarioData = pacing.scenarioTargets[selectedScenario];

  const skeleton = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="rounded-md border border-[#D9D7D0] bg-white p-5 lg:col-span-8">
        <div className="h-4 w-48 rounded bg-[#E8E6E0]" />
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded bg-[#FAF9F6]" />
          ))}
        </div>
        <div className="mt-5 h-24 rounded bg-[#FAF9F6]" />
      </div>
      <div className="rounded-md border border-[#D9D7D0] bg-white p-5 lg:col-span-4">
        <div className="h-4 w-40 rounded bg-[#E8E6E0]" />
        <div className="mt-4 h-24 rounded bg-[#FAF9F6]" />
      </div>
    </div>
  );

  return (
    <section id="section-pacing" aria-label="Target pacing" className="space-y-4">
      <SectionHeader
        title="Target pacing"
        meta={
          recordClass && asOfDate ? `${recordClass} · as of ${asOfDate}` : undefined
        }
        action={
          <div
            role="group"
            aria-label="Approved pacing scenario"
            className="inline-flex rounded-md border border-[#D9D7D0] bg-white p-0.5"
          >
            {SCENARIO_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onSelectScenario(key)}
                className={`rounded px-3 py-1 text-[12px] font-medium transition-colors duration-150 whitespace-nowrap ${
                  selectedScenario === key
                    ? 'bg-[#315F52] text-white'
                    : 'text-[#525E58] hover:text-[#202824]'
                }`}
              >
                {pacing.scenarioTargets[key].shortLabel ??
                  pacing.scenarioTargets[key].label}
              </button>
            ))}
          </div>
        }
      />

      <DataStateWrapper
        status={status}
        error={error}
        onRetry={onRetry}
        loadingSkeleton={skeleton}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left: Signed value scenario & W1..W10 series + Base/Plan gates */}
          <div className="flex flex-col justify-between rounded-md border border-[#D9D7D0] bg-white p-5 lg:col-span-8">
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[#E8E6E0] pb-4">
                <div>
                  <p className="text-[12px] font-medium text-[#788C83]">
                    Actual signed value (M-02)
                  </p>
                  {pacing.actualSignedFormatted ? (
                    <p className="mt-1 text-[26px] font-semibold tracking-[-0.02em] text-[#202824] tabular-nums">
                      {pacing.actualSignedFormatted}
                    </p>
                  ) : (
                    <p className="mt-1 text-[14px] font-medium text-[#788C83]">
                      {pacing.actualSignedReason || 'Not computable'}
                    </p>
                  )}
                </div>

                {pacing.latestGateStatusLabel ? (
                  <div className="text-left sm:text-center">
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Latest passed checkpoint ({pacing.latestGateWeekLabel})
                    </p>
                    <p className="mt-1 font-mono text-[13px] font-semibold text-[#9B3B32]">
                      {pacing.latestGateStatusLabel}
                    </p>
                  </div>
                ) : null}

                <div className="text-left sm:text-right">
                  <p className="text-[12px] font-medium text-[#788C83]">
                    {activeScenarioData.label}
                  </p>
                  <p className="mt-1 font-mono text-[16px] font-semibold text-[#202824] tabular-nums">
                    {activeScenarioData.targetFormatted ?? '—'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#525E58] tabular-nums">
                    Collected (M-01):{' '}
                    {activeScenarioData.cashCollectedFormatted ??
                      activeScenarioData.cashCollectedReason ??
                      'Not computable'}
                    {activeScenarioData.p50Formatted
                      ? ` · ${activeScenarioData.p50Formatted}`
                      : ''}
                  </p>
                </div>
              </div>

              {/* Base / Plan / Stretch comparison strip */}
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {SCENARIO_ORDER.map((key) => {
                  const item = pacing.scenarioTargets[key];
                  const isActive = key === selectedScenario;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onSelectScenario(key)}
                      className={`rounded border px-3.5 py-2.5 text-left transition-colors duration-150 ${
                        isActive
                          ? 'border-[#315F52] bg-[#EBF1EE]/40'
                          : 'border-[#E8E6E0] bg-[#FAF9F6] hover:border-[#788C83]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold text-[#202824]">
                          {item.label}
                        </span>
                        {isActive ? (
                          <span className="font-mono text-[11px] text-[#315F52] shrink-0">
                            Active
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1.5 flex items-baseline justify-between gap-2">
                        <span className="font-mono text-[14px] font-semibold text-[#202824] tabular-nums">
                          {item.targetFormatted ?? '—'}
                        </span>
                        {item.p50Formatted ? (
                          <span className="font-mono text-[11px] text-[#788C83] tabular-nums">
                            {item.p50Formatted}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-[#525E58] tabular-nums">
                        Collected (M-01):{' '}
                        {item.cashCollectedFormatted ??
                          item.cashCollectedReason ??
                          'Not computable'}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Weekly milestones track (W1..W10 M-08 series + Base & Plan gate lines) */}
              <div className="mt-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12px] font-medium text-[#525E58]">
                    Weekly signed pacing series (M-08) &amp; K-G-01 Base / Plan gates
                  </p>
                  <span className="font-mono text-[11px] text-[#788C83]">
                    Base (SC-01) · Plan (SC-02)
                  </span>
                </div>

                {pacing.weeklyMilestones.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {pacing.weeklyMilestones.map((week) => (
                      <div
                        key={week.weekId}
                        className={`rounded border px-2.5 py-2 ${
                          week.passed
                            ? 'border-[#D9D7D0] bg-[#FAF9F6]'
                            : 'border-[#E8E6E0] bg-white opacity-75'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-[11px] font-semibold text-[#202824]">
                            {week.label}
                          </span>
                          <span className="font-mono text-[10px] text-[#788C83]">
                            {week.weekEnd ? week.weekEnd.slice(5) : ''}
                          </span>
                        </div>
                        <div
                          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-xs bg-[#E8E6E0]"
                          aria-hidden="true"
                        >
                          <div
                            className="h-full bg-[#315F52]"
                            style={{
                              width:
                                week.progressRatio !== null
                                  ? `${Math.min(100, Math.max(4, week.progressRatio * 100))}%`
                                  : '0%',
                            }}
                          />
                        </div>
                        <p className="mt-1.5 font-mono text-[11px] font-medium text-[#202824] tabular-nums">
                          {week.actualFormatted ?? week.reason ?? '—'}
                        </p>
                        {week.baseTargetFormatted || week.planTargetFormatted ? (
                          <p className="mt-0.5 font-mono text-[10px] text-[#788C83] tabular-nums">
                            B {week.baseTargetFormatted ?? '—'} · P{' '}
                            {week.planTargetFormatted ?? '—'}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-[#788C83]">
                    No weekly checkpoint schedule configured for this edition.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Right: Separate T−7 Cash Collection Gate */}
          <div className="flex flex-col justify-between rounded-md border border-[#315F52]/60 bg-white p-5 lg:col-span-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-[14px] font-semibold text-[#202824]">
                    {pacing.cashCollectionGate.gateLabel}
                  </h3>
                  <InfoHint
                    label="T−7 cash collection gate definition"
                    content="Cash collection gate evaluated 7 days before festival start (M-06 ≥ 85%), tracked separately from W4–W9 signed-value milestones."
                  />
                </div>
                <span className="font-mono text-[11px] text-[#315F52] whitespace-nowrap">
                  Separate gate
                </span>
              </div>

              <div className="mt-5 space-y-3.5 border-t border-[#E8E6E0] pt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] text-[#788C83]">
                    Cash collected (M-01)
                  </span>
                  <span className="text-[18px] font-semibold text-[#202824] tabular-nums text-right">
                    {pacing.cashCollectionGate.collectedFormatted ?? '—'}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] text-[#788C83]">
                    Collection rate (M-06)
                  </span>
                  <span className="font-mono text-[14px] font-medium text-[#315F52] tabular-nums text-right">
                    {pacing.cashCollectionGate.collectionRateFormatted ?? '—'}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] text-[#788C83]">
                    Outstanding cash (M-07)
                  </span>
                  <span className="font-mono text-[13px] text-[#525E58] tabular-nums text-right">
                    {pacing.cashCollectionGate.outstandingFormatted ?? '—'}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] text-[#788C83]">
                    Gate target
                  </span>
                  <span className="font-mono text-[13px] text-[#525E58] tabular-nums text-right">
                    {pacing.cashCollectionGate.gateTargetFormatted ?? '—'}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-2 rounded border border-[#E8E6E0] bg-[#FAF9F6] px-3 py-2">
              <span className="text-[12px] text-[#788C83]">Status</span>
              <span className="font-mono text-[12px] font-medium text-[#202824] text-right">
                {pacing.cashCollectionGate.gateStatusLabel ?? '—'}
              </span>
            </div>
          </div>
        </div>
      </DataStateWrapper>
    </section>
  );
}
