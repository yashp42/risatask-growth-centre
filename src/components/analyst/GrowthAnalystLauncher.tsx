import { Compass } from 'lucide-react';

interface GrowthAnalystLauncherProps {
  visible: boolean;
  onClick: () => void;
}

export function GrowthAnalystLauncher({
  visible,
  onClick,
}: GrowthAnalystLauncherProps) {
  if (!visible) return null;

  return (
    <div className="group fixed right-5 bottom-5 z-40 sm:right-6 sm:bottom-6">
      {/* Hover / focus tooltip */}
      <span
        role="tooltip"
        className="pointer-events-none absolute top-1/2 right-full mr-2.5 hidden -translate-y-1/2 rounded bg-[#202824] px-2.5 py-1 text-[12px] font-medium text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 sm:block whitespace-nowrap"
      >
        Open Growth Analyst
      </span>

      <button
        type="button"
        onClick={onClick}
        aria-label="Open Growth Analyst"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-[#315F52] text-white shadow-md transition-all duration-150 hover:bg-[#264B40] hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#315F52]"
      >
        <Compass className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}
