import { AlertCircle, RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AnalystApiError } from '../../services/analystApi';
import type {
  AiActionRecord,
  AiChatMessage,
  AiPermissionProfile,
} from '../../types/analyst';
import { ChatComposer } from './ChatComposer';
import { ChatMessage } from './ChatMessage';

const INVESTIGATION_STARTERS: ReadonlyArray<string> = [
  'What is our signed value vs the approved base target?',
  'Which campaign is leaking the most qualified leads?',
  'How much cash did we collect in 2025?',
  'Which signed partnerships still have outstanding cash?',
  'What is our T-55 base target in D-009?',
  'How much cash have we collected before fest?',
];

interface GrowthAnalystChatProps {
  messages: AiChatMessage[];
  actions: AiActionRecord[];
  permissionProfile: AiPermissionProfile;
  sending: boolean;
  loadingConversation: boolean;
  error: AnalystApiError | null;
  dataVersionChanged: boolean;
  actionProcessingId: string | null;
  actionErrorById: Record<string, string>;
  initialDraft?: string | null;
  onSend: (message: string) => Promise<void>;
  onDismissError: () => void;
  onClearDataVersionChanged: () => void;
  onRequestConfirmAction: (action: AiActionRecord) => void;
  onCancelAction: (actionId: string) => void;
  onOpenRecord?: (recordType: string, recordId: string) => void;
  onSubmitFeedback?: (
    messageId: string,
    queryId: string,
    rating: 'up' | 'down'
  ) => Promise<void> | void;
  compact?: boolean;
}

export function GrowthAnalystChat({
  messages,
  actions,
  permissionProfile,
  sending,
  loadingConversation,
  error,
  dataVersionChanged,
  actionProcessingId,
  actionErrorById,
  initialDraft,
  onSend,
  onDismissError,
  onClearDataVersionChanged,
  onRequestConfirmAction,
  onCancelAction,
  onOpenRecord,
  onSubmitFeedback,
  compact = false,
}: GrowthAnalystChatProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const actionsById = actions.reduce<Record<string, AiActionRecord>>(
    (acc, item) => {
      acc[item.ai_action_id] = item;
      return acc;
    },
    {}
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, sending, error]);

  return (
    <div className="flex min-h-[460px] flex-col justify-between gap-4">
      <div className="space-y-4">
        {dataVersionChanged ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-3.5 py-2.5 text-[12px] text-[#202824]">
            <div className="flex items-center gap-2">
              <RefreshCw
                className="h-3.5 w-3.5 shrink-0 text-[#315F52]"
                aria-hidden="true"
              />
              <span>
                Underlying sponsorship data has updated since the previous turn.
                Follow-up questions will retrieve fresh figures.
              </span>
            </div>
            <button
              type="button"
              onClick={onClearDataVersionChanged}
              className="shrink-0 text-[11px] font-medium text-[#525E58] hover:text-[#202824]"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {loadingConversation ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-16 animate-pulse rounded-md border border-[#D9D7D0] bg-white" />
            <div className="h-28 animate-pulse rounded-md border border-[#D9D7D0] bg-white" />
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
            <h2 className="text-[15px] font-semibold text-[#202824]">
              Ask a grounded sponsorship question
            </h2>
            <div className="mt-3 divide-y divide-[#E8E6E0] rounded border border-[#E8E6E0]">
              {INVESTIGATION_STARTERS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={sending}
                  onClick={() => void onSend(prompt)}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-[13px] text-[#202824] transition-colors hover:bg-[#FAF9F6] disabled:opacity-50"
                >
                  <span>{prompt}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <ChatMessage
                key={msg.message_id}
                message={msg}
                actionsById={actionsById}
                permissionProfile={permissionProfile}
                actionProcessingId={actionProcessingId}
                actionErrorById={actionErrorById}
                onSelectFollowUp={(q) => void onSend(q)}
                onRequestConfirmAction={onRequestConfirmAction}
                onCancelAction={onCancelAction}
                onOpenRecord={onOpenRecord}
                onSubmitFeedback={onSubmitFeedback}
                compact={compact}
              />
            ))}
          </div>
        )}

        {sending ? (
          <div
            aria-live="polite"
            className="rounded-md border border-[#D9D7D0] bg-white px-4 py-3 text-[13px] text-[#525E58]"
          >
            Retrieving current metrics and source evidence...
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-[#D9D7D0] bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#9B3B32]"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-[13px] font-semibold text-[#202824]">
                    {error.status === 403
                      ? 'Permission restricted'
                      : 'Growth Analyst service unavailable'}
                  </p>
                  <p className="mt-0.5 text-[12px] text-[#525E58]">
                    {error.message}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismissError}
                className="shrink-0 text-[12px] font-medium text-[#525E58] hover:text-[#202824]"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-2 z-10 bg-[#F3F1EB] pt-2">
        <ChatComposer
          onSend={onSend}
          sending={sending}
          disabled={
            permissionProfile.verifiedByServer && !permissionProfile.canUseAnalyst
          }
          initialDraft={initialDraft}
          compact={compact}
        />
      </div>
    </div>
  );
}
