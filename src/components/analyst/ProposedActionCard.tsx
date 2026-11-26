import { AlertCircle, ArrowUpRight, CheckCircle2, Lock, XCircle } from 'lucide-react';
import {
  canUserConfirmActionType,
  formatAiActionStatus,
  formatAiActionType,
} from '../../services/analystApi';
import type { AiActionRecord, AiPermissionProfile } from '../../types/analyst';

interface ProposedActionCardProps {
  action: AiActionRecord;
  permissionProfile: AiPermissionProfile;
  processing?: boolean;
  errorMessage?: string | null;
  onRequestConfirm: (action: AiActionRecord) => void;
  onCancel: (actionId: string) => void;
  onOpenRecord?: (recordType: string, recordId: string) => void;
  compact?: boolean;
}

function formatPayloadValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function ProposedActionCard({
  action,
  permissionProfile,
  processing = false,
  errorMessage,
  onRequestConfirm,
  onCancel,
  onOpenRecord,
  compact = false,
}: ProposedActionCardProps) {
  const isProposed = action.status === 'proposed';
  const isExecuted = action.status === 'executed' || action.status === 'confirmed';
  const isDeclined =
    action.status === 'cancelled' ||
    action.status === 'rejected' ||
    action.status === 'expired';

  const permissionCheck = canUserConfirmActionType(permissionProfile, action);
  const payloadEntries = Object.entries(action.payload ?? {});

  return (
    <div className="rounded-md border border-[#D9D7D0] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#E8E6E0] pb-2.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-[#315F52]">
              {formatAiActionType(action.action_type)}
            </span>
            <span className="font-mono text-[11px] text-[#788C83]">
              · {action.ai_action_id}
            </span>
          </div>
          {action.affected_summary ? (
            <p className="mt-1 text-[13px] font-medium text-[#202824]">
              {action.affected_summary}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          {isExecuted ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-[#315F52]" aria-hidden="true" />
          ) : isDeclined ? (
            <XCircle className="h-3.5 w-3.5 text-[#788C83]" aria-hidden="true" />
          ) : null}
          <span
            className={
              isExecuted
                ? 'font-medium text-[#315F52]'
                : isDeclined
                  ? 'text-[#788C83]'
                  : 'font-medium text-[#202824]'
            }
          >
            {formatAiActionStatus(action.status)}
          </span>
        </div>
      </div>

      {/* Exact payload fields */}
      {payloadEntries.length > 0 ? (
        <dl
          className={`mt-3 grid gap-x-4 gap-y-1.5 text-[12px] ${
            compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
          }`}
        >
          {payloadEntries.map(([field, val]) => (
            <div key={field} className="min-w-0">
              <dt className="font-mono text-[11px] text-[#788C83]">{field}</dt>
              <dd className="truncate font-medium text-[#202824]" title={formatPayloadValue(val)}>
                {formatPayloadValue(val)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-[12px] text-[#788C83]">
          No field payload supplied.
        </p>
      )}

      {/* Linked entities */}
      {(action.linked_sponsor_id ||
        action.linked_contact_id ||
        action.linked_campaign_id ||
        action.linked_opportunity_id) ? (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-[#E8E6E0] pt-2.5 font-mono text-[11px] text-[#525E58]">
          {action.linked_sponsor_id ? (
            <span>Sponsor: {action.linked_sponsor_id}</span>
          ) : null}
          {action.linked_contact_id ? (
            <span>Contact: {action.linked_contact_id}</span>
          ) : null}
          {action.linked_campaign_id ? (
            <span>Campaign: {action.linked_campaign_id}</span>
          ) : null}
          {action.linked_opportunity_id ? (
            <span>Opportunity: {action.linked_opportunity_id}</span>
          ) : null}
        </div>
      ) : null}

      {/* Permission boundary notice */}
      {isProposed && !permissionCheck.allowed ? (
        <div className="mt-3 flex items-start gap-2 rounded border border-[#E8E6E0] bg-[#FAF9F6] px-3 py-2 text-[12px] text-[#525E58]">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9B3B32]" aria-hidden="true" />
          <span>{permissionCheck.reason}</span>
        </div>
      ) : null}

      {errorMessage || action.error_message ? (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded border border-[#D9D7D0] bg-[#FAF9F6] px-3 py-2 text-[12px] text-[#9B3B32]"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{errorMessage || action.error_message}</span>
        </div>
      ) : null}

      {/* Execution result & audit reference */}
      {isExecuted ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E8E6E0] pt-2.5 text-[12px]">
          <div className="font-mono text-[11px] text-[#525E58]">
            {action.created_record_id ? (
              <span>
                Record: {action.created_record_type || 'item'} ·{' '}
                {action.created_record_id}
              </span>
            ) : (
              <span>Confirmed by {action.confirmed_by || 'authorised user'}</span>
            )}
            {action.audit_event_id ? (
              <span> · Audit {action.audit_event_id}</span>
            ) : null}
          </div>

          {action.created_record_id &&
          action.created_record_type &&
          onOpenRecord ? (
            <button
              type="button"
              onClick={() =>
                onOpenRecord(
                  action.created_record_type!,
                  action.created_record_id!
                )
              }
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[#315F52] hover:underline"
            >
              <span>Open record</span>
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Explicit human Confirm / Cancel buttons */}
      {isProposed ? (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-[#E8E6E0] pt-3">
          <button
            type="button"
            disabled={processing}
            onClick={() => onCancel(action.ai_action_id)}
            className="h-8 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] transition-colors hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={processing || !permissionCheck.allowed}
            onClick={() => onRequestConfirm(action)}
            className="h-8 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#264B40] disabled:cursor-not-allowed disabled:bg-[#788C83]"
          >
            {processing ? 'Processing...' : 'Review & confirm'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
