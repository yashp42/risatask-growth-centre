import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

interface SlideOverDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  meta?: string;
  children: ReactNode;
}

export function SlideOverDrawer({
  open,
  onClose,
  title,
  subtitle,
  meta,
  children,
}: SlideOverDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      <div
        className="fixed inset-0 bg-[#202824]/25 transition-opacity duration-150"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="relative z-10 flex h-full w-full max-w-lg flex-col border-l border-[#D9D7D0] bg-white shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b border-[#D9D7D0] px-6 py-5">
          <div className="min-w-0">
            {meta ? (
              <p className="font-mono text-[11px] text-[#788C83]">{meta}</p>
            ) : null}
            <h2
              id="drawer-title"
              className="mt-1 text-[18px] font-semibold tracking-[-0.015em] text-[#202824]"
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1 text-[13px] leading-relaxed text-[#525E58]">
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#D9D7D0] text-[#525E58] transition-colors duration-150 hover:bg-[#FAF9F6] hover:text-[#202824]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </aside>
    </div>
  );
}
