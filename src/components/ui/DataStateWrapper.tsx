import { AlertCircle, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ApiErrorInfo, DataLoadStatus } from '../../types/overview';

interface DataStateWrapperProps {
  status: DataLoadStatus;
  error: ApiErrorInfo | null;
  onRetry?: () => void;
  loadingSkeleton: ReactNode;
  children: ReactNode;
}

export function DataStateWrapper({
  status,
  error,
  onRetry,
  loadingSkeleton,
  children,
}: DataStateWrapperProps) {
  if (status === 'loading') {
    return <div aria-busy="true">{loadingSkeleton}</div>;
  }

  if (status === 'error') {
    return (
      <div
        role="alert"
        className="rounded-md border border-[#D9D7D0] bg-white p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-[#9B3B32]"
              aria-hidden="true"
            />
            <div>
              <h3 className="text-[13px] font-semibold text-[#202824]">
                Unable to load data
              </h3>
              <p className="mt-0.5 text-[13px] text-[#525E58]">
                {error?.message ?? 'Please try refreshing this view.'}
              </p>
            </div>
          </div>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6] whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5 text-[#525E58]" aria-hidden="true" />
              Retry
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

interface EmptyStateNoticeProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyStateNotice({
  title,
  description,
  action,
}: EmptyStateNoticeProps) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-md border border-dashed border-[#D9D7D0] bg-[#FAF9F6] px-5 py-5 sm:flex-row sm:items-center">
      <div>
        <p className="text-[13px] font-medium text-[#202824]">{title}</p>
        {description ? (
          <p className="mt-1 text-[13px] text-[#525E58]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
