import { AlertCircle, Compass, Maximize2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { UseGrowthAnalystSessionResult } from '../../hooks/useGrowthAnalystSession';
import { formatRecordClassLabel } from '../../services/analystApi';
import { findNavItem } from '../../services/overviewApi';
import type { AiActionRecord } from '../../types/analyst';
import type { NavSectionId } from '../../types/overview';
import { ActionConfirmationDialog } from './ActionConfirmationDialog';
import { ChatComposer } from './ChatComposer';
import { ChatMessage } from './ChatMessage';

const PANEL_STARTERS: ReadonlyArray<string> = [
  'Which campaign is leaking the most qualified leads?',
  'How much cash did we collect in 2025?',
  'Which signed partnerships still have outstanding cash?',
];

interface GrowthAnalystPanelProps {
  open: boolean;
  onClose: () => void;
  contextSection: NavSectionId;
  session: UseGrowthAnalystSessionResult;
  onOpenFullWorkspace: (promptContext?: string) => void;
  onOpenRecord?: (recordType: string, recordId: string) => void;
}

export function GrowthAnalystPanel({
  open,
  onClose,
  contextSection,
  session,
  onOpenFullWorkspace,
  onOpenRecord,
}: GrowthAnalystPanelProps) {
  const [pendingConfirmAction, setPendingConfirmAction] =
    useState<AiActionRecord | null>(null);
  const currentView = findNavItem(contextSection);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  const actionsById = session.actions.reduce<Record<string, AiActionRecord>>(
    (acc, item) => {
      acc[item.ai_action_id] = item;
      return acc;
    },
    {}
  );

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pendingConfirmAction) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, pendingConfirmAction, onClose]);

  useEffect(() => {
    if (open) {
      feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [open, session.messages.length, session.sending]);

  if (!open) return null;

  return (
    <>
      {/* Mobile backdrop for bottom sheet */}
      <div
        className="fixed inset-0 z-40 bg-[#202824]/25 sm:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="false"
        aria-label="Growth Analyst"
        className="fixed inset-x-0 bottom-0 z-50 flex h-[84vh] max-h-[680px] flex-col rounded-t-xl border-t border-[#D9D7D0] bg-white shadow-2xl sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[560px] sm:max-h-[calc(100vh-5.5rem)] sm:w-[420px] sm:rounded-md sm:border sm:shadow-xl"
      >
        {/* Drag handle on mobile */}
        <div className="flex justify-center pt-2 sm:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-[#D9D7D0]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[#D9D7D0] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[#EBF1EE] text-[#315F52]">
              <Compass className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[14px] font-semibold text-[#202824]">
                Growth Analyst
              </h2>
              <p className="truncate font-mono text-[11px] text-[#788C83]">
                {currentView.label} ·{' '}
                {formatRecordClassLabel(session.filters.record_class)}
                {session.quota && typeof session.quota.remaining === 'number'
                  ? ` · AI requests left today: ${session.quota.remaining}`
                  : ''}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenFullWorkspace();
              }}
              title="Open Growth Analyst workspace"
              aria-label="Open Growth Analyst workspace"
              className="flex h-8 w-8 items-center justify-center rounded text-[#525E58] transition-colors duration-150 hover:bg-[#FAF9F6] hover:text-[#202824]"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Growth Analyst"
              className="flex h-8 w-8 items-center justify-center rounded text-[#525E58] transition-colors duration-150 hover:bg-[#FAF9F6] hover:text-[#202824]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Conversation Body */}
        <div className="flex-1 space-y-3 overflow-y-auto bg-[#F3F1EB]/50 px-3.5 py-3.5">
          {session.messages.length === 0 ? (
            <div className="space-y-3">
              <div className="rounded border border-[#E8E6E0] bg-white p-3">
                <p className="text-[12px] font-medium text-[#202824]">
                  {session.filters.edition_id} · As of {session.filters.as_of}
                </p>
                <p className="mt-0.5 text-[12px] text-[#525E58]">
                  Ask a grounded question or expand to the full workspace for
                  side-by-side evidence and action review.
                </p>
              </div>

              <div className="divide-y divide-[#E8E6E0] rounded border border-[#E8E6E0] bg-white">
                {PANEL_STARTERS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={session.sending}
                    onClick={() => void session.sendMessage(prompt)}
                    className="block w-full px-3 py-2.5 text-left text-[12px] text-[#202824] transition-colors hover:bg-[#FAF9F6] disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            session.messages.map((msg) => (
              <ChatMessage
                key={msg.message_id}
                message={msg}
                actionsById={actionsById}
                permissionProfile={session.permissionProfile}
                actionProcessingId={session.actionProcessingId}
                actionErrorById={session.actionErrorById}
                onSelectFollowUp={(q) => void session.sendMessage(q)}
                onRequestConfirmAction={setPendingConfirmAction}
                onCancelAction={(id) => void session.cancelAction(id)}
                onOpenRecord={(type, id) => {
                  onClose();
                  onOpenRecord?.(type, id);
                }}
                onSubmitFeedback={session.submitFeedback}
                compact
              />
            ))
          )}

          {session.sending ? (
            <div className="rounded border border-[#D9D7D0] bg-white px-3 py-2.5 text-[12px] text-[#525E58]">
              Retrieving metrics and evidence...
            </div>
          ) : null}

          {session.error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded border border-[#D9D7D0] bg-white p-3 text-[12px]"
            >
              <AlertCircle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9B3B32]"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[#202824]">
                  {session.error.status === 403
                    ? 'Permission restricted'
                    : 'Growth Analyst service unavailable'}
                </p>
                <p className="mt-0.5 text-[#525E58]">{session.error.message}</p>
              </div>
              <button
                type="button"
                onClick={session.dismissError}
                className="shrink-0 text-[11px] font-medium text-[#525E58] hover:text-[#202824]"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          <div ref={feedEndRef} />
        </div>

        {/* Live Composer Footer */}
        <div className="border-t border-[#D9D7D0] bg-[#FAF9F6] p-3">
          <ChatComposer
            onSend={session.sendMessage}
            sending={session.sending}
            disabled={
              session.permissionProfile.verifiedByServer &&
              !session.permissionProfile.canUseAnalyst
            }
            compact
            placeholder="Ask Growth Analyst..."
          />
        </div>
      </aside>

      <ActionConfirmationDialog
        action={pendingConfirmAction}
        processing={
          pendingConfirmAction
            ? session.actionProcessingId === pendingConfirmAction.ai_action_id
            : false
        }
        onConfirm={async (id) => {
          await session.confirmAction(id);
          setPendingConfirmAction(null);
        }}
        onClose={() => setPendingConfirmAction(null)}
      />
    </>
  );
}
