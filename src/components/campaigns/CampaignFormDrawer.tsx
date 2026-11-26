import { AlertCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  CAMPAIGN_EDITION_BY_CLASS,
  CAMPAIGN_STATUS_OPTIONS,
  CANONICAL_BETS,
  CANONICAL_CHANNELS,
  CampaignApiError,
  createCampaign,
  getDefaultEditionForClass,
  isCampaignReadOnly,
  updateCampaign,
} from '../../services/campaignsApi';
import type {
  CampaignEntity,
  CampaignStatus,
  CampaignWritePayload,
} from '../../types/campaigns';
import { SlideOverDrawer } from '../ui/SlideOverDrawer';

interface CampaignFormDrawerProps {
  open: boolean;
  editingCampaign: CampaignEntity | null;
  activeRecordClass: 'simulated' | 'live';
  activeEditionId: string;
  onClose: () => void;
  onSaved: (campaign: CampaignEntity) => void;
}

const STATUS_INPUT_OPTIONS = CAMPAIGN_STATUS_OPTIONS.filter(
  (opt) => opt.value !== 'all'
);

export function CampaignFormDrawer({
  open,
  editingCampaign,
  activeRecordClass,
  activeEditionId,
  onClose,
  onSaved,
}: CampaignFormDrawerProps) {
  const isEditing = Boolean(editingCampaign);
  const readOnly = editingCampaign ? isCampaignReadOnly(editingCampaign) : false;

  const [name, setName] = useState('');
  const [recordClass, setRecordClass] = useState<'simulated' | 'live'>(
    activeRecordClass
  );
  const [editionId, setEditionId] = useState(activeEditionId);
  const [channelId, setChannelId] = useState(CANONICAL_CHANNELS[0].channel_id);
  const [betId, setBetId] = useState('');
  const [ownerMemberId, setOwnerMemberId] = useState('');
  const [status, setStatus] = useState<CampaignStatus>('planned');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedEnd, setPlannedEnd] = useState('');
  const [objective, setObjective] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (editingCampaign) {
      const nextClass: 'simulated' | 'live' =
        editingCampaign.record_class === 'live' ? 'live' : 'simulated';
      setName(editingCampaign.name ?? '');
      setRecordClass(nextClass);
      setEditionId(
        editingCampaign.edition_id || getDefaultEditionForClass(nextClass)
      );
      setChannelId(
        editingCampaign.channel_id || CANONICAL_CHANNELS[0].channel_id
      );
      setBetId(editingCampaign.bet_id ?? '');
      setOwnerMemberId(editingCampaign.owner_member_id ?? '');
      setStatus(editingCampaign.status ?? 'planned');
      setPlannedStart(editingCampaign.planned_start ?? '');
      setPlannedEnd(editingCampaign.planned_end ?? '');
      setObjective(editingCampaign.objective ?? '');
    } else {
      const defaultEdition =
        CAMPAIGN_EDITION_BY_CLASS[activeRecordClass].some(
          (e) => e.value === activeEditionId
        )
          ? activeEditionId
          : getDefaultEditionForClass(activeRecordClass);

      setName('');
      setRecordClass(activeRecordClass);
      setEditionId(defaultEdition);
      setChannelId(CANONICAL_CHANNELS[0].channel_id);
      setBetId('');
      setOwnerMemberId('');
      setStatus('planned');
      setPlannedStart('');
      setPlannedEnd('');
      setObjective('');
    }
  }, [open, editingCampaign, activeRecordClass, activeEditionId]);

  const selectedChannel = CANONICAL_CHANNELS.find(
    (c) => c.channel_id === channelId
  );
  const isColdInactiveChannel = selectedChannel ? !selectedChannel.is_active : false;
  const editionOptions = CAMPAIGN_EDITION_BY_CLASS[recordClass];

  const handleRecordClassChange = (nextClass: 'simulated' | 'live') => {
    setRecordClass(nextClass);
    setEditionId(getDefaultEditionForClass(nextClass));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || submitting) return;

    const trimmedName = name.trim();
    const trimmedOwner = ownerMemberId.trim();
    if (!trimmedName) {
      setFormError('Campaign name is required.');
      return;
    }
    if (!channelId) {
      setFormError('Channel is required.');
      return;
    }
    if (plannedStart && plannedEnd && plannedEnd < plannedStart) {
      setFormError('Planned end date cannot be earlier than planned start date.');
      return;
    }

    const payload: CampaignWritePayload = {
      name: trimmedName,
      edition_id: editionId,
      channel_id: channelId,
      bet_id: betId || null,
      owner_member_id: trimmedOwner || null,
      status,
      record_class: recordClass,
      planned_start: plannedStart || null,
      planned_end: plannedEnd || null,
      objective: objective.trim() || null,
    };

    setSubmitting(true);
    setFormError(null);

    try {
      const res = editingCampaign
        ? await updateCampaign(
            editingCampaign.campaign_id,
            payload,
            editingCampaign
          )
        : await createCampaign(payload);
      onSaved(res.campaign);
    } catch (err) {
      if (err instanceof CampaignApiError) {
        setFormError(err.message);
      } else {
        setFormError('Could not save campaign changes. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlideOverDrawer
      open={open}
      onClose={onClose}
      meta={isEditing ? 'Edit campaign' : 'New campaign'}
      title={isEditing ? editingCampaign?.name ?? 'Edit campaign' : 'Create campaign'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
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

        <div>
          <label
            htmlFor="campaign-name"
            className="block text-[12px] font-medium text-[#525E58]"
          >
            Campaign name
          </label>
          <input
            id="campaign-name"
            type="text"
            required
            disabled={readOnly || submitting}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alumni founder outreach"
            className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="campaign-record-class"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Record class
            </label>
            <select
              id="campaign-record-class"
              disabled={readOnly || submitting || isEditing}
              value={recordClass}
              onChange={(e) =>
                handleRecordClassChange(e.target.value as 'simulated' | 'live')
              }
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              <option value="simulated">Simulated (demo)</option>
              <option value="live">Live</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="campaign-edition"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Festival edition
            </label>
            <select
              id="campaign-edition"
              disabled={readOnly || submitting || isEditing}
              value={editionId}
              onChange={(e) => setEditionId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              {editionOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="campaign-channel"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Channel
            </label>
            <select
              id="campaign-channel"
              disabled={readOnly || submitting}
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              {CANONICAL_CHANNELS.map((ch) => (
                <option key={ch.channel_id} value={ch.channel_id}>
                  {ch.is_active ? ch.label : `${ch.label} — inactive`}
                </option>
              ))}
            </select>
            {isColdInactiveChannel ? (
              <p className="mt-1 text-[11px] text-[#9A6B2F]">
                Cold outreach channels are inactive under the approved strategy.
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="campaign-bet"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Strategic bet
            </label>
            <select
              id="campaign-bet"
              disabled={readOnly || submitting}
              value={betId}
              onChange={(e) => setBetId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              <option value="">None linked</option>
              {CANONICAL_BETS.map((bet) => (
                <option key={bet.bet_id} value={bet.bet_id}>
                  {bet.bet_id} · {bet.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="campaign-owner"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Owner member ID
            </label>
            <input
              id="campaign-owner"
              type="text"
              disabled={readOnly || submitting}
              value={ownerMemberId}
              onChange={(e) => setOwnerMemberId(e.target.value)}
              placeholder="e.g. TM-01"
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] placeholder:font-sans placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            />
          </div>

          <div>
            <label
              htmlFor="campaign-status"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Status
            </label>
            <select
              id="campaign-status"
              disabled={readOnly || submitting}
              value={status}
              onChange={(e) => setStatus(e.target.value as CampaignStatus)}
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              {STATUS_INPUT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="campaign-start-date"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Planned start
            </label>
            <input
              id="campaign-start-date"
              type="date"
              disabled={readOnly || submitting}
              value={plannedStart}
              onChange={(e) => setPlannedStart(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            />
          </div>

          <div>
            <label
              htmlFor="campaign-end-date"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Planned end
            </label>
            <input
              id="campaign-end-date"
              type="date"
              disabled={readOnly || submitting}
              value={plannedEnd}
              onChange={(e) => setPlannedEnd(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="campaign-objective"
            className="block text-[12px] font-medium text-[#525E58]"
          >
            Objective
          </label>
          <textarea
            id="campaign-objective"
            rows={2}
            disabled={readOnly || submitting}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="Target brands, scope, or deliverable"
            className="mt-1 w-full rounded-md border border-[#D9D7D0] bg-white px-3 py-2 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
          />
        </div>

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
              {submitting
                ? 'Saving...'
                : isEditing
                  ? 'Save changes'
                  : 'Create campaign'}
            </button>
          ) : null}
        </div>
      </form>
    </SlideOverDrawer>
  );
}
