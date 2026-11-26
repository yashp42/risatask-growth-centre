import { AlertCircle } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  formatCurrencyInr,
  formatOpportunityStage,
  formatSupportType,
} from '../../services/campaignsApi';
import {
  DROP_REASON_SUGGESTIONS,
  LOSS_REASON_SUGGESTIONS,
  PipelineApiError,
  appendOpportunityStageVersion,
  canUserConfirmPartnership,
  isOpportunityReadOnly,
} from '../../services/pipelineApi';
import type { FilterOption } from '../../types/overview';
import {
  ALL_OPPORTUNITY_STAGES,
  type OpportunityEntity,
  type OpportunityStage,
  type OpportunityStageTransitionPayload,
} from '../../types/pipeline';
import type { UserPermissionContext } from '../../types/sponsors';
import { InfoHint } from '../ui/InfoHint';
import { SlideOverDrawer } from '../ui/SlideOverDrawer';

interface OpportunityStageDrawerProps {
  open: boolean;
  opportunity: OpportunityEntity | null;
  ownerOptions: FilterOption[];
  permissions: UserPermissionContext;
  onClose: () => void;
  onSaved: (updated?: OpportunityEntity) => void;
}

export function OpportunityStageDrawer({
  open,
  opportunity,
  ownerOptions,
  permissions,
  onClose,
  onSaved,
}: OpportunityStageDrawerProps) {
  const dropListId = useId();
  const lossListId = useId();
  const ownerListId = useId();

  const readOnly = opportunity ? isOpportunityReadOnly(opportunity) : false;
  const allowConfirm = canUserConfirmPartnership(permissions);

  const [stage, setStage] = useState<OpportunityStage>('prospecting');
  const [ownerMemberId, setOwnerMemberId] = useState('');
  const [proposedValue, setProposedValue] = useState('');
  const [confirmedValue, setConfirmedValue] = useState('');
  const [dropReason, setDropReason] = useState('');
  const [lossReason, setLossReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !opportunity) return;
    setFormError(null);
    const current = opportunity.current_stage_version;
    setStage(current?.stage ?? 'prospecting');
    setOwnerMemberId(current?.owner_member_id ?? '');
    setProposedValue(
      current?.proposed_value != null ? String(current.proposed_value) : ''
    );
    setConfirmedValue(
      current?.stage === 'partner_confirmed' && current.confirmed_value != null
        ? String(current.confirmed_value)
        : ''
    );
    setDropReason(current?.drop_reason ?? '');
    setLossReason(current?.loss_reason ?? '');
  }, [open, opportunity]);

  if (!opportunity) return null;

  const isConfirmedStage = stage === 'partner_confirmed';
  const isDropStage = stage === 'lost' || stage === 'withdrawn';
  const current = opportunity.current_stage_version;
  const ownerChoices = ownerOptions.filter((o) => o.value !== 'all');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || submitting) return;

    if (isDropStage && !dropReason.trim()) {
      setFormError(
        'A drop reason is required when closing an opportunity as lost or withdrawn.'
      );
      return;
    }

    const parsedProposed =
      proposedValue.trim() !== '' ? Number(proposedValue) : null;
    if (
      parsedProposed !== null &&
      (!Number.isFinite(parsedProposed) || parsedProposed < 0)
    ) {
      setFormError('Proposed value must be a valid non-negative number.');
      return;
    }

    let parsedConfirmed: number | null = 0;
    if (isConfirmedStage) {
      if (confirmedValue.trim() === '') {
        setFormError(
          'Confirmed signed value is required when moving to Confirmed partnership.'
        );
        return;
      }
      parsedConfirmed = Number(confirmedValue);
      if (!Number.isFinite(parsedConfirmed) || parsedConfirmed <= 0) {
        setFormError(
          'Confirmed signed value must be greater than zero at partner_confirmed.'
        );
        return;
      }
    }

    const payload: OpportunityStageTransitionPayload = {
      stage,
      owner_member_id: ownerMemberId.trim() || null,
      proposed_value: parsedProposed,
      confirmed_value: isConfirmedStage ? parsedConfirmed : 0,
      drop_reason: isDropStage ? dropReason.trim() : null,
      loss_reason: isDropStage ? lossReason.trim() || null : null,
    };

    setSubmitting(true);
    setFormError(null);
    try {
      const res = await appendOpportunityStageVersion(
        opportunity.opportunity_id,
        payload,
        opportunity
      );
      onSaved(res.opportunity);
    } catch (err) {
      setFormError(
        err instanceof PipelineApiError
          ? err.message
          : 'Unable to record stage version right now.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlideOverDrawer
      open={open}
      onClose={onClose}
      meta="Append stage version"
      title={
        opportunity.name ||
        opportunity.sponsor_name ||
        opportunity.opportunity_id
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded border border-[#E8E6E0] bg-[#FAF9F6] px-3.5 py-2.5 text-[12px]">
          <div className="flex items-center justify-between gap-2 text-[#525E58]">
            <span>{opportunity.sponsor_name || opportunity.sponsor_id}</span>
            <span>{formatSupportType(opportunity.support_type)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[11px] text-[#788C83]">
            <span>
              Current: {formatOpportunityStage(current?.stage)}
            </span>
            <span>
              Proposed: {formatCurrencyInr(current?.proposed_value)}
            </span>
          </div>
        </div>

        {readOnly ? (
          <div className="rounded border border-[#D9D7D0] bg-[#FAF9F6] px-3.5 py-2.5 text-[12px] text-[#525E58]">
            Historical synthetic records are read-only and cannot be modified.
          </div>
        ) : null}

        {formError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded border border-[#9B3B32]/30 bg-[#9B3B32]/5 px-3.5 py-2.5 text-[12px] text-[#9B3B32]"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="stage-transition-stage"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              New stage
            </label>
            <select
              id="stage-transition-stage"
              disabled={readOnly || submitting}
              value={stage}
              onChange={(e) => {
                const next = e.target.value as OpportunityStage;
                setStage(next);
                if (next !== 'partner_confirmed') {
                  setConfirmedValue('');
                }
              }}
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              {ALL_OPPORTUNITY_STAGES.map((st) => (
                <option
                  key={st}
                  value={st}
                  disabled={st === 'partner_confirmed' && !allowConfirm}
                >
                  {formatOpportunityStage(st)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="stage-transition-owner"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Owner member ID
            </label>
            <input
              id="stage-transition-owner"
              type="text"
              list={ownerListId}
              disabled={readOnly || submitting}
              value={ownerMemberId}
              onChange={(e) => setOwnerMemberId(e.target.value)}
              placeholder="Team member ID"
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] placeholder:font-sans placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            />
            {ownerChoices.length > 0 ? (
              <datalist id={ownerListId}>
                {ownerChoices.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </datalist>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="flex items-center gap-1">
              <label
                htmlFor="stage-transition-proposed"
                className="block text-[12px] font-medium text-[#525E58]"
              >
                Proposed face value (₹)
              </label>
              <InfoHint
                label="Face value definition"
                content="Unweighted face value of the deal; never a probability-weighted forecast."
              />
            </div>
            <input
              id="stage-transition-proposed"
              type="number"
              min={0}
              step="1"
              disabled={readOnly || submitting}
              value={proposedValue}
              onChange={(e) => setProposedValue(e.target.value)}
              placeholder="0"
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] tabular-nums focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            />
          </div>

          <div>
            <div className="flex items-center gap-1">
              <label
                htmlFor="stage-transition-confirmed"
                className="block text-[12px] font-medium text-[#525E58]"
              >
                Confirmed signed value (₹)
              </label>
              <InfoHint
                label="Signed value constraint"
                content="Only allowed at partner_confirmed and requires a signed contract in live operations. Signed value is never cash collected."
              />
            </div>
            <input
              id="stage-transition-confirmed"
              type="number"
              min={0}
              step="1"
              disabled={readOnly || submitting || !isConfirmedStage}
              value={isConfirmedStage ? confirmedValue : '0'}
              onChange={(e) => setConfirmedValue(e.target.value)}
              placeholder="0"
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] tabular-nums focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6] disabled:text-[#788C83]"
            />
          </div>
        </div>

        {isConfirmedStage && !opportunity.has_contract ? (
          <div className="rounded border border-[#D9D7D0] bg-[#FAF9F6] px-3.5 py-2.5 text-[12px] text-[#525E58]">
            Confirming a partnership with signed value requires an active signed
            contract on record in live operations.
          </div>
        ) : null}

        {isDropStage ? (
          <div className="grid grid-cols-1 gap-4 border-t border-[#E8E6E0] pt-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="stage-transition-drop-reason"
                className="block text-[12px] font-medium text-[#525E58]"
              >
                Drop reason (required)
              </label>
              <input
                id="stage-transition-drop-reason"
                type="text"
                list={dropListId}
                required
                disabled={readOnly || submitting}
                value={dropReason}
                onChange={(e) => setDropReason(e.target.value)}
                placeholder="e.g. budget_frozen"
                className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
              />
              <datalist id={dropListId}>
                {DROP_REASON_SUGGESTIONS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>

            <div>
              <label
                htmlFor="stage-transition-loss-reason"
                className="block text-[12px] font-medium text-[#525E58]"
              >
                Loss reason
              </label>
              <input
                id="stage-transition-loss-reason"
                type="text"
                list={lossListId}
                disabled={readOnly || submitting}
                value={lossReason}
                onChange={(e) => setLossReason(e.target.value)}
                placeholder="e.g. terms_dispute"
                className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
              />
              <datalist id={lossListId}>
                {LOSS_REASON_SUGGESTIONS.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-[#E8E6E0] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3.5 text-[13px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6]"
          >
            Cancel
          </button>
          {!readOnly ? (
            <button
              type="submit"
              disabled={submitting}
              className="h-9 rounded-md bg-[#315F52] px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#264B40] disabled:opacity-60"
            >
              {submitting ? 'Saving...' : 'Save stage version'}
            </button>
          ) : null}
        </div>
      </form>
    </SlideOverDrawer>
  );
}
