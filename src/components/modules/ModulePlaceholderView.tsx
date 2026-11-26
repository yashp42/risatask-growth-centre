import { ArrowLeft } from 'lucide-react';
import { findNavItem } from '../../services/overviewApi';
import type { NavSectionId } from '../../types/overview';

interface ModulePlaceholderViewProps {
  sectionId: Exclude<NavSectionId, 'overview'>;
  analystPromptContext: string | null;
  onReturnToOverview: () => void;
}

export function ModulePlaceholderView({
  sectionId,
  analystPromptContext,
  onReturnToOverview,
}: ModulePlaceholderViewProps) {
  const navItem = findNavItem(sectionId);
  const isAnalyst = sectionId === 'growth-analyst';

  return (
    <div className="space-y-6 pb-8">
      <div className="border-b border-[#D9D7D0] pb-5">
        <p className="font-mono text-[11px] text-[#788C83]">
          {navItem.groupLabel}
        </p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.025em] text-[#202824]">
          {navItem.label}
        </h1>
      </div>

      <div className="rounded-md border border-[#D9D7D0] bg-white p-6">
        {isAnalyst && analystPromptContext ? (
          <div className="mb-5 rounded border border-[#315F52]/40 bg-[#EBF1EE]/40 p-4">
            <p className="font-mono text-[11px] text-[#315F52]">
              Selected inquiry
            </p>
            <p className="mt-1 text-[14px] font-medium text-[#202824]">
              {analystPromptContext}
            </p>
          </div>
        ) : null}

        <h2 className="text-[15px] font-semibold text-[#202824]">
          Scheduled for a future build
        </h2>
        <p className="mt-1 text-[13px] text-[#525E58]">
          {navItem.label} is not yet active in this workspace.
        </p>

        <div className="mt-5">
          <button
            type="button"
            onClick={onReturnToOverview}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#D9D7D0] bg-white px-3.5 text-[13px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6]"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#525E58]" aria-hidden="true" />
            Return to Growth overview
          </button>
        </div>
      </div>
    </div>
  );
}
