import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  description?: string;
  meta?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, description, meta, action }: SectionHeaderProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-[#202824]">
            {title}
          </h2>
          {meta ? (
            <span className="font-mono text-[11px] text-[#788C83] tabular-nums">
              {meta}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="mt-1 text-[13px] leading-relaxed text-[#525E58]">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
