import { ArrowRight } from 'lucide-react';
import type {
  ApiErrorInfo,
  DataLoadStatus,
  NavSectionId,
  TeamExecutionSnapshot,
} from '../../types/overview';
import { DataStateWrapper } from '../ui/DataStateWrapper';
import { SectionHeader } from '../ui/SectionHeader';

interface TeamExecutionSectionProps {
  execution: TeamExecutionSnapshot;
  status: DataLoadStatus;
  error: ApiErrorInfo | null;
  onRetry: () => void;
  onNavigateSection: (section: NavSectionId) => void;
}

export function TeamExecutionSection({
  execution,
  status,
  error,
  onRetry,
  onNavigateSection,
}: TeamExecutionSectionProps) {
  const skeleton = (
    <div className="grid grid-cols-2 gap-4 rounded-md border border-[#D9D7D0] bg-white p-5 lg:grid-cols-4">
      {[0, 1, 2, 3].map((idx) => (
        <div key={idx}>
          <div className="h-3 w-20 rounded bg-[#E8E6E0]" />
          <div className="mt-2.5 h-6 w-12 rounded bg-[#E8E6E0]" />
        </div>
      ))}
    </div>
  );

  const items = [
    {
      label: 'Open tasks',
      value:
        execution.openTasksCount !== null
          ? String(execution.openTasksCount)
          : '—',
      isText: false,
    },
    {
      label: 'Overdue work',
      value:
        execution.overdueTasksCount !== null
          ? String(execution.overdueTasksCount)
          : '—',
      isText: false,
    },
    {
      label: 'Active owners',
      value:
        execution.activeOwnersCount !== null
          ? String(execution.activeOwnersCount)
          : '—',
      isText: false,
    },
    {
      label: 'Cash per active owner (M-27)',
      value: execution.capacityStatusLabel ?? execution.capacityReason ?? '—',
      isText: !execution.capacityStatusLabel,
    },
  ];

  return (
    <section
      id="section-team"
      aria-label="Team execution"
      className="space-y-4"
    >
      <SectionHeader
        title="Team execution"
        action={
          <button
            type="button"
            onClick={() => onNavigateSection('tasks')}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#315F52] hover:underline whitespace-nowrap"
          >
            View tasks
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        }
      />

      <DataStateWrapper
        status={status}
        error={error}
        onRetry={onRetry}
        loadingSkeleton={skeleton}
      >
        <div className="grid grid-cols-1 divide-y divide-[#E8E6E0] rounded-md border border-[#D9D7D0] bg-white sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.label} className="p-5">
              <p className="text-[12px] font-medium text-[#788C83]">
                {item.label}
              </p>
              <p
                className={`mt-2 tracking-[-0.02em] ${
                  item.isText
                    ? 'text-[13px] font-medium text-[#788C83]'
                    : 'text-[22px] font-semibold text-[#202824] tabular-nums'
                }`}
              >
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </DataStateWrapper>
    </section>
  );
}
