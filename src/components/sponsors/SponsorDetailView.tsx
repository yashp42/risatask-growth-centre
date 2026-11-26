import {
  ArrowLeft,
  ArrowUpRight,
  Ban,
  Pencil,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSeason } from '../../contexts/SeasonContext';
import {
  READ_ONLY_2025_MESSAGE,
  isHistoricalReadOnlyEdition,
} from '../../lib/dateIst';
import {
  formatChannelDisplay,
  formatCurrencyInr,
  formatOpportunityStage,
  formatSupportType,
} from '../../services/campaignsApi';
import {
  SponsorApiError,
  canUserEditSponsor,
  canUserManageSponsorContacts,
  createInteraction,
  createOutreachAttempt,
  deriveSponsorCampaigns,
  fetchCampaignsForSponsorContext,
  fetchSponsorById,
  fetchSponsorContacts,
  fetchSponsorContracts,
  fetchSponsorInteractions,
  fetchSponsorOpportunities,
  fetchSponsorOutreach,
  fetchSponsorTeamRoster,
  formatDecisionRole,
  formatFirstSource,
  formatLifecycleStatus,
  formatSponsorRecordClass,
  hasNamedContactInteraction,
  hasPriorEditionContract,
  isContactOptedOut,
  isContactReadOnly,
  isSponsorReadOnly,
  markContactOptedOut,
  reassignSponsorOwnership,
  recordSponsorQualification,
} from '../../services/sponsorsApi';
import type {
  CampaignEntity,
  CampaignOpportunityRecord,
  InteractionRecord,
  OutreachAttemptRecord,
} from '../../types/campaigns';
import type { ApiErrorInfo, DataLoadStatus } from '../../types/overview';
import type {
  ContactEntity,
  ProspectResearchRecord,
  SponsorContractRecord,
  SponsorEntity,
  SponsorRecordClass,
  UserPermissionContext,
} from '../../types/sponsors';
import { DataStateWrapper } from '../ui/DataStateWrapper';
import { InfoHint } from '../ui/InfoHint';
import { ContactFormDrawer } from './ContactFormDrawer';

type DetailTabId =
  | 'overview'
  | 'contacts'
  | 'activity'
  | 'research'
  | 'campaigns'
  | 'opportunities'
  | 'contracts';

interface SponsorDetailViewProps {
  sponsorId: string;
  initialSponsor?: SponsorEntity | null;
  recordClass: SponsorRecordClass;
  editionId: string;
  permissions: UserPermissionContext;
  reloadToken: number;
  onBack: () => void;
  onEditSponsor: (
    sponsor: SponsorEntity,
    context: { hasNamedInteraction: boolean; hasPriorContract: boolean }
  ) => void;
  onOpenCampaign?: (campaignId: string) => void;
  onInvalidateDirectory: () => void;
}

interface ActivityTimelineItem {
  key: string;
  event_type: string;
  contact_label: string | null;
  campaign_label: string | null;
  outcome: string | null;
  summary: string | null;
  actor_label: string | null;
  occurred_at: string;
}

