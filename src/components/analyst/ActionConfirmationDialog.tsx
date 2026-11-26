import { ShieldCheck, X } from 'lucide-react';
import { useEffect } from 'react';
import { formatAiActionType } from '../../services/analystApi';
import type { AiActionRecord } from '../../types/analyst';

interface ActionConfirmationDialogProps {
  action: AiActionRecord | null;
  processing?: boolean;
  onConfirm: (actionId: string) => void;
  onClose: () => void;
}

export function ActionConfirmationDialog({
  action,
  processing = false,
  onConfirm,
  onClose,
}: ActionConfirmationDialogProps) {
  useEffect(() => {
    if (!action) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !processing) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [action, processing, onClose]);

  if (!action) return null;

  const entries = Object.entries(action.payload ?? {});

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#202824]/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-ai-action-title"
    >
      <div className="w-full max-w-lg rounded-md border border-[#D9D7D0] bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-[#D9D7D0] px-5 py-4">
          <div className="flex items-start gap-2.5">
            <ShieldCheck
              className="mt-0.5 h-5 w-5 shrink-0 text-[#315F52]"
              aria-hidden="true"
            />
            <div>
              <p className="font-mono text-[11px] text-[#788C83]">
                {action.ai_action_id} · {action.permission_level}
              </p>
              <h2
                id="confirm-ai-action-title"
                className="text-[16px] font-semibold text-[#202824]"
              >
                Confirm {formatAiActionType(action.action_type).toLowerCase()}
              </h2>
            </div>
          </div>

          <button
            type="button"
            disabled={processing}
            onClick={onClose}
            aria-label="Close confirmation dialog"
            className="flex h-8 w-8 items-center justify-center rounded text-[#525E58] hover:bg-[#FAF9F6] hover:text-[#202824]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {action.affected_summary ? (
            <p className="text-[13px] text-[#202824]">
              {action.affected_summary}
            </p>
          ) : null}

          <div className="rounded-md border border-[#E8E6E0] bg-[#FAF9F6] p-3.5">
            <p className="mb-2 text-[11px] font-medium text-[#788C83]">
              Exact payload to execute
            </p>
            {entries.length === 0 ? (
              <p className="text-[12px] text-[#525E58]">Empty payload</p>
            ) : (
              <dl className="divide-y divide-[#E8E6E0] text-[12px]">
                {entries.map(([key, val]) => (
                  <div
                    key={key}
                    className="grid grid-cols-1 gap-1 py-1.5 sm:grid-cols-3"
                  >
                    <dt className="font-mono text-[#525E58]">{key}</dt>
                    <dd className="break-words font-medium text-[#202824] sm:col-span-2">
                      {val === null || val === undefined || val === ''
                        ? '—'
                        : typeof val === 'object'
                          ? JSON.stringify(val)
                          : String(val)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {action.payload_hash ? (
            <p className="font-mono text-[11px] text-[#788C83]">
              Payload hash: {action.payload_hash}
            </p>
          ) : null}

          <p className="text-[12px] text-[#525E58]">
            Confirming writes this exact immutable payload under your account
            permissions and logs an audit event.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-[#D9D7D0] bg-[#FAF9F6] px-5 py-3.5">
          <button
            type="button"
            disabled={processing}
            onClick={onClose}
            className="h-9 rounded-md border border-[#D9D7D0] bg-white px-4 text-[13px] font-medium text-[#202824] hover:bg-[#FAF9F6] disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="button"
            disabled={processing}
            onClick={() => onConfirm(action.ai_action_id)}
            className="h-9 rounded-md bg-[#315F52] px-4 text-[13px] font-medium text-white hover:bg-[#264B40] disabled:cursor-not-allowed disabled:bg-[#788C83]"
          >
            {processing ? 'Executing...' : 'Confirm & execute'}
          </button>
        </div>
      </div>
    </div>
  );
}
