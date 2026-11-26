import { AlertTriangle, RefreshCw } from 'lucide-react';
import {
  formatAiRouteLabel,
  formatRecordClassLabel,
  verifyAnalystResponseIntegrity,
} from '../../services/analystApi';
import type {
  AiActionRecord,
  AiChatMessage,
  AiPermissionProfile,
} from '../../types/analyst';
import { CitationList } from './CitationList';
import { MetricEvidenceCard } from './MetricEvidenceCard';
import { ProposedActionCard } from './ProposedActionCard';

interface ChatMessageProps {
  message: AiChatMessage;
  actionsById: Record<string, AiActionRecord>;
  permissionProfile: AiPermissionProfile;
  actionProcessingId: string | null;
  actionErrorById: Record<string, string>;
  onSelectFollowUp?: (question: string) => void;
  onRequestConfirmAction: (action: AiActionRecord) => void;
  onCancelAction: (actionId: string) => void;
  onOpenRecord?: (recordType: string, recordId: string) => void;
  compact?: boolean;
}

export function ChatMessage({
  message,
  actionsById,
  permissionProfile,
  actionProcessingId,
  actionErrorById,
  onSelectFollowUp,
  onRequestConfirmAction,
  onCancelAction,
  onOpenRecord,
  compact = false,
}: ChatMessageProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-4 py-3 text-[13px] leading-relaxed text-[#202824]">
          <p className="whitespace-pre-wrap">{message.content}</p>
          {message.context_snapshot ? (
            <p className="mt-1.5 font-mono text-[10px] text-[#788C83]">
              {formatRecordClassLabel(message.context_snapshot.record_class)} ·{' '}
              {message.context_snapshot.edition_id} · As of{' '}
              {message.context_snapshot.as_of}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const structured = message.structured;
  const integrity = structured
    ? verifyAnalystResponseIntegrity(structured)
    : null;
  const routeLabel = formatAiRouteLabel(structured?.route);
  const resolvedActions = (structured?.action_ids ?? [])
    .map((id) => actionsById[id])
    .filter((a): a is AiActionRecord => Boolean(a));

  // Fallback to inline actions if action_ids wasn't populated separately
  const displayActions =
    resolvedActions.length > 0
      ? resolvedActions
      : (structured?.actions ?? []).map(
          (a) => actionsById[a.ai_action_id] ?? a
        );

  return (
    <article className="rounded-md border border-[#D9D7D0] bg-white p-4 sm:p-5">
      {/* Header metadata line (unboxed typography, zero pill badges) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8E6E0] pb-2.5 text-[11px] text-[#788C83]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-semibold text-[#315F52]">Growth Analyst</span>
          {routeLabel ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{routeLabel}</span>
            </>
          ) : null}
          {structured?.data_labels && structured.data_labels.length > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-[#525E58]">
                {structured.data_labels.join(' · ')}
              </span>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2 font-mono">
          {structured?.data_refreshed ? (
            <span className="inline-flex items-center gap-1 text-[#315F52]">
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              Data refreshed
            </span>
          ) : null}
          {structured?.data_version !== undefined &&
          structured?.data_version !== null ? (
            <span>v{String(structured.data_version)}</span>
          ) : null}
        </div>
      </div>

      {/* Main answer prose */}
      <div className="mt-3 text-[13px] leading-relaxed text-[#202824]">
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>

      {/* Grounding / verification notice if flagged */}
      {integrity && !integrity.valid ? (
        <div
          role="status"
          className="mt-3 flex items-start gap-2 rounded border border-[#E8E6E0] bg-[#FAF9F6] px-3 py-2 text-[12px] text-[#525E58]"
        >
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9B3B32]"
            aria-hidden="true"
          />
          <span>{integrity.warnings.join(' ')}</span>
        </div>
      ) : null}

      {/* Tool-backed metric cards */}
      {structured?.metric_results && structured.metric_results.length > 0 ? (
        <div
          className={`mt-4 grid gap-3 ${
            compact || structured.metric_results.length === 1
              ? 'grid-cols-1'
              : 'grid-cols-1 sm:grid-cols-2'
          }`}
        >
          {structured.metric_results.map((m, idx) => (
            <MetricEvidenceCard
              key={`${m.metric_id}-${idx}`}
              metric={m}
              compact={compact}
            />
          ))}
        </div>
      ) : null}

      {/* Expandable citations */}
      {structured?.citations && structured.citations.length > 0 ? (
        <div className="mt-4">
          <CitationList citations={structured.citations} compact={compact} />
        </div>
      ) : null}

      {/* Proposed action cards */}
      {displayActions.length > 0 ? (
        <div className="mt-4 space-y-3">
          {displayActions.map((act) => (
            <ProposedActionCard
              key={act.ai_action_id}
              action={act}
              permissionProfile={permissionProfile}
              processing={actionProcessingId === act.ai_action_id}
              errorMessage={actionErrorById[act.ai_action_id] ?? null}
              onRequestConfirm={onRequestConfirmAction}
              onCancel={onCancelAction}
              onOpenRecord={onOpenRecord}
              compact={compact}
            />
          ))}
        </div>
      ) : null}

      {/* Server-returned contextual follow-up suggestions only */}
      {structured?.follow_up_suggestions &&
      structured.follow_up_suggestions.length > 0 &&
      onSelectFollowUp ? (
        <div className="mt-4 border-t border-[#E8E6E0] pt-3">
          <p className="mb-2 text-[11px] font-medium text-[#788C83]">
            Follow-up inquiries
          </p>
          <div className="flex flex-wrap gap-2">
            {structured.follow_up_suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSelectFollowUp(suggestion)}
                className="rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-2.5 py-1 text-left text-[12px] text-[#202824] transition-colors hover:border-[#315F52] hover:bg-white"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