export function SponsorDetailView({
  sponsorId,
  initialSponsor = null,
  recordClass,
  editionId,
  permissions,
  reloadToken,
  onBack,
  onEditSponsor,
  onOpenCampaign,
  onInvalidateDirectory,
}: SponsorDetailViewProps) {
  const { asOf } = useSeason();
  const [activeTab, setActiveTab] = useState<DetailTabId>('overview');

  const [sponsor, setSponsor] = useState<SponsorEntity | null>(initialSponsor);
  const [sponsorStatus, setSponsorStatus] = useState<DataLoadStatus>(
    initialSponsor ? 'ready' : 'loading'
  );
  const [sponsorError, setSponsorError] = useState<ApiErrorInfo | null>(null);

  const [contacts, setContacts] = useState<ContactEntity[]>([]);
  const [contactsStatus, setContactsStatus] =
    useState<DataLoadStatus>('loading');
  const [contactsError, setContactsError] = useState<ApiErrorInfo | null>(null);

  const [outreach, setOutreach] = useState<OutreachAttemptRecord[]>([]);
  const [interactions, setInteractions] = useState<InteractionRecord[]>([]);
  const [activityStatus, setActivityStatus] =
    useState<DataLoadStatus>('loading');
  const [activityError, setActivityError] = useState<ApiErrorInfo | null>(null);

  const [opportunities, setOpportunities] = useState<
    CampaignOpportunityRecord[]
  >([]);
  const [opportunitiesStatus, setOpportunitiesStatus] =
    useState<DataLoadStatus>('loading');
  const [opportunitiesError, setOpportunitiesError] =
    useState<ApiErrorInfo | null>(null);

  const [contracts, setContracts] = useState<SponsorContractRecord[]>([]);
  const [contractsStatus, setContractsStatus] =
    useState<DataLoadStatus>('loading');
  const [contractsError, setContractsError] = useState<ApiErrorInfo | null>(
    null
  );

  const [campaignsCatalog, setCampaignsCatalog] = useState<CampaignEntity[]>(
    []
  );

  const [localReload, setLocalReload] = useState(0);
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactEntity | null>(
    null
  );
  const [teamRoster, setTeamRoster] = useState<
    Array<{ member_id: string; full_name: string }>
  >([]);

  // Ownership reassignment state
  const [showOwnerForm, setShowOwnerForm] = useState(false);
  const [newOwnerId, setNewOwnerId] = useState('');
  const [ownerReason, setOwnerReason] = useState('');
  const [ownerSubmitting, setOwnerSubmitting] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);

  // Qualification state
  const [showQualifyForm, setShowQualifyForm] = useState(false);
  const [qualStatus, setQualStatus] = useState<
    'unreviewed' | 'engaged' | 'qualified' | 'unqualified' | 'dormant'
  >('qualified');
  const [qualCampaignId, setQualCampaignId] = useState('');
  const [qualReason, setQualReason] = useState('');
  const [qualSubmitting, setQualSubmitting] = useState(false);
  const [qualFeedback, setQualFeedback] = useState<string | null>(null);

  // Outreach & interaction state
  const [showOutreachForm, setShowOutreachForm] = useState(false);
  const [outreachCampaignId, setOutreachCampaignId] = useState('');
  const [outreachContactId, setOutreachContactId] = useState('');
  const [outreachRootEvent, setOutreachRootEvent] = useState<
    'outreach_sent' | 'introduction_received' | 'web_inbound'
  >('outreach_sent');
  const [outreachSummary, setOutreachSummary] = useState('');
  const [showInteractionForm, setShowInteractionForm] = useState(false);
  const [interactionAttemptId, setInteractionAttemptId] = useState('');
  const [interactionEventType, setInteractionEventType] = useState<
    'replied' | 'meeting_booked' | 'meeting_held' | 'follow_up_sent' | 'note' | 'opt_out'
  >('replied');
  const [interactionOutcome, setInteractionOutcome] = useState('positive');
  const [interactionSummary, setInteractionSummary] = useState('');
  const [activityFormSubmitting, setActivityFormSubmitting] = useState(false);
  const [activityFormError, setActivityFormError] = useState<string | null>(
    null
  );

  const triggerReload = useCallback(() => {
    setLocalReload((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const effectiveClass = initialSponsor?.record_class ?? recordClass;
    const effectiveEdition = initialSponsor?.edition_id ?? editionId;

    if (!initialSponsor || initialSponsor.sponsor_id !== sponsorId) {
      setSponsorStatus('loading');
    }
    setSponsorError(null);
    setContactsStatus('loading');
    setContactsError(null);
    setActivityStatus('loading');
    setActivityError(null);
    setOpportunitiesStatus('loading');
    setOpportunitiesError(null);
    setContractsStatus('loading');
    setContractsError(null);

    const loadRelated = (
      id: string,
      sClass: SponsorRecordClass,
      sEdition?: string | null
    ) => {
      // Contacts
      fetchSponsorContacts(id, sClass, controller.signal)
        .then((list) => {
          setContacts(list);
          setContactsStatus(list.length > 0 ? 'ready' : 'empty');
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setContactsStatus('error');
          setContactsError({
            code: 'ERROR',
            message:
              err instanceof SponsorApiError
                ? err.message
                : 'Unable to load contacts.',
            endpoint: '',
          });
        });

      // Outreach + Interactions
      Promise.all([
        fetchSponsorOutreach(id, sClass, sEdition ?? undefined, controller.signal),
        fetchSponsorInteractions(
          id,
          sClass,
          sEdition ?? undefined,
          controller.signal
        ),
      ])
        .then(([outreachList, interactionList]) => {
          setOutreach(outreachList);
          setInteractions(interactionList);
          setActivityStatus(
            outreachList.length > 0 || interactionList.length > 0
              ? 'ready'
              : 'empty'
          );
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setActivityStatus('error');
          setActivityError({
            code: 'ERROR',
            message:
              err instanceof SponsorApiError
                ? err.message
                : 'Unable to load activity.',
            endpoint: '',
          });
        });

      // Opportunities
      fetchSponsorOpportunities(
        id,
        sClass,
        sEdition ?? undefined,
        controller.signal
      )
        .then((list) => {
          setOpportunities(list);
          setOpportunitiesStatus(list.length > 0 ? 'ready' : 'empty');
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setOpportunitiesStatus('error');
          setOpportunitiesError({
            code: 'ERROR',
            message:
              err instanceof SponsorApiError
                ? err.message
                : 'Unable to load opportunities.',
            endpoint: '',
          });
        });

      // Contracts
      fetchSponsorContracts(id, sClass, controller.signal)
        .then((list) => {
          setContracts(list);
          setContractsStatus(list.length > 0 ? 'ready' : 'empty');
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setContractsStatus('error');
          setContractsError({
            code: 'ERROR',
            message:
              err instanceof SponsorApiError
                ? err.message
                : 'Unable to load contracts.',
            endpoint: '',
          });
        });

      // Campaign catalog for attribution metadata
      fetchCampaignsForSponsorContext(
        sClass,
        sEdition ?? undefined,
        controller.signal
      )
        .then((list) => setCampaignsCatalog(list))
        .catch(() => setCampaignsCatalog([]));

      // Team roster for ownership reassignment
      fetchSponsorTeamRoster(
        sEdition ?? editionId,
        sClass,
        controller.signal
      )
        .then((roster) => setTeamRoster(roster))
        .catch(() => setTeamRoster([]));
    };

    fetchSponsorById(
      sponsorId,
      effectiveClass,
      effectiveEdition,
      controller.signal
    )
      .then((entity) => {
        setSponsor(entity);
        setSponsorStatus('ready');
        loadRelated(
          entity.sponsor_id,
          entity.record_class,
          entity.edition_id ?? effectiveEdition
        );
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (initialSponsor && initialSponsor.sponsor_id === sponsorId) {
          setSponsor(initialSponsor);
          setSponsorStatus('ready');
          loadRelated(
            initialSponsor.sponsor_id,
            initialSponsor.record_class,
            initialSponsor.edition_id ?? effectiveEdition
          );
        } else {
          setSponsorStatus('error');
          setSponsorError({
            code: err instanceof SponsorApiError ? err.code : 'ERROR',
            message:
              err instanceof SponsorApiError
                ? err.message
                : 'Unable to load sponsor details.',
            endpoint: '',
          });
        }
      });

    return () => controller.abort();
  }, [
    sponsorId,
    initialSponsor,
    recordClass,
    editionId,
    reloadToken,
    localReload,
  ]);

  const timelineItems = useMemo<ActivityTimelineItem[]>(() => {
    const contactNameMap = new Map<string, string>();
    for (const c of contacts) {
      contactNameMap.set(c.contact_id, c.full_name);
    }

    const campaignNameMap = new Map<string, string>();
    for (const cam of campaignsCatalog) {
      campaignNameMap.set(cam.campaign_id, cam.name);
    }

    const attemptMap = new Map<string, OutreachAttemptRecord>();
    for (const att of outreach) {
      attemptMap.set(att.attempt_id, att);
    }

    const entries: ActivityTimelineItem[] = [];

    for (const att of outreach) {
      const cName =
        att.contact_name ||
        (att.contact_id ? contactNameMap.get(att.contact_id) : undefined) ||
        null;
      const camLabel =
        campaignNameMap.get(att.campaign_id) || att.campaign_id || null;
      entries.push({
        key: `att-${att.attempt_id}`,
        event_type: att.root_event_type.replace(/_/g, ' '),
        contact_label: cName,
        campaign_label: camLabel,
        outcome: null,
        summary: null,
        actor_label: att.owner_name || att.owner_member_id || null,
        occurred_at: att.started_at,
      });
    }

    for (const inter of interactions) {
      const att = attemptMap.get(inter.attempt_id);
      const cId = inter.contact_id ?? att?.contact_id ?? undefined;
      const cName =
        inter.contact_name ||
        att?.contact_name ||
        (cId ? contactNameMap.get(cId) : undefined) ||
        null;
      const camId = inter.campaign_id ?? att?.campaign_id ?? undefined;
      const camLabel = camId
        ? campaignNameMap.get(camId) || camId
        : null;

      entries.push({
        key: `int-${inter.interaction_id}`,
        event_type: inter.event_type.replace(/_/g, ' '),
        contact_label: cName,
        campaign_label: camLabel,
        outcome: inter.outcome ?? null,
        summary: inter.summary ?? null,
        actor_label: inter.logged_by_name || inter.logged_by || null,
        occurred_at: inter.occurred_at,
      });
    }

    return entries.sort((a, b) =>
      (b.occurred_at || '').localeCompare(a.occurred_at || '')
    );
  }, [contacts, outreach, interactions, campaignsCatalog]);

  const campaignAssociations = useMemo(
    () => deriveSponsorCampaigns(outreach, opportunities, campaignsCatalog),
    [outreach, opportunities, campaignsCatalog]
  );

  const researchRecords = useMemo<ProspectResearchRecord[]>(() => {
    return sponsor?.prospect_research ?? [];
  }, [sponsor]);

  const namedInteractionPresent = useMemo(
    () => hasNamedContactInteraction(contacts, outreach, interactions),
    [contacts, outreach, interactions]
  );

  const priorContractPresent = useMemo(
    () => hasPriorEditionContract(sponsor, contracts, editionId),
    [sponsor, contracts, editionId]
  );

  const isHistorical2025 = isHistoricalReadOnlyEdition(
    sponsor?.edition_id ?? editionId,
    sponsor?.record_class ?? recordClass
  );
  const readOnly = sponsor
    ? isSponsorReadOnly(sponsor) || isHistorical2025
    : isHistorical2025;
  const roleAllowsWrite =
    !permissions.verified_by_server || permissions.can_write_sponsors;
  const roleAllowsContacts =
    !permissions.verified_by_server || permissions.can_write_contacts;
  const editableSponsor = sponsor
    ? !isHistorical2025 && canUserEditSponsor(sponsor, permissions)
    : false;
  const canManageContacts = sponsor
    ? !isHistorical2025 && canUserManageSponsorContacts(sponsor, permissions)
    : false;

  const handleOptOut = async (contact: ContactEntity) => {
    if (!sponsor || isHistorical2025 || isContactReadOnly(contact, sponsor)) return;
    try {
      await markContactOptedOut(contact.contact_id, contact, sponsor);
      triggerReload();
      onInvalidateDirectory();
    } catch (err) {
      setContactsError({
        code: 'ERROR',
        message:
          err instanceof SponsorApiError
            ? err.message
            : 'Unable to update opt-out status.',
        endpoint: '',
      });
      setContactsStatus('error');
    }
  };

  const tabs: ReadonlyArray<{ id: DetailTabId; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    {
      id: 'contacts',
      label: 'Contacts',
      count: contactsStatus === 'ready' ? contacts.length : undefined,
    },
    {
      id: 'activity',
      label: 'Activity',
      count: activityStatus === 'ready' ? timelineItems.length : undefined,
    },
    {
      id: 'research',
      label: 'Research',
      count: researchRecords.length > 0 ? researchRecords.length : undefined,
    },
    {
      id: 'campaigns',
      label: 'Campaigns',
      count:
        campaignAssociations.length > 0
          ? campaignAssociations.length
          : undefined,
    },
    {
      id: 'opportunities',
      label: 'Opportunities',
      count: opportunitiesStatus === 'ready' ? opportunities.length : undefined,
    },
    {
      id: 'contracts',
      label: 'Contracts',
      count: contractsStatus === 'ready' ? contracts.length : undefined,
    },
  ];

  return (
    <div className="space-y-6 pb-8">
      {/* Back */}
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#525E58] transition-colors duration-150 hover:text-[#202824]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to Sponsors
        </button>
      </div>

      {/* Header */}
      <DataStateWrapper
        status={sponsorStatus}
        error={sponsorError}
        onRetry={triggerReload}
        loadingSkeleton={
          <div className="border-b border-[#D9D7D0] pb-6">
            <div className="h-7 w-64 rounded bg-[#E8E6E0]" />
            <div className="mt-2 h-4 w-80 rounded bg-[#F3F1EB]" />
          </div>
        }
      >
        {sponsor ? (
          <div className="border-b border-[#D9D7D0] pb-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-[#788C83]">
                  <span>
                    {sponsor.category_name ||
                      sponsor.category_id ||
                      'Uncategorised'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      sponsor.lifecycle_status === 'do_not_contact'
                        ? 'font-medium text-[#9B3B32]'
                        : sponsor.lifecycle_status === 'active'
                          ? 'font-medium text-[#315F52]'
                          : 'text-[#525E58]'
                    }
                  >
                    {formatLifecycleStatus(sponsor.lifecycle_status)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[11px]">
                    {formatSponsorRecordClass(sponsor.record_class)}
                    {sponsor.edition_id ? ` · ${sponsor.edition_id}` : ''}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[11px]">
                    As of {asOf}
                  </span>
                  {readOnly ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-[11px] text-[#525E58]">
                        {isHistorical2025 ? READ_ONLY_2025_MESSAGE : 'Read-only'}
                      </span>
                    </>
                  ) : null}
                </div>
                <h1 className="mt-1.5 text-[28px] font-semibold tracking-[-0.025em] text-[#202824]">
                  {sponsor.display_name}
                </h1>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={triggerReload}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-[#525E58]" aria-hidden="true" />
                  Refresh
                </button>
                {editableSponsor || (isHistorical2025 && roleAllowsWrite) ? (
                  <button
                    type="button"
                    disabled={!editableSponsor || isHistorical2025}
                    title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                    onClick={() => {
                      if (!editableSponsor || isHistorical2025) return;
                      onEditSponsor(sponsor, {
                        hasNamedInteraction: namedInteractionPresent,
                        hasPriorContract: priorContractPresent,
                      });
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3.5 text-[13px] font-medium text-[#202824] hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Pencil className="h-3.5 w-3.5 text-[#525E58]" aria-hidden="true" />
                    Edit
                  </button>
                ) : null}
              </div>
            </div>

            {/* 7-section tabs */}
            <div
              role="tablist"
              aria-label="Sponsor profile sections"
              className="mt-6 flex flex-wrap gap-1 border-t border-[#E8E6E0] pt-4"
            >
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 whitespace-nowrap ${
                      isActive
                        ? 'bg-[#315F52] text-white'
                        : 'text-[#525E58] hover:bg-white hover:text-[#202824]'
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.count !== undefined ? (
                      <span
                        className={`ml-1.5 font-mono text-[11px] tabular-nums ${
                          isActive ? 'text-white/80' : 'text-[#788C83]'
                        }`}
                      >
                        {tab.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </DataStateWrapper>

      {/* Active Tab Content */}
      {sponsor && sponsorStatus === 'ready' ? (
        <>
          {/* 1. Overview */}
          {activeTab === 'overview' ? (
            <div className="space-y-6">
              <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Display name
                    </p>
                    <p className="mt-1 text-[14px] font-medium text-[#202824]">
                      {sponsor.display_name}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Legal name
                    </p>
                    <p className="mt-1 text-[14px] text-[#202824]">
                      {sponsor.legal_name || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Category
                    </p>
                    <p className="mt-1 text-[14px] text-[#202824]">
                      {sponsor.category_name
                        ? `${sponsor.category_name} (${sponsor.category_id})`
                        : sponsor.category_id || '—'}
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <p className="text-[11px] font-medium text-[#788C83]">
                        Lifecycle status
                      </p>
                      <InfoHint
                        label="Lifecycle rules"
                        content="Remains research target until an interaction exists with a named contact. Past sponsor requires a prior-edition contract."
                      />
                    </div>
                    <p className="mt-1 text-[14px] font-medium text-[#202824]">
                      {formatLifecycleStatus(sponsor.lifecycle_status)}
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] font-medium text-[#788C83]">
                      First source
                    </p>
                    <p className="mt-1 text-[14px] text-[#202824]">
                      {formatFirstSource(sponsor.first_source)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-[#788C83]">
                      City
                    </p>
                    <p className="mt-1 text-[14px] text-[#202824]">
                      {sponsor.city || '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Website
                    </p>
                    <p className="mt-1 truncate text-[13px] text-[#202824]">
                      {sponsor.website || '—'}
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <p className="text-[11px] font-medium text-[#788C83]">
                        GSTIN
                      </p>
                      <InfoHint
                        label="GSTIN visibility"
                        content="Hidden in the interface when unverified or restricted; server enforcement is required for actual protection."
                      />
                    </div>
                    <p className="mt-1 font-mono text-[13px] text-[#202824]">
                      {sponsor.gstin_redacted
                        ? 'Redacted by server'
                        : !permissions.verified_by_server
                          ? 'Server verification required'
                          : !permissions.can_view_gstin
                            ? 'Restricted by role'
                            : sponsor.gstin || '—'}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 border-t border-[#E8E6E0] pt-4 sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Sponsor ID
                    </p>
                    <p className="mt-1 font-mono text-[12px] text-[#525E58]">
                      {sponsor.sponsor_id}
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <p className="text-[11px] font-medium text-[#788C83]">
                          Relationship owner
                        </p>
                        <InfoHint
                          label="Ownership assignment"
                          content="Derived from the current active OWNERSHIP_ASSIGNMENT record; prior handoff records are preserved in ownership history."
                        />
                      </div>
                      {!readOnly &&
                      permissions.verified_by_server &&
                      permissions.write_scope === 'all' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setOwnerError(null);
                            setNewOwnerId(
                              sponsor.current_ownership?.member_id ?? ''
                            );
                            setShowOwnerForm((v) => !v);
                          }}
                          className="text-[11px] font-medium text-[#315F52] hover:underline"
                        >
                          {showOwnerForm ? 'Cancel' : 'Change owner'}
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[13px] text-[#202824]">
                      {sponsor.current_ownership
                        ? sponsor.current_ownership.member_name ||
                          sponsor.current_ownership.member_id
                        : '—'}
                    </p>
                    {sponsor.current_ownership?.valid_from ? (
                      <p className="mt-0.5 font-mono text-[11px] text-[#788C83]">
                        Since {sponsor.current_ownership.valid_from.slice(0, 10)}
                      </p>
                    ) : null}

                    {showOwnerForm && !readOnly ? (
                      <div className="mt-2 space-y-2 rounded border border-[#E8E6E0] bg-[#FAF9F6] p-2.5">
                        {ownerError ? (
                          <p className="text-[11px] text-[#9B3B32]">{ownerError}</p>
                        ) : null}
                        <select
                          aria-label="New owner member"
                          value={newOwnerId}
                          onChange={(e) => setNewOwnerId(e.target.value)}
                          className="h-8 w-full rounded border border-[#D9D7D0] bg-white px-2 text-[12px] text-[#202824]"
                        >
                          <option value="">Select owner...</option>
                          {teamRoster.map((tm) => (
                            <option key={tm.member_id} value={tm.member_id}>
                              {tm.full_name} ({tm.member_id})
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={ownerReason}
                          onChange={(e) => setOwnerReason(e.target.value)}
                          placeholder="Handoff reason"
                          className="h-8 w-full rounded border border-[#D9D7D0] bg-white px-2 text-[12px] text-[#202824]"
                        />
                        <button
                          type="button"
                          disabled={ownerSubmitting || !newOwnerId}
                          onClick={async () => {
                            setOwnerSubmitting(true);
                            setOwnerError(null);
                            try {
                              await reassignSponsorOwnership({
                                subjectType: 'sponsor',
                                subjectId: sponsor.sponsor_id,
                                memberId: newOwnerId,
                                reason: ownerReason.trim() || null,
                                editionId: sponsor.edition_id ?? editionId,
                              });
                              setShowOwnerForm(false);
                              setOwnerReason('');
                              triggerReload();
                              onInvalidateDirectory();
                            } catch (err) {
                              setOwnerError(
                                err instanceof SponsorApiError
                                  ? err.message
                                  : 'Unable to reassign owner.'
                              );
                            } finally {
                              setOwnerSubmitting(false);
                            }
                          }}
                          className="h-7 rounded bg-[#315F52] px-2.5 text-[11px] font-medium text-white hover:bg-[#264B40] disabled:opacity-50"
                        >
                          {ownerSubmitting ? 'Saving...' : 'Assign owner'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Provenance
                    </p>
                    <p className="mt-1 font-mono text-[12px] text-[#525E58]">
                      {formatSponsorRecordClass(sponsor.record_class)}
                      {sponsor.source_ref ? ` · ${sponsor.source_ref}` : ''}
                      {sponsor.data_version !== null &&
                      sponsor.data_version !== undefined
                        ? ` · v${sponsor.data_version}`
                        : ''}
                    </p>
                  </div>
                </div>

                {sponsor.ownership_history &&
                sponsor.ownership_history.length > 0 ? (
                  <div className="mt-5 border-t border-[#E8E6E0] pt-4">
                    <p className="text-[11px] font-medium text-[#788C83]">
                      Ownership history
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {sponsor.ownership_history.map((assignment) => (
                        <div
                          key={assignment.assignment_id}
                          className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#525E58]"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-[#202824]">
                              {assignment.member_name || assignment.member_id}
                            </span>
                            <span className="font-mono text-[11px] text-[#788C83]">
                              {assignment.role_in_relationship ?? 'owner'}
                            </span>
                            {assignment.reason ? (
                              <span className="text-[#788C83]">
                                · {assignment.reason}
                              </span>
                            ) : null}
                          </div>
                          <span className="font-mono text-[11px] text-[#788C83]">
                            {assignment.valid_from
                              ? assignment.valid_from.slice(0, 10)
                              : '—'}
                            {assignment.valid_to
                              ? ` → ${assignment.valid_to.slice(0, 10)}`
                              : assignment.is_current
                                ? ' → Current'
                                : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {editableSponsor && !readOnly ? (
                  <div className="mt-5 border-t border-[#E8E6E0] pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] font-medium text-[#788C83]">
                        Qualification status
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setQualFeedback(null);
                          setShowQualifyForm((v) => !v);
                        }}
                        className="text-[12px] font-medium text-[#315F52] hover:underline"
                      >
                        {showQualifyForm ? 'Cancel' : 'Record qualification'}
                      </button>
                    </div>
                    {qualFeedback ? (
                      <p className="mt-1.5 text-[12px] text-[#315F52]">
                        {qualFeedback}
                      </p>
                    ) : null}
                    {showQualifyForm ? (
                      <div className="mt-2 grid grid-cols-1 gap-2 rounded border border-[#E8E6E0] bg-[#FAF9F6] p-3 sm:grid-cols-4 sm:items-end">
                        <div>
                          <label className="block text-[11px] font-medium text-[#525E58]">
                            Status
                          </label>
                          <select
                            value={qualStatus}
                            onChange={(e) =>
                              setQualStatus(
                                e.target.value as
                                  | 'unreviewed'
                                  | 'engaged'
                                  | 'qualified'
                                  | 'unqualified'
                                  | 'dormant'
                              )
                            }
                            className="mt-1 h-8 w-full rounded border border-[#D9D7D0] bg-white px-2 text-[12px]"
                          >
                            <option value="unreviewed">Unreviewed</option>
                            <option value="engaged">Engaged</option>
                            <option value="qualified">Qualified</option>
                            <option value="unqualified">Unqualified</option>
                            <option value="dormant">Dormant</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-[#525E58]">
                            Source campaign
                          </label>
                          <select
                            value={qualCampaignId}
                            onChange={(e) => setQualCampaignId(e.target.value)}
                            className="mt-1 h-8 w-full rounded border border-[#D9D7D0] bg-white px-2 text-[12px]"
                          >
                            <option value="">None / optional</option>
                            {campaignsCatalog.map((cam) => (
                              <option key={cam.campaign_id} value={cam.campaign_id}>
                                {cam.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-[#525E58]">
                            Reason
                          </label>
                          <input
                            type="text"
                            value={qualReason}
                            onChange={(e) => setQualReason(e.target.value)}
                            placeholder="Assessment reason"
                            className="mt-1 h-8 w-full rounded border border-[#D9D7D0] bg-white px-2 text-[12px]"
                          />
                        </div>
                        <div>
                          <button
                            type="button"
                            disabled={qualSubmitting}
                            onClick={async () => {
                              setQualSubmitting(true);
                              setQualFeedback(null);
                              try {
                                await recordSponsorQualification({
                                  sponsorId: sponsor.sponsor_id,
                                  sourceCampaignId: qualCampaignId || null,
                                  status: qualStatus,
                                  reason: qualReason.trim() || null,
                                  checklistPassed: qualStatus === 'qualified',
                                  editionId: sponsor.edition_id ?? editionId,
                                });
                                setShowQualifyForm(false);
                                setQualReason('');
                                setQualFeedback(
                                  `Qualification version "${qualStatus}" saved.`
                                );
                                triggerReload();
                                onInvalidateDirectory();
                              } catch (err) {
                                setQualFeedback(
                                  err instanceof SponsorApiError
                                    ? err.message
                                    : 'Unable to record qualification.'
                                );
                              } finally {
                                setQualSubmitting(false);
                              }
                            }}
                            className="h-8 w-full rounded bg-[#315F52] px-3 text-[12px] font-medium text-white hover:bg-[#264B40] disabled:opacity-50"
                          >
                            {qualSubmitting ? 'Saving...' : 'Save qualification'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* 2. Contacts */}
          {activeTab === 'contacts' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-[12px] text-[#788C83]">
                  <span>Organisation contacts</span>
                  <InfoHint
                    label="Contact governance"
                    content="Each contact belongs to one sponsor. Decision role defaults to unknown and is never inferred from job title. Opted-out contacts are blocked from outreach."
                  />
                </div>
                {canManageContacts || (isHistorical2025 && roleAllowsContacts) ? (
                  <button
                    type="button"
                    disabled={!canManageContacts || isHistorical2025}
                    title={isHistorical2025 ? READ_ONLY_2025_MESSAGE : undefined}
                    onClick={() => {
                      if (!canManageContacts || isHistorical2025) return;
                      setEditingContact(null);
                      setContactDrawerOpen(true);
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white transition-colors duration-150 hover:bg-[#264B40] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add contact
                  </button>
                ) : null}
              </div>

              <DataStateWrapper
                status={contactsStatus}
                error={contactsError}
                onRetry={triggerReload}
                loadingSkeleton={
                  <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
                    <div className="h-24 rounded bg-[#FAF9F6]" />
                  </div>
                }
              >
                <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
                  {contacts.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left">
                        <thead>
                          <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6] text-[12px] font-medium text-[#525E58]">
                            <th className="px-4 py-3">Name</th>
                            <th className="px-4 py-3">Job title</th>
                            <th className="px-4 py-3">Decision role</th>
                            <th className="px-4 py-3">Contact details</th>
                            <th className="px-4 py-3">Consent & source</th>
                            <th className="px-4 py-3">Outreach status</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E8E6E0] text-[13px]">
                          {contacts.map((contact) => {
                            const optedOut = isContactOptedOut(contact);
                            const contactReadOnly = isContactReadOnly(
                              contact,
                              sponsor
                            );
                            const piiBlocked =
                              !permissions.verified_by_server ||
                              !permissions.can_view_contact_pii ||
                              contact.pii_redacted;
                            const piiBlockedLabel = contact.pii_redacted
                              ? 'Redacted by server'
                              : !permissions.verified_by_server
                                ? 'Server verification required'
                                : 'Restricted by role';
                            return (
                              <tr
                                key={contact.contact_id}
                                className="hover:bg-[#FAF9F6]"
                              >
                                <td className="px-4 py-3 font-medium text-[#202824]">
                                  {contact.full_name}
                                </td>
                                <td className="px-4 py-3 text-[#525E58]">
                                  {contact.job_title || '—'}
                                </td>
                                <td className="px-4 py-3 text-[#202824] whitespace-nowrap">
                                  {formatDecisionRole(contact.decision_role)}
                                </td>
                                <td className="px-4 py-3 text-[#525E58]">
                                  {piiBlocked ? (
                                    <span className="text-[12px] text-[#788C83]">
                                      {piiBlockedLabel}
                                    </span>
                                  ) : contact.email || contact.phone ? (
                                    <div className="space-y-0.5 text-[12px]">
                                      {contact.email ? (
                                        <div>{contact.email}</div>
                                      ) : null}
                                      {contact.phone ? (
                                        <div className="font-mono text-[#788C83]">
                                          {contact.phone}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td className="px-4 py-3 text-[12px] text-[#525E58]">
                                  <div>
                                    {contact.consent_basis
                                      ? contact.consent_basis.replace(/_/g, ' ')
                                      : '—'}
                                  </div>
                                  {contact.source_ref ? (
                                    <div className="font-mono text-[11px] text-[#788C83]">
                                      {contact.source_ref}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  {optedOut ? (
                                    <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#9B3B32]">
                                      <Ban
                                        className="h-3.5 w-3.5 shrink-0"
                                        aria-hidden="true"
                                      />
                                      <span>Blocked (opted out)</span>
                                    </div>
                                  ) : (
                                    <span className="text-[12px] text-[#315F52]">
                                      Permitted
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                  {(!contactReadOnly && canManageContacts) ||
                                  (isHistorical2025 && roleAllowsContacts) ? (
                                    <div className="inline-flex items-center gap-3">
                                      {!optedOut ? (
                                        <button
                                          type="button"
                                          disabled={
                                            contactReadOnly ||
                                            !canManageContacts ||
                                            isHistorical2025
                                          }
                                          title={
                                            isHistorical2025
                                              ? READ_ONLY_2025_MESSAGE
                                              : undefined
                                          }
                                          onClick={() => handleOptOut(contact)}
                                          className="text-[12px] font-medium text-[#9B3B32] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          Opt out
                                        </button>
                                      ) : null}
                                      <button
                                        type="button"
                                        disabled={
                                          contactReadOnly ||
                                          !canManageContacts ||
                                          isHistorical2025
                                        }
                                        title={
                                          isHistorical2025
                                            ? READ_ONLY_2025_MESSAGE
                                            : undefined
                                        }
                                        onClick={() => {
                                          if (
                                            contactReadOnly ||
                                            !canManageContacts ||
                                            isHistorical2025
                                          ) {
                                            return;
                                          }
                                          setEditingContact(contact);
                                          setContactDrawerOpen(true);
                                        }}
                                        className="text-[12px] font-medium text-[#315F52] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        Edit
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="font-mono text-[11px] text-[#788C83]">
                                      Read-only
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-6 py-10 text-center">
                      <p className="text-[13px] font-medium text-[#202824]">
                        No contacts recorded yet
                      </p>
                      {canManageContacts ||
                      (isHistorical2025 && roleAllowsContacts) ? (
                        <div className="mt-3">
                          <button
                            type="button"
                            disabled={!canManageContacts || isHistorical2025}
                            title={
                              isHistorical2025
                                ? READ_ONLY_2025_MESSAGE
                                : undefined
                            }
                            onClick={() => {
                              if (!canManageContacts || isHistorical2025) return;
                              setEditingContact(null);
                              setContactDrawerOpen(true);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 py-1.5 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Plus
                              className="h-3.5 w-3.5 text-[#315F52]"
                              aria-hidden="true"
                            />
                            Add contact
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </DataStateWrapper>
            </div>
          ) : null}

          {/* 3. Activity */}
          {activeTab === 'activity' ? (
            <div className="space-y-4">
              {editableSponsor && !readOnly ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActivityFormError(null);
                      setShowInteractionForm(false);
                      if (!outreachCampaignId && campaignsCatalog[0]) {
                        setOutreachCampaignId(campaignsCatalog[0].campaign_id);
                      }
                      setShowOutreachForm((v) => !v);
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white hover:bg-[#264B40]"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Log outreach
                  </button>
                  {outreach.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActivityFormError(null);
                        setShowOutreachForm(false);
                        if (!interactionAttemptId && outreach[0]) {
                          setInteractionAttemptId(outreach[0].attempt_id);
                        }
                        setShowInteractionForm((v) => !v);
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
                    >
                      <Plus className="h-3.5 w-3.5 text-[#315F52]" aria-hidden="true" />
                      Log interaction
                    </button>
                  ) : null}
                </div>
              ) : null}

              {activityFormError ? (
                <div className="rounded border border-[#9B3B32]/30 bg-[#9B3B32]/5 px-3.5 py-2 text-[12px] text-[#9B3B32]">
                  {activityFormError}
                </div>
              ) : null}

              {showOutreachForm && editableSponsor && !readOnly ? (
                <div className="rounded-md border border-[#D9D7D0] bg-white p-4 space-y-3">
                  <p className="text-[13px] font-semibold text-[#202824]">
                    Start outreach attempt
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <select
                      aria-label="Campaign"
                      value={outreachCampaignId}
                      onChange={(e) => setOutreachCampaignId(e.target.value)}
                      className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px]"
                    >
                      <option value="">Select campaign...</option>
                      {campaignsCatalog.map((c) => (
                        <option key={c.campaign_id} value={c.campaign_id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Contact"
                      value={outreachContactId}
                      onChange={(e) => setOutreachContactId(e.target.value)}
                      className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px]"
                    >
                      <option value="">Any / no contact</option>
                      {contacts.map((c) => (
                        <option key={c.contact_id} value={c.contact_id}>
                          {c.full_name}
                          {isContactOptedOut(c) ? ' (opted out)' : ''}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Root event"
                      value={outreachRootEvent}
                      onChange={(e) =>
                        setOutreachRootEvent(
                          e.target.value as
                            | 'outreach_sent'
                            | 'introduction_received'
                            | 'web_inbound'
                        )
                      }
                      className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px]"
                    >
                      <option value="outreach_sent">Outreach sent</option>
                      <option value="introduction_received">
                        Introduction received
                      </option>
                      <option value="web_inbound">Web inbound</option>
                    </select>
                  </div>
                  <input
                    type="text"
                    value={outreachSummary}
                    onChange={(e) => setOutreachSummary(e.target.value)}
                    placeholder="Summary note (optional)"
                    className="h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px]"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowOutreachForm(false)}
                      className="h-8 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={activityFormSubmitting || !outreachCampaignId}
                      onClick={async () => {
                        setActivityFormSubmitting(true);
                        setActivityFormError(null);
                        try {
                          await createOutreachAttempt({
                            campaignId: outreachCampaignId,
                            sponsorId: sponsor.sponsor_id,
                            contactId: outreachContactId || null,
                            rootEventType: outreachRootEvent,
                            startedAt: new Date().toISOString(),
                            summary: outreachSummary.trim() || null,
                          });
                          setShowOutreachForm(false);
                          setOutreachSummary('');
                          triggerReload();
                          onInvalidateDirectory();
                        } catch (err) {
                          setActivityFormError(
                            err instanceof SponsorApiError
                              ? err.message
                              : 'Unable to log outreach attempt.'
                          );
                        } finally {
                          setActivityFormSubmitting(false);
                        }
                      }}
                      className="h-8 rounded-md bg-[#315F52] px-3.5 text-[12px] font-medium text-white disabled:opacity-50"
                    >
                      {activityFormSubmitting ? 'Saving...' : 'Save outreach'}
                    </button>
                  </div>
                </div>
              ) : null}

              {showInteractionForm && editableSponsor && !readOnly ? (
                <div className="rounded-md border border-[#D9D7D0] bg-white p-4 space-y-3">
                  <p className="text-[13px] font-semibold text-[#202824]">
                    Append interaction to attempt
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <select
                      aria-label="Attempt"
                      value={interactionAttemptId}
                      onChange={(e) => setInteractionAttemptId(e.target.value)}
                      className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px]"
                    >
                      {outreach.map((att) => (
                        <option key={att.attempt_id} value={att.attempt_id}>
                          {att.attempt_id} · {att.root_event_type}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Event type"
                      value={interactionEventType}
                      onChange={(e) =>
                        setInteractionEventType(
                          e.target.value as
                            | 'replied'
                            | 'meeting_booked'
                            | 'meeting_held'
                            | 'follow_up_sent'
                            | 'note'
                            | 'opt_out'
                        )
                      }
                      className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px]"
                    >
                      <option value="replied">Replied</option>
                      <option value="follow_up_sent">Follow-up sent</option>
                      <option value="meeting_booked">Meeting booked</option>
                      <option value="meeting_held">Meeting held</option>
                      <option value="note">Note</option>
                      <option value="opt_out">Opt-out</option>
                    </select>
                    <select
                      aria-label="Outcome"
                      value={interactionOutcome}
                      onChange={(e) => setInteractionOutcome(e.target.value)}
                      className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px]"
                    >
                      <option value="positive">Positive</option>
                      <option value="neutral">Neutral</option>
                      <option value="not_interested">Not interested</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="attended">Attended</option>
                      <option value="no_response">No response</option>
                      <option value="do_not_contact">Do not contact</option>
                    </select>
                  </div>
                  <input
                    type="text"
                    value={interactionSummary}
                    onChange={(e) => setInteractionSummary(e.target.value)}
                    placeholder="Interaction summary"
                    className="h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px]"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowInteractionForm(false)}
                      className="h-8 rounded-md border border-[#D9D7D0] bg-white px-3 text-[12px] font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={
                        activityFormSubmitting || !interactionAttemptId
                      }
                      onClick={async () => {
                        setActivityFormSubmitting(true);
                        setActivityFormError(null);
                        try {
                          await createInteraction({
                            attemptId: interactionAttemptId,
                            eventType: interactionEventType,
                            outcome: interactionOutcome,
                            occurredAt: new Date().toISOString(),
                            summary: interactionSummary.trim() || null,
                          });
                          setShowInteractionForm(false);
                          setInteractionSummary('');
                          triggerReload();
                          onInvalidateDirectory();
                        } catch (err) {
                          setActivityFormError(
                            err instanceof SponsorApiError
                              ? err.message
                              : 'Unable to log interaction.'
                          );
                        } finally {
                          setActivityFormSubmitting(false);
                        }
                      }}
                      className="h-8 rounded-md bg-[#315F52] px-3.5 text-[12px] font-medium text-white disabled:opacity-50"
                    >
                      {activityFormSubmitting ? 'Saving...' : 'Save interaction'}
                    </button>
                  </div>
                </div>
              ) : null}

              <DataStateWrapper
                status={activityStatus}
                error={activityError}
                onRetry={triggerReload}
                loadingSkeleton={
                  <div className="space-y-3 rounded-md border border-[#D9D7D0] bg-white p-5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-10 rounded bg-[#FAF9F6]" />
                    ))}
                  </div>
                }
              >
                <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
                  {timelineItems.length > 0 ? (
                    <ul className="divide-y divide-[#E8E6E0]">
                      {timelineItems.map((item) => (
                        <li key={item.key} className="px-5 py-4">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#788C83]">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium capitalize text-[#315F52]">
                                {item.event_type}
                              </span>
                              {item.contact_label ? (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-medium text-[#202824]">
                                    {item.contact_label}
                                  </span>
                                </>
                              ) : null}
                              {item.campaign_label ? (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{item.campaign_label}</span>
                                </>
                              ) : null}
                              {item.outcome ? (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono text-[11px] text-[#525E58]">
                                    {item.outcome.replace(/_/g, ' ')}
                                  </span>
                                </>
                              ) : null}
                            </div>
                            <span className="font-mono text-[11px] tabular-nums">
                              {item.occurred_at}
                            </span>
                          </div>
                          {item.summary ? (
                            <p className="mt-1.5 text-[13px] text-[#202824]">
                              {item.summary}
                            </p>
                          ) : null}
                          {item.actor_label ? (
                            <p className="mt-1 text-[12px] text-[#788C83]">
                              {item.actor_label}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="px-6 py-10 text-center">
                      <p className="text-[13px] font-medium text-[#202824]">
                        No interactions recorded yet
                      </p>
                    </div>
                  )}
                </div>
              </DataStateWrapper>
            </div>
          ) : null}

          {/* 4. Research */}
          {activeTab === 'research' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-[12px] text-[#788C83]">
                <span>External prospect research</span>
                <InfoHint
                  label="Research isolation rule"
                  content="Prospect research estimates are external_research records and never enter commercial pipeline or forecast calculations."
                />
              </div>

              {researchRecords.length > 0 ? (
                <div className="space-y-4">
                  {researchRecords.map((pr) => (
                    <div
                      key={pr.research_id}
                      className="rounded-md border border-[#D9D7D0] bg-white p-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8E6E0] pb-3">
                        <div className="flex flex-wrap items-center gap-2 text-[12px]">
                          <span className="font-semibold text-[#202824]">
                            {pr.action || 'Assessed'}
                          </span>
                          {pr.route_class ? (
                            <>
                              <span className="text-[#788C83]" aria-hidden="true">
                                ·
                              </span>
                              <span className="font-mono text-[#315F52]">
                                Route {pr.route_class}
                              </span>
                            </>
                          ) : null}
                          {pr.value_track ? (
                            <>
                              <span className="text-[#788C83]" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-[#525E58]">
                                {pr.value_track === 'in_kind' ? 'In-kind' : 'Cash'}{' '}
                                track
                              </span>
                            </>
                          ) : null}
                        </div>
                        <span className="font-mono text-[11px] text-[#788C83]">
                          Assessed {pr.assessed_at} · External research
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <p className="text-[11px] font-medium text-[#788C83]">
                            Attractiveness
                          </p>
                          <p className="mt-1 font-mono text-[14px] font-medium text-[#202824] tabular-nums">
                            {pr.attractiveness !== null &&
                            pr.attractiveness !== undefined
                              ? `${pr.attractiveness}/100`
                              : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium text-[#788C83]">
                            Accessibility
                          </p>
                          <p className="mt-1 font-mono text-[14px] font-medium text-[#202824] tabular-nums">
                            {pr.accessibility !== null &&
                            pr.accessibility !== undefined
                              ? `${pr.accessibility}/100`
                              : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium text-[#788C83]">
                            Research estimate (not pipeline)
                          </p>
                          <p className="mt-1 font-mono text-[14px] text-[#525E58] tabular-nums">
                            {pr.face_value_low != null || pr.face_value_high != null
                              ? `${formatCurrencyInr(pr.face_value_low)} – ${formatCurrencyInr(pr.face_value_high)}`
                              : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] font-medium text-[#788C83]">
                            Evidence sources
                          </p>
                          <p className="mt-1 font-mono text-[12px] text-[#525E58]">
                            {pr.evidence_source_ids || '—'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-[#D9D7D0] bg-white px-6 py-10 text-center">
                  <p className="text-[13px] font-medium text-[#202824]">
                    No prospect research assessment recorded
                  </p>
                </div>
              )}
            </div>
          ) : null}

          {/* 5. Campaigns */}
          {activeTab === 'campaigns' ? (
            <DataStateWrapper
              status={
                activityStatus === 'error' && opportunitiesStatus === 'error'
                  ? 'error'
                  : activityStatus === 'loading' ||
                      opportunitiesStatus === 'loading'
                    ? 'loading'
                    : 'ready'
              }
              error={activityError ?? opportunitiesError}
              onRetry={triggerReload}
              loadingSkeleton={
                <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
                  <div className="h-24 rounded bg-[#FAF9F6]" />
                </div>
              }
            >
              <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
                {campaignAssociations.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6] text-[12px] font-medium text-[#525E58]">
                          <th className="px-4 py-3">Campaign</th>
                          <th className="px-4 py-3">Channel</th>
                          <th className="px-4 py-3">Attribution</th>
                          <th className="px-4 py-3 text-right">Attempts</th>
                          <th className="px-4 py-3 text-right">
                            Originated deals
                          </th>
                          {onOpenCampaign ? (
                            <th className="px-4 py-3 text-right">Actions</th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E8E6E0] text-[13px]">
                        {campaignAssociations.map((ca) => (
                          <tr key={ca.campaign_id} className="hover:bg-[#FAF9F6]">
                            <td className="px-4 py-3 font-medium text-[#202824]">
                              {ca.campaign_name}
                            </td>
                            <td className="px-4 py-3 text-[#525E58]">
                              {ca.channel_id
                                ? formatChannelDisplay(
                                    ca.channel_id,
                                    ca.channel_name
                                  )
                                : '—'}
                            </td>
                            <td className="px-4 py-3 text-[#525E58]">
                              {ca.attribution_source === 'both'
                                ? 'Outreach & originating deal'
                                : ca.attribution_source === 'outreach_attempt'
                                  ? 'Outreach attempt'
                                  : 'Originating deal'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-[#202824]">
                              {ca.attempt_count}
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-[#202824]">
                              {ca.opportunity_count}
                            </td>
                            {onOpenCampaign ? (
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => onOpenCampaign(ca.campaign_id)}
                                  className="inline-flex items-center gap-1 text-[12px] font-medium text-[#315F52] hover:underline"
                                >
                                  Open
                                  <ArrowUpRight
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                </button>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-6 py-10 text-center">
                    <p className="text-[13px] font-medium text-[#202824]">
                      No campaign associations yet
                    </p>
                  </div>
                )}
              </div>
            </DataStateWrapper>
          ) : null}

          {/* 6. Opportunities */}
          {activeTab === 'opportunities' ? (
            <DataStateWrapper
              status={opportunitiesStatus}
              error={opportunitiesError}
              onRetry={triggerReload}
              loadingSkeleton={
                <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
                  <div className="h-24 rounded bg-[#FAF9F6]" />
                </div>
              }
            >
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-[12px] text-[#788C83]">
                  <span>Commercial opportunities</span>
                  <InfoHint
                    label="Opportunity value rules"
                    content="Cash and in-kind support are separated by support_type. Confirmed value reflects signed agreements and is never cash collected."
                  />
                </div>

                <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
                  {opportunities.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left">
                        <thead>
                          <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6] text-[12px] font-medium text-[#525E58]">
                            <th className="px-4 py-3">Opportunity</th>
                            <th className="px-4 py-3">Edition</th>
                            <th className="px-4 py-3">Support type</th>
                            <th className="px-4 py-3">Stage</th>
                            <th className="px-4 py-3 text-right">
                              Proposed value
                            </th>
                            <th className="px-4 py-3 text-right">
                              Confirmed value
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E8E6E0] text-[13px]">
                          {opportunities.map((opp) => (
                            <tr
                              key={opp.opportunity_id}
                              className="hover:bg-[#FAF9F6]"
                            >
                              <td className="px-4 py-3 font-medium text-[#202824]">
                                {opp.name || opp.opportunity_id}
                              </td>
                              <td className="px-4 py-3 font-mono text-[12px] text-[#525E58]">
                                {opp.edition_id}
                              </td>
                              <td className="px-4 py-3 text-[#525E58]">
                                {formatSupportType(opp.support_type)}
                              </td>
                              <td className="px-4 py-3 text-[#202824]">
                                {formatOpportunityStage(opp.stage)}
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums text-[#202824]">
                                {formatCurrencyInr(opp.proposed_value)}
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums font-medium text-[#315F52]">
                                {formatCurrencyInr(opp.confirmed_value)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-6 py-10 text-center">
                      <p className="text-[13px] font-medium text-[#202824]">
                        No opportunities yet
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </DataStateWrapper>
          ) : null}

          {/* 7. Contracts */}
          {activeTab === 'contracts' ? (
            <DataStateWrapper
              status={contractsStatus}
              error={contractsError}
              onRetry={triggerReload}
              loadingSkeleton={
                <div className="rounded-md border border-[#D9D7D0] bg-white p-5">
                  <div className="h-24 rounded bg-[#FAF9F6]" />
                </div>
              }
            >
              <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
                {contracts.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6] text-[12px] font-medium text-[#525E58]">
                          <th className="px-4 py-3">Contract ID</th>
                          <th className="px-4 py-3">Opportunity</th>
                          <th className="px-4 py-3">Signed at</th>
                          <th className="px-4 py-3">Payment terms</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3 text-right">
                            Signed value total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E8E6E0] text-[13px]">
                        {contracts.map((contract) => (
                          <tr
                            key={contract.contract_id}
                            className="hover:bg-[#FAF9F6]"
                          >
                            <td className="px-4 py-3 font-mono font-medium text-[#202824]">
                              {contract.contract_id}
                            </td>
                            <td className="px-4 py-3 text-[#525E58]">
                              {contract.opportunity_name ||
                                contract.opportunity_id}
                            </td>
                            <td className="px-4 py-3 font-mono text-[12px] text-[#525E58]">
                              {contract.signed_at
                                ? contract.signed_at.slice(0, 10)
                                : '—'}
                            </td>
                            <td className="px-4 py-3 text-[#525E58]">
                              {contract.payment_terms || '—'}
                            </td>
                            <td className="px-4 py-3 capitalize text-[#202824]">
                              {contract.status}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-medium tabular-nums text-[#315F52]">
                              {formatCurrencyInr(contract.signed_value_total)}
                              {contract.lines && contract.lines.length > 0 ? (
                                <span className="mt-0.5 block text-[11px] font-normal text-[#788C83]">
                                  {contract.lines
                                    .map(
                                      (l) =>
                                        `${l.consideration_type === 'in_kind' ? 'In-kind' : 'Cash'} ${formatCurrencyInr(l.value)}`
                                    )
                                    .join(' · ')}
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-6 py-10 text-center">
                    <p className="text-[13px] font-medium text-[#202824]">
                      No contracts recorded yet
                    </p>
                  </div>
                )}
              </div>
            </DataStateWrapper>
          ) : null}
        </>
      ) : null}

      {sponsor ? (
        <ContactFormDrawer
          open={contactDrawerOpen}
          sponsor={sponsor}
          editingContact={editingContact}
          permissions={permissions}
          onClose={() => {
            setContactDrawerOpen(false);
            setEditingContact(null);
          }}
          onSaved={() => {
            setContactDrawerOpen(false);
            setEditingContact(null);
            triggerReload();
            onInvalidateDirectory();
          }}
        />
      ) : null}
    </div>
  );
}
