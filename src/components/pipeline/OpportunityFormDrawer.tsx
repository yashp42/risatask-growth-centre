import { AlertCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  CANONICAL_BETS,
  formatBetDisplay,
  formatChannelDisplay,
} from '../../services/campaignsApi';
import {
  OPEN_OPPORTUNITY_STAGES,
  type OpportunityCreatePayload,
  type OpportunityEntity,
  type OpportunityMetadataUpdatePayload,
  type OpportunityStage,
  type OpportunitySupportType,
} from '../../types/pipeline';
import {
  PipelineApiError,
  createOpportunity,
  fetchOpportunitySponsorInteractions,
  isOpportunityReadOnly,
  updateOpportunityMetadata,
} from '../../services/pipelineApi';
import {
  fetchSponsorContacts,
  fetchSponsorOutreach,
  fetchSponsorsDirectory,
  hasNamedContactInteraction,
} from '../../services/sponsorsApi';
import type { CampaignEntity } from '../../types/campaigns';
import type { FilterOption } from '../../types/overview';
import type {
  ContactEntity,
  SponsorEntity,
  UserPermissionContext,
} from '../../types/sponsors';
import { InfoHint } from '../ui/InfoHint';
import { SlideOverDrawer } from '../ui/SlideOverDrawer';

interface OpportunityFormDrawerProps {
  open: boolean;
  editingOpportunity: OpportunityEntity | null;
  activeRecordClass: 'simulated' | 'live';
  activeEditionId: string;
  campaigns: CampaignEntity[];
  ownerOptions: FilterOption[];
  permissions: UserPermissionContext;
  onClose: () => void;
  onSaved: (opportunity: OpportunityEntity) => void;
}

const SUPPORT_TYPE_INPUTS: ReadonlyArray<{
  value: OpportunitySupportType;
  label: string;
}> = [
  { value: 'cash', label: 'Cash' },
  { value: 'in_kind', label: 'In-kind' },
  { value: 'mixed', label: 'Mixed (cash + in-kind)' },
];

const INITIAL_STAGE_LABELS: Record<
  'prospecting' | 'contacted' | 'proposal_sent' | 'negotiating',
  string
> = {
  prospecting: 'Prospecting',
  contacted: 'Contacted',
  proposal_sent: 'Proposal sent',
  negotiating: 'Negotiating',
};

