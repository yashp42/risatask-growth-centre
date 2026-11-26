import { RotateCcw } from 'lucide-react';
import {
  ANALYST_EDITION_BY_CLASS,
  ANALYST_RECORD_CLASS_OPTIONS,
  formatRecordClassLabel,
} from '../../services/analystApi';
import type { GrowthAnalystSessionFilterState } from '../../hooks/useGrowthAnalystSession';
import type { AiQuotaInfo, AiRecordClass } from '../../types/analyst';
import { SelectControl } from '../ui/SelectControl';

interface DataContextHeaderProps {
  filters: GrowthAnalystSessionFilterState;
  onChangeRecordClass: (nextClass: AiRecordClass) => void;
  onChangeEdition: (editionId: string) => void;
  onChangeAsOf: (asOf: string) => void;
  dataVersion: string | number | null;
  quota: AiQuotaInfo | null;
  conversationId: string | null;
  onResetConversation: () => void;
  pendingActionCount: number;
  mobilePanel: 'chat' | 'evidence' | 'actions';
  onChangeMobilePanel: (panel: 'chat' | 'evidence' | 'actions') => void;
}

export function DataContextHeader({
  filters,
  onChangeRecordClass,
  onChangeEdition,
  onChangeAsOf,
  dataVersion,
  quota,
  conversationId,
  onResetConversation,
  pendingActionCount,
  mobilePanel,
  onChangeMobilePanel,
}: DataContextHeaderProps) {
  const editionOptions = ANALYST_EDITION_BY_CLASS[filters.record_class];
  const remainingLabel =
    quota?.exhausted
      ? 'AI requests left today: 0 (resets 05:30 IST)'
      : quota && typeof quota.remaining === 'number'
        ? `AI requests left today: ${quota.remaining}`
        : 'AI requests left today: —';

  return (
    <header className="border-b border-[#D9D7D0] pb-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-[#202824]">
              Growth Analyst
            </h1>
            <span className="rounded border border-[#D9D7D0] bg-[#FAF9F6] px-2 py-0.5 font-mono text-[11px] font-medium text-[#315F52]">
              {filters.edition_id} · {formatRecordClassLabel(filters.record_class)}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-[#788C83]">
            <span
              className={
                quota?.exhausted ? 'font-medium text-[#9B3B32]' : 'text-[#525E58]'
              }
            >
              {remainingLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span>As of {filters.as_of}</span>
            {dataVersion !== null && dataVersion !== undefined ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Data v{String(dataVersion)}</span>
              </>
            ) : null}
            {conversationId ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Thread {conversationId}</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-52">
            <SelectControl
              id="analyst-record-class"
              label="Data class"
              value={filters.record_class}
              options={ANALYST_RECORD_CLASS_OPTIONS}
              onChange={(val) => onChangeRecordClass(val as AiRecordClass)}
            />
          </div>

          <div className="w-44">
            <SelectControl
              id="analyst-edition"
              label="Edition"
              value={filters.edition_id}
              options={editionOptions}
              onChange={onChangeEdition}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="analyst-as-of"
              className="text-[11px] font-medium text-[#788C83] whitespace-nowrap"
            >
              As of date
            </label>
            <input
              id="analyst-as-of"
              type="date"
              value={filters.as_of}
              onChange={(e) => {
                if (e.target.value) onChangeAsOf(e.target.value);
              }}
              className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] font-medium text-[#202824] transition-colors hover:border-[#788C83] focus:border-[#315F52] focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={onResetConversation}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] font-medium text-[#202824] transition-colors hover:bg-[#FAF9F6]"
          >
            <RotateCcw className="h-3.5 w-3.5 text-[#525E58]" aria-hidden="true" />
            <span>New thread</span>
          </button>
        </div>
      </div>

      {/* Mobile sheet switcher for Conversation / Evidence / Actions */}
      <div
        role="tablist"
        aria-label="Growth Analyst mobile panels"
        className="mt-4 flex gap-1 rounded-md border border-[#D9D7D0] bg-white p-1 lg:hidden"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mobilePanel === 'chat'}
          onClick={() => onChangeMobilePanel('chat')}
          className={`flex-1 rounded px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
            mobilePanel === 'chat'
              ? 'bg-[#315F52] text-white'
              : 'text-[#525E58] hover:text-[#202824]'
          }`}
        >
          Conversation
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePanel === 'evidence'}
          onClick={() => onChangeMobilePanel('evidence')}
          className={`flex-1 rounded px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
            mobilePanel === 'evidence'
              ? 'bg-[#315F52] text-white'
              : 'text-[#525E58] hover:text-[#202824]'
          }`}
        >
          Evidence
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePanel === 'actions'}
          onClick={() => onChangeMobilePanel('actions')}
          className={`flex-1 rounded px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
            mobilePanel === 'actions'
              ? 'bg-[#315F52] text-white'
              : 'text-[#525E58] hover:text-[#202824]'
          }`}
        >
          Actions{pendingActionCount > 0 ? ` (${pendingActionCount})` : ''}
        </button>
      </div>
    </header>
  );
}