export function OpportunityFormDrawer({
  open,
  editingOpportunity,
  activeRecordClass,
  activeEditionId,
  campaigns,
  ownerOptions,
  permissions,
  onClose,
  onSaved,
}: OpportunityFormDrawerProps) {
  const isEditing = Boolean(editingOpportunity);
  const readOnly = editingOpportunity
    ? isOpportunityReadOnly(editingOpportunity)
    : false;

  // Canonical OPPORTUNITY fields
  const [sponsorId, setSponsorId] = useState('');
  const [name, setName] = useState('');
  const [primaryContactId, setPrimaryContactId] = useState('');
  const [originatingCampaignId, setOriginatingCampaignId] = useState('');
  const [betId, setBetId] = useState('');
  const [supportType, setSupportType] =
    useState<OpportunitySupportType>('cash');
  const [isRenewal, setIsRenewal] = useState(false);

  // Initial OPPORTUNITY_STAGE_VERSION seed (only on create)
  const [initialStage, setInitialStage] = useState<
    'prospecting' | 'contacted' | 'proposal_sent' | 'negotiating'
  >('prospecting');
  const [ownerMemberId, setOwnerMemberId] = useState('');
  const [proposedValue, setProposedValue] = useState('');

  // Lookup state
  const [sponsors, setSponsors] = useState<SponsorEntity[]>([]);
  const [sponsorsLoading, setSponsorsLoading] = useState(false);
  const [contacts, setContacts] = useState<ContactEntity[]>([]);
  const [sponsorEligibility, setSponsorEligibility] = useState<{
    checked: boolean;
    eligible: boolean;
    reason: string | null;
  }>({ checked: false, eligible: false, reason: null });

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const effectiveRecordClass: 'simulated' | 'live' = editingOpportunity
    ? editingOpportunity.record_class === 'live'
      ? 'live'
      : 'simulated'
    : activeRecordClass;

  const effectiveEditionId = editingOpportunity
    ? editingOpportunity.edition_id
    : activeEditionId;

  useEffect(() => {
    if (!open) return;
    setFormError(null);

    if (editingOpportunity) {
      setSponsorId(editingOpportunity.sponsor_id);
      setName(editingOpportunity.name ?? '');
      setPrimaryContactId(editingOpportunity.primary_contact_id ?? '');
      setOriginatingCampaignId(
        editingOpportunity.originating_campaign_id ?? ''
      );
      setBetId(editingOpportunity.bet_id ?? '');
      setSupportType(editingOpportunity.support_type ?? 'cash');
      setIsRenewal(Boolean(editingOpportunity.is_renewal));
      setInitialStage('prospecting');
      setOwnerMemberId(
        editingOpportunity.current_stage_version?.owner_member_id ?? ''
      );
      setProposedValue(
        editingOpportunity.current_stage_version?.proposed_value != null
          ? String(editingOpportunity.current_stage_version.proposed_value)
          : ''
      );
      setSponsorEligibility({ checked: true, eligible: true, reason: null });
    } else {
      setSponsorId('');
      setName('');
      setPrimaryContactId('');
      setOriginatingCampaignId('');
      setBetId('');
      setSupportType('cash');
      setIsRenewal(false);
      setInitialStage('prospecting');
      setOwnerMemberId(permissions.member_id ?? '');
      setProposedValue('');
      setContacts([]);
      setSponsorEligibility({ checked: false, eligible: false, reason: null });
    }
  }, [open, editingOpportunity, permissions.member_id]);

  // Load sponsors in matching record_class on create
  useEffect(() => {
    if (!open || isEditing) return;
    const controller = new AbortController();
    setSponsorsLoading(true);
    fetchSponsorsDirectory(
      {
        search: '',
        record_class: effectiveRecordClass,
        edition_id: effectiveEditionId,
        lifecycle_status: 'all',
        category_id: 'all',
        first_source: 'all',
        city: 'all',
      },
      controller.signal
    )
      .then((res) => {
        setSponsors(res.sponsors);
      })
      .catch(() => {
        setSponsors([]);
      })
      .finally(() => {
        setSponsorsLoading(false);
      });
    return () => controller.abort();
  }, [open, isEditing, effectiveRecordClass, effectiveEditionId]);

  // Load contacts & verify INV-03 eligibility whenever sponsorId changes
  useEffect(() => {
    if (!open || !sponsorId) {
      setContacts([]);
      setSponsorEligibility({ checked: false, eligible: false, reason: null });
      return;
    }

    const controller = new AbortController();
    const selectedSponsor = sponsors.find((s) => s.sponsor_id === sponsorId);

    if (!isEditing && selectedSponsor?.lifecycle_status === 'research_target') {
      setSponsorEligibility({
        checked: true,
        eligible: false,
        reason:
          'Research target sponsors cannot enter the pipeline until a named-contact interaction is recorded.',
      });
    }

    Promise.all([
      fetchSponsorContacts(sponsorId, effectiveRecordClass, controller.signal).catch(
        () => [] as ContactEntity[]
      ),
      isEditing
        ? Promise.resolve([])
        : fetchSponsorOutreach(
            sponsorId,
            effectiveRecordClass,
            effectiveEditionId,
            controller.signal
          ).catch(() => []),
      isEditing
        ? Promise.resolve([])
        : fetchOpportunitySponsorInteractions(
            sponsorId,
            effectiveRecordClass,
            effectiveEditionId,
            controller.signal
          ).catch(() => []),
    ]).then(([contactList, outreachList, interactionList]) => {
      setContacts(contactList);
      if (isEditing) return;

      if (selectedSponsor?.lifecycle_status === 'research_target') {
        setSponsorEligibility({
          checked: true,
          eligible: false,
          reason:
            'Research target sponsors cannot enter the pipeline until a named-contact interaction is recorded.',
        });
        return;
      }

      if (selectedSponsor?.lifecycle_status === 'do_not_contact') {
        setSponsorEligibility({
          checked: true,
          eligible: false,
          reason: 'This sponsor is marked Do not contact.',
        });
        return;
      }

      const hasInteraction = hasNamedContactInteraction(
        contactList,
        outreachList,
        interactionList
      );
      if (!hasInteraction) {
        setSponsorEligibility({
          checked: true,
          eligible: false,
          reason:
            'Requires at least one recorded interaction with a named contact before entering the commercial pipeline.',
        });
      } else {
        setSponsorEligibility({
          checked: true,
          eligible: true,
          reason: null,
        });
      }
    });

    return () => controller.abort();
  }, [
    open,
    isEditing,
    sponsorId,
    sponsors,
    effectiveRecordClass,
    effectiveEditionId,
  ]);

  const ownerChoices = ownerOptions.filter((o) => o.value !== 'all');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || submitting) return;

    if (!isEditing) {
      if (!sponsorId.trim()) {
        setFormError('Select an eligible sponsor.');
        return;
      }
      if (sponsorEligibility.checked && !sponsorEligibility.eligible) {
        setFormError(
          sponsorEligibility.reason ??
            'Selected sponsor is not eligible to enter the pipeline.'
        );
        return;
      }
      const parsedProposed =
        proposedValue.trim() !== '' ? Number(proposedValue) : null;
      if (
        parsedProposed !== null &&
        (!Number.isFinite(parsedProposed) || parsedProposed < 0)
      ) {
        setFormError('Proposed value must be a valid non-negative amount.');
        return;
      }

      const payload: OpportunityCreatePayload = {
        sponsor_id: sponsorId.trim(),
        edition_id: effectiveEditionId,
        primary_contact_id: primaryContactId || null,
        originating_campaign_id: originatingCampaignId || null,
        bet_id: betId || null,
        support_type: supportType,
        is_renewal: isRenewal,
        name: name.trim() || null,
        record_class: effectiveRecordClass,
        initial_stage: {
          stage: initialStage,
          owner_member_id: ownerMemberId.trim() || null,
          proposed_value: parsedProposed,
        },
      };

      setSubmitting(true);
      setFormError(null);
      try {
        const res = await createOpportunity(payload);
        onSaved(res.opportunity);
      } catch (err) {
        setFormError(
          err instanceof PipelineApiError
            ? err.message
            : 'Unable to create opportunity right now.'
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!editingOpportunity) return;
    const updatePayload: OpportunityMetadataUpdatePayload = {
      name: name.trim() || null,
      primary_contact_id: primaryContactId || null,
      bet_id: betId || null,
      support_type: supportType,
      is_renewal: isRenewal,
    };

    setSubmitting(true);
    setFormError(null);
    try {
      const res = await updateOpportunityMetadata(
        editingOpportunity.opportunity_id,
        updatePayload,
        editingOpportunity
      );
      onSaved(res.opportunity);
    } catch (err) {
      setFormError(
        err instanceof PipelineApiError
          ? err.message
          : 'Unable to update opportunity metadata right now.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlideOverDrawer
      open={open}
      onClose={onClose}
      meta={isEditing ? 'Edit opportunity' : 'New opportunity'}
      title={
        isEditing
          ? editingOpportunity?.name ||
            editingOpportunity?.sponsor_name ||
            editingOpportunity?.opportunity_id ||
            'Edit opportunity'
          : 'Create opportunity'
      }
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-medium text-[#788C83]">
              Record class
            </p>
            <p className="mt-1 font-mono text-[12px] text-[#202824]">
              {effectiveRecordClass}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-[#788C83]">
              Festival edition
            </p>
            <p className="mt-1 font-mono text-[12px] text-[#202824]">
              {effectiveEditionId}
            </p>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1">
            <label
              htmlFor="opp-sponsor-id"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Sponsor
            </label>
            <InfoHint
              label="Sponsor eligibility rule"
              content="Only sponsors beyond research_target with at least one recorded interaction with a named contact can enter the pipeline."
            />
          </div>
          {isEditing ? (
            <div className="mt-1 flex h-9 items-center rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-3 text-[13px] text-[#525E58]">
              {editingOpportunity?.sponsor_name ||
                editingOpportunity?.sponsor_id}
            </div>
          ) : (
            <select
              id="opp-sponsor-id"
              required
              disabled={readOnly || submitting || sponsorsLoading}
              value={sponsorId}
              onChange={(e) => {
                setSponsorId(e.target.value);
                setPrimaryContactId('');
              }}
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              <option value="">
                {sponsorsLoading
                  ? 'Loading sponsors...'
                  : sponsors.length > 0
                    ? 'Select eligible sponsor'
                    : 'No sponsors loaded'}
              </option>
              {sponsors.map((sp) => {
                const blocked =
                  sp.lifecycle_status === 'research_target' ||
                  sp.lifecycle_status === 'do_not_contact';
                return (
                  <option
                    key={sp.sponsor_id}
                    value={sp.sponsor_id}
                    disabled={blocked}
                  >
                    {sp.display_name}
                    {sp.lifecycle_status === 'research_target'
                      ? ' (research target — ineligible)'
                      : sp.lifecycle_status === 'do_not_contact'
                        ? ' (do not contact)'
                        : ''}
                  </option>
                );
              })}
            </select>
          )}
          {!isEditing &&
          sponsorEligibility.checked &&
          !sponsorEligibility.eligible &&
          sponsorEligibility.reason ? (
            <p className="mt-1.5 text-[12px] text-[#9B3B32]">
              {sponsorEligibility.reason}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="opp-name"
            className="block text-[12px] font-medium text-[#525E58]"
          >
            Opportunity name
          </label>
          <input
            id="opp-name"
            type="text"
            disabled={readOnly || submitting}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Title activation partnership"
            className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="opp-primary-contact"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Primary contact
            </label>
            <select
              id="opp-primary-contact"
              disabled={readOnly || submitting || !sponsorId}
              value={primaryContactId}
              onChange={(e) => setPrimaryContactId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              <option value="">Unassigned</option>
              {contacts.map((c) => (
                <option key={c.contact_id} value={c.contact_id}>
                  {c.full_name}
                  {c.job_title ? ` (${c.job_title})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="opp-support-type"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Support type
            </label>
            <select
              id="opp-support-type"
              required
              disabled={readOnly || submitting}
              value={supportType}
              onChange={(e) =>
                setSupportType(e.target.value as OpportunitySupportType)
              }
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              {SUPPORT_TYPE_INPUTS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="flex items-center gap-1">
              <label
                htmlFor="opp-originating-campaign"
                className="block text-[12px] font-medium text-[#525E58]"
              >
                Originating campaign
              </label>
              <InfoHint
                label="Immutable campaign attribution"
                content="Originating campaign is fixed when an opportunity is created and cannot be reassigned afterward."
              />
            </div>
            {isEditing ? (
              <div className="mt-1 flex h-9 items-center rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-3 text-[13px] text-[#525E58]">
                {editingOpportunity?.originating_campaign_name ||
                  editingOpportunity?.originating_campaign_id ||
                  '—'}
              </div>
            ) : (
              <select
                id="opp-originating-campaign"
                disabled={readOnly || submitting}
                value={originatingCampaignId}
                onChange={(e) => setOriginatingCampaignId(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
              >
                <option value="">None / unassigned</option>
                {campaigns.map((cam) => (
                  <option key={cam.campaign_id} value={cam.campaign_id}>
                    {cam.name} ·{' '}
                    {formatChannelDisplay(cam.channel_id, cam.channel_name)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label
              htmlFor="opp-bet-id"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Strategic bet
            </label>
            <select
              id="opp-bet-id"
              disabled={readOnly || submitting}
              value={betId}
              onChange={(e) => setBetId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              <option value="">Unassigned</option>
              {CANONICAL_BETS.map((bet) => (
                <option key={bet.bet_id} value={bet.bet_id}>
                  {formatBetDisplay(bet.bet_id, bet.name)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-[13px] text-[#202824]">
          <input
            type="checkbox"
            disabled={readOnly || submitting}
            checked={isRenewal}
            onChange={(e) => setIsRenewal(e.target.checked)}
            className="h-4 w-4 rounded border-[#D9D7D0] text-[#315F52] focus:ring-[#315F52]"
          />
          <span>Renewal opportunity from an earlier edition</span>
        </label>

        {!isEditing ? (
          <div className="space-y-4 border-t border-[#E8E6E0] pt-4">
            <div className="flex items-center gap-1">
              <p className="text-[12px] font-semibold text-[#202824]">
                Initial stage version
              </p>
              <InfoHint
                label="Stage version separation"
                content="Stage, owner, and proposed face value are recorded in the initial OPPORTUNITY_STAGE_VERSION entry."
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="opp-initial-stage"
                  className="block text-[12px] font-medium text-[#525E58]"
                >
                  Initial stage
                </label>
                <select
                  id="opp-initial-stage"
                  disabled={readOnly || submitting}
                  value={initialStage}
                  onChange={(e) =>
                    setInitialStage(
                      e.target.value as typeof initialStage
                    )
                  }
                  className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
                >
                  {(
                    OPEN_OPPORTUNITY_STAGES as ReadonlyArray<
                      Exclude<OpportunityStage, 'partner_confirmed' | 'lost' | 'withdrawn'>
                    >
                  ).map((st) => (
                    <option key={st} value={st}>
                      {INITIAL_STAGE_LABELS[st]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="opp-initial-proposed"
                  className="block text-[12px] font-medium text-[#525E58]"
                >
                  Proposed face value (₹)
                </label>
                <input
                  id="opp-initial-proposed"
                  type="number"
                  min={0}
                  step="1"
                  disabled={readOnly || submitting}
                  value={proposedValue}
                  onChange={(e) => setProposedValue(e.target.value)}
                  placeholder="0"
                  className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] tabular-nums focus:border-[#315F52] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="opp-initial-owner"
                className="block text-[12px] font-medium text-[#525E58]"
              >
                Owner member ID
              </label>
              <input
                id="opp-initial-owner"
                type="text"
                list="opp-owner-suggestions"
                disabled={readOnly || submitting}
                value={ownerMemberId}
                onChange={(e) => setOwnerMemberId(e.target.value)}
                placeholder="Team member ID"
                className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] placeholder:font-sans placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none"
              />
              {ownerChoices.length > 0 ? (
                <datalist id="opp-owner-suggestions">
                  {ownerChoices.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </datalist>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded border border-[#E8E6E0] bg-[#FAF9F6] px-3.5 py-2.5 text-[12px] text-[#525E58]">
            Stage, owner, and deal values are versioned separately via{' '}
            <span className="font-medium text-[#202824]">Update stage</span>.
          </div>
        )}

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
                  : 'Create opportunity'}
            </button>
          ) : null}
        </div>
      </form>
    </SlideOverDrawer>
  );
}
