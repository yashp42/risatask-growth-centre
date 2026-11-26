import { apiFetch } from './authSession';
import type {
  CampaignEntity,
  CampaignOpportunityRecord,
  InteractionRecord,
  OutreachAttemptRecord,
} from '../types/campaigns';
import type { FilterOption } from '../types/overview';
import type {
  CanonicalRole,
  CategoryEntity,
  ContactDecisionRole,
  ContactEntity,
  ContactWritePayload,
  OwnershipAssignmentRecord,
  ProspectResearchRecord,
  SponsorCampaignAssociation,
  SponsorContractRecord,
  SponsorDirectoryFilters,
  SponsorEntity,
  SponsorFirstSource,
  SponsorLifecycleStatus,
  SponsorRecordClass,
  SponsorWritePayload,
  UserPermissionContext,
} from '../types/sponsors';
import { OVERVIEW_API_ENDPOINTS } from './overviewApi';

export class SponsorApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = 'API_ERROR') {
    super(message);
    this.name = 'SponsorApiError';
    this.status = status;
    this.code = code;
  }
}

export const SPONSOR_LIFECYCLE_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'research_target', label: 'Research target' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'active', label: 'Active' },
  { value: 'past_sponsor', label: 'Past sponsor' },
  { value: 'do_not_contact', label: 'Do not contact' },
];

export const SPONSOR_FIRST_SOURCE_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All sources' },
  { value: 'research', label: 'Research' },
  { value: 'referral', label: 'Referral' },
  { value: 'inbound', label: 'Inbound' },
  { value: 'outreach', label: 'Outreach' },
  { value: 'renewal', label: 'Renewal' },
];

export const SPONSOR_RECORD_CLASS_OPTIONS: FilterOption[] = [
  { value: 'simulated', label: 'Simulated (2026 demo)' },
  { value: 'live', label: 'Live' },
  { value: 'historical_synthetic', label: 'Historical synthetic (2025, read-only)' },
  { value: 'external_research', label: 'External research (read-only)' },
];

export const SPONSOR_EDITION_BY_CLASS: Record<SponsorRecordClass, FilterOption[]> = {
  simulated: [{ value: 'ED-2026-DEMO', label: 'ED-2026-DEMO' }],
  live: [{ value: 'ED-2026-LIVE', label: 'ED-2026-LIVE' }],
  historical_synthetic: [{ value: 'ED-2025', label: 'ED-2025 (CampusFest 2025)' }],
  external_research: [
    { value: 'all', label: 'All editions' },
    { value: 'ED-2026-DEMO', label: 'ED-2026-DEMO' },
    { value: 'ED-2026-LIVE', label: 'ED-2026-LIVE' },
  ],
};

export const CONTACT_DECISION_ROLE_OPTIONS: FilterOption[] = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'decision_maker', label: 'Decision maker' },
  { value: 'influencer', label: 'Influencer' },
  { value: 'user', label: 'User' },
];

/**
 * Provisional consent basis suggestions; backend enum list is open pending OD-28 / DPDP spec.
 */
export const CONTACT_CONSENT_BASIS_SUGGESTIONS: ReadonlyArray<string> = [
  'inbound_form',
  'warm_introduction',
  'business_card',
  'direct_consent',
  'public_listing',
  'past_partnership',
];

export function getDefaultSponsorEditionForClass(
  recordClass: SponsorRecordClass
): string {
  return SPONSOR_EDITION_BY_CLASS[recordClass][0].value;
}

export function formatLifecycleStatus(status: SponsorLifecycleStatus): string {
  switch (status) {
    case 'research_target':
      return 'Research target';
    case 'prospect':
      return 'Prospect';
    case 'active':
      return 'Active';
    case 'past_sponsor':
      return 'Past sponsor';
    case 'do_not_contact':
      return 'Do not contact';
    default:
      return String(status).replace(/_/g, ' ');
  }
}

export function formatFirstSource(source?: SponsorFirstSource | string | null): string {
  if (!source) return '—';
  switch (source) {
    case 'research':
      return 'Research';
    case 'referral':
      return 'Referral';
    case 'inbound':
      return 'Inbound';
    case 'outreach':
      return 'Outreach';
    case 'renewal':
      return 'Renewal';
    default:
      return String(source).replace(/_/g, ' ');
  }
}

export function formatSponsorRecordClass(recordClass: SponsorRecordClass): string {
  switch (recordClass) {
    case 'historical_synthetic':
      return 'Historical synthetic';
    case 'external_research':
      return 'External research';
    case 'simulated':
      return 'Simulated';
    case 'live':
      return 'Live';
  }
}

export function formatDecisionRole(role?: ContactDecisionRole | string | null): string {
  if (!role) return 'Unknown';
  switch (role) {
    case 'decision_maker':
      return 'Decision maker';
    case 'influencer':
      return 'Influencer';
    case 'user':
      return 'User';
    case 'unknown':
      return 'Unknown';
    default:
      return String(role).replace(/_/g, ' ');
  }
}

export function isSponsorReadOnly(sponsor: SponsorEntity): boolean {
  return (
    sponsor.record_class === 'historical_synthetic' ||
    sponsor.record_class === 'external_research' ||
    sponsor.edition_id === 'ED-2025'
  );
}

export function isContactReadOnly(
  contact: ContactEntity,
  sponsor?: SponsorEntity | null
): boolean {
  if (contact.record_class === 'historical_synthetic') return true;
  if (sponsor && isSponsorReadOnly(sponsor)) return true;
  return false;
}

export function isContactOptedOut(contact: ContactEntity): boolean {
  return Boolean(contact.opted_out_at);
}

/**
 * Business rule 1: A sponsor remains `research_target` until an interaction
 * exists with a named contact.
 */
export function hasNamedContactInteraction(
  contacts: ContactEntity[],
  outreach: OutreachAttemptRecord[],
  interactions: InteractionRecord[]
): boolean {
  const namedContactIds = new Set(
    contacts
      .filter((c) => Boolean(c.full_name?.trim()))
      .map((c) => c.contact_id)
  );
  const attemptContactMap = new Map<string, string>();
  for (const att of outreach) {
    if (att.contact_id) {
      attemptContactMap.set(att.attempt_id, att.contact_id);
    }
  }

  return interactions.some((inter) => {
    if (inter.contact_name?.trim()) return true;
    const contactId = inter.contact_id ?? attemptContactMap.get(inter.attempt_id);
    return Boolean(contactId && namedContactIds.has(contactId));
  });
}

/**
 * Business rule 2: `past_sponsor` is assigned only when supported by a
 * contract from an earlier edition.
 */
export function hasPriorEditionContract(
  sponsor: SponsorEntity | null | undefined,
  contracts: SponsorContractRecord[],
  currentEditionId?: string | null
): boolean {
  if (sponsor?.has_prior_edition_contract) return true;
  if (contracts.length === 0) return false;
  return contracts.some((c) => {
    if (c.status === 'terminated') return false;
    if (currentEditionId && c.edition_id) {
      return c.edition_id !== currentEditionId;
    }
    return Boolean(c.edition_id && c.edition_id !== 'ED-2026-DEMO' && c.edition_id !== 'ED-2026-LIVE');
  });
}

const CANONICAL_ROLES: ReadonlySet<CanonicalRole> = new Set([
  'coordination_lead',
  'pipeline_ops',
  'finance_collections',
  'partnerships',
  'community',
  'network',
  'premium_sales',
  'viewer',
  'admin',
]);

const ALL_RECORDS_SPONSOR_WRITE_ROLES: ReadonlyArray<CanonicalRole> = [
  'coordination_lead',
  'pipeline_ops',
];

const OWN_RECORDS_SPONSOR_WRITE_ROLES: ReadonlyArray<CanonicalRole> = [
  'partnerships',
  'community',
  'network',
  'premium_sales',
];

/**
 * Unverified fallback when GET /api/me is unavailable (e.g., no backend mounted).
 * Fails closed on sensitive UI fields (GSTIN and Contact PII hidden) while
 * leaving non-sensitive UI controls inspectable without claiming server security.
 */
export const DEFAULT_UNVERIFIED_PERMISSIONS: UserPermissionContext = {
  member_id: null,
  full_name: null,
  roles: [],
  unrecognized_roles: [],
  write_scope: 'none',
  can_write_sponsors: true,
  can_write_contacts: true,
  can_view_gstin: false,
  can_view_contact_pii: false,
  verified_by_server: false,
};

/**
 * Maps role strings returned by GET /api/me explicitly to canonical ROLE_ASSIGNMENT.role
 * values (01_conceptual_data_model.md §4G) and the §4 permission matrix
 * (02_architecture_requirements.md §4).
 * - `admin` is kept separate from business roles (OD-24) and does not imply business CRU/R.
 * - Unrecognized role strings are retained in `unrecognized_roles` rather than aliased.
 */
export function resolvePermissionContext(raw: Record<string, unknown>): UserPermissionContext {
  const inputRoles = Array.isArray(raw.roles)
    ? raw.roles.map((r) => String(r).trim().toLowerCase())
    : raw.role
      ? [String(raw.role).trim().toLowerCase()]
      : [];

  const canonicalRoles: CanonicalRole[] = [];
  const unrecognizedRoles: string[] = [];

  for (const r of inputRoles) {
    if (!r) continue;
    if (CANONICAL_ROLES.has(r as CanonicalRole)) {
      if (!canonicalRoles.includes(r as CanonicalRole)) {
        canonicalRoles.push(r as CanonicalRole);
      }
    } else {
      unrecognizedRoles.push(r);
    }
  }

  const hasAny = (candidates: ReadonlyArray<CanonicalRole>) =>
    candidates.some((c) => canonicalRoles.includes(c));

  const hasAllWrite = hasAny(ALL_RECORDS_SPONSOR_WRITE_ROLES);
  const hasOwnWrite = hasAny(OWN_RECORDS_SPONSOR_WRITE_ROLES);
  const writeScope: UserPermissionContext['write_scope'] = hasAllWrite
    ? 'all'
    : hasOwnWrite
      ? 'own'
      : 'none';

  const canWrite = writeScope !== 'none';
  const hasFinance = canonicalRoles.includes('finance_collections');
  // In §4 permission matrix, `viewer` has R on Sponsors/Contacts, and NFR-09 restricts
  // personal data & tax IDs by role; `admin` without a business role has no business data row (OD-24).
  const canViewRestrictedFields = canWrite || hasFinance;

  return {
    member_id:
      (raw.member_id as string | null | undefined) ??
      (raw.id as string | null | undefined) ??
      null,
    full_name:
      (raw.full_name as string | null | undefined) ??
      (raw.name as string | null | undefined) ??
      null,
    roles: canonicalRoles,
    unrecognized_roles: unrecognizedRoles,
    write_scope: writeScope,
    can_write_sponsors: canWrite,
    can_write_contacts: canWrite,
    can_view_gstin: canViewRestrictedFields,
    can_view_contact_pii: canViewRestrictedFields,
    verified_by_server: true,
  };
}

/**
 * UI-level edit check derived from §4 permission matrix and current OWNERSHIP_ASSIGNMENT.
 * Server endpoints must independently enforce row ownership and role permissions.
 */
export function canUserEditSponsor(
  sponsor: SponsorEntity,
  permissions: UserPermissionContext
): boolean {
  if (isSponsorReadOnly(sponsor)) return false;
  if (!permissions.verified_by_server) return true;
  if (permissions.write_scope === 'all') return true;
  if (permissions.write_scope === 'none') return false;
  // `own` scope (partnerships / community / network / premium_sales):
  // requires current OWNERSHIP_ASSIGNMENT.member_id === permissions.member_id
  if (!permissions.member_id || !sponsor.current_ownership?.member_id) {
    return false;
  }
  return sponsor.current_ownership.member_id === permissions.member_id;
}

export function canUserManageSponsorContacts(
  sponsor: SponsorEntity,
  permissions: UserPermissionContext
): boolean {
  if (isSponsorReadOnly(sponsor)) return false;
  if (!permissions.verified_by_server) return true;
  if (permissions.write_scope === 'all') return true;
  if (permissions.write_scope === 'none') return false;
  if (!permissions.member_id || !sponsor.current_ownership?.member_id) {
    return false;
  }
  return sponsor.current_ownership.member_id === permissions.member_id;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');

  if (!response.ok) {
    let message = 'Unable to complete the request.';
    let code = `HTTP_${response.status}`;

    if (isJson) {
      try {
        const errBody = (await response.json()) as {
          message?: string;
          error?: string;
          code?: string;
        };
        if (errBody.message) message = errBody.message;
        else if (errBody.error) message = errBody.error;
        if (errBody.code) code = errBody.code;
      } catch {
        // Ignore parse error
      }
    } else if (response.status === 403) {
      message = 'You do not have permission to perform this action.';
    } else if (response.status === 404) {
      message = 'Sponsor data is currently unavailable.';
    }

    throw new SponsorApiError(message, response.status, code);
  }

  if (!isJson) {
    throw new SponsorApiError(
      'Sponsor service is currently unavailable.',
      503,
      'SERVICE_UNAVAILABLE'
    );
  }

  return (await response.json()) as T;
}

function normalizeResearch(raw: Record<string, unknown>): ProspectResearchRecord {
  return {
    research_id: String(raw.research_id ?? raw.id ?? ''),
    sponsor_id: String(raw.sponsor_id ?? ''),
    edition_id: (raw.edition_id as string | null | undefined) ?? null,
    attractiveness:
      raw.attractiveness !== null && raw.attractiveness !== undefined
        ? Number(raw.attractiveness)
        : null,
    accessibility:
      raw.accessibility !== null && raw.accessibility !== undefined
        ? Number(raw.accessibility)
        : null,
    route_class: (raw.route_class as string | null | undefined) ?? null,
    action: (raw.action as string | null | undefined) ?? null,
    value_track:
      (raw.value_track as ProspectResearchRecord['value_track'] | null | undefined) ??
      null,
    face_value_low:
      raw.face_value_low !== null && raw.face_value_low !== undefined
        ? Number(raw.face_value_low)
        : null,
    face_value_high:
      raw.face_value_high !== null && raw.face_value_high !== undefined
        ? Number(raw.face_value_high)
        : null,
    evidence_source_ids:
      (raw.evidence_source_ids as string | null | undefined) ?? null,
    assessed_at: String(raw.assessed_at ?? ''),
    record_class: 'external_research',
    source_ref: (raw.source_ref as string | null | undefined) ?? null,
    data_version:
      (raw.data_version as string | number | null | undefined) ?? null,
  };
}

function normalizeOwnershipAssignment(
  raw: Record<string, unknown>,
  fallbackSponsorId: string
): OwnershipAssignmentRecord {
  const isCurrent =
    typeof raw.is_current === 'boolean'
      ? raw.is_current
      : raw.valid_to === null || raw.valid_to === undefined;
  return {
    assignment_id: String(raw.assignment_id ?? raw.id ?? 'derived-current'),
    subject_type:
      (raw.subject_type as OwnershipAssignmentRecord['subject_type']) ?? 'sponsor',
    subject_id: String(raw.subject_id ?? fallbackSponsorId),
    member_id: String(raw.member_id ?? raw.owner_member_id ?? ''),
    role_in_relationship:
      (raw.role_in_relationship as OwnershipAssignmentRecord['role_in_relationship']) ??
      'owner',
    reason: (raw.reason as string | null | undefined) ?? null,
    valid_from: (raw.valid_from as string | null | undefined) ?? null,
    valid_to: (raw.valid_to as string | null | undefined) ?? null,
    is_current: isCurrent,
    record_class:
      (raw.record_class as OwnershipAssignmentRecord['record_class'] | undefined) ??
      undefined,
    created_at: (raw.created_at as string | null | undefined) ?? null,
    created_by: (raw.created_by as string | null | undefined) ?? null,
    member_name:
      (raw.member_name as string | null | undefined) ??
      (raw.owner_name as string | null | undefined) ??
      null,
  };
}

function normalizeSponsor(raw: Record<string, unknown>): SponsorEntity {
  const sponsorId = String(raw.sponsor_id ?? raw.id ?? '');
  const rawResearch = Array.isArray(raw.prospect_research)
    ? (raw.prospect_research as Array<Record<string, unknown>>).map(normalizeResearch)
    : null;

  const rawHistorySource = Array.isArray(raw.ownership_history)
    ? (raw.ownership_history as Array<Record<string, unknown>>)
    : Array.isArray(raw.ownership_assignments)
      ? (raw.ownership_assignments as Array<Record<string, unknown>>)
      : null;

  const ownershipHistory: OwnershipAssignmentRecord[] | null = rawHistorySource
    ? rawHistorySource
        .map((item) => normalizeOwnershipAssignment(item, sponsorId))
        .filter((item) => Boolean(item.member_id))
    : null;

  let currentOwnership: OwnershipAssignmentRecord | null = null;
  if (raw.current_ownership && typeof raw.current_ownership === 'object') {
    const parsed = normalizeOwnershipAssignment(
      raw.current_ownership as Record<string, unknown>,
      sponsorId
    );
    if (parsed.member_id) currentOwnership = parsed;
  } else if (ownershipHistory && ownershipHistory.length > 0) {
    currentOwnership =
      ownershipHistory.find(
        (a) =>
          (a.is_current ?? !a.valid_to) &&
          (a.role_in_relationship ?? 'owner') === 'owner'
      ) ??
      ownershipHistory.find((a) => a.is_current ?? !a.valid_to) ??
      null;
  } else if (raw.owner_member_id) {
    // Compatibility projection if a server view returns a joined owner_member_id
    currentOwnership = normalizeOwnershipAssignment(
      {
        assignment_id: 'derived-current',
        subject_type: 'sponsor',
        subject_id: sponsorId,
        member_id: raw.owner_member_id,
        member_name: raw.owner_name ?? null,
        role_in_relationship: 'owner',
        is_current: true,
      },
      sponsorId
    );
  }

  return {
    sponsor_id: sponsorId,
    display_name: String(raw.display_name ?? ''),
    legal_name: (raw.legal_name as string | null | undefined) ?? null,
    category_id: (raw.category_id as string | null | undefined) ?? null,
    lifecycle_status:
      (raw.lifecycle_status as SponsorLifecycleStatus) ?? 'research_target',
    first_source: (raw.first_source as SponsorFirstSource | null | undefined) ?? null,
    gstin: (raw.gstin as string | null | undefined) ?? null,
    website: (raw.website as string | null | undefined) ?? null,
    city: (raw.city as string | null | undefined) ?? null,
    record_class: (raw.record_class as SponsorRecordClass) ?? 'simulated',
    source_ref: (raw.source_ref as string | null | undefined) ?? null,
    data_version:
      (raw.data_version as string | number | null | undefined) ?? null,
    created_at: (raw.created_at as string | null | undefined) ?? null,
    created_by: (raw.created_by as string | null | undefined) ?? null,
    edition_id: (raw.edition_id as string | null | undefined) ?? null,
    category_name: (raw.category_name as string | null | undefined) ?? null,
    category_tier: (raw.category_tier as string | null | undefined) ?? null,
    current_ownership: currentOwnership,
    ownership_history: ownershipHistory,
    gstin_redacted: Boolean(raw.gstin_redacted),
    has_prior_edition_contract: Boolean(raw.has_prior_edition_contract),
    prospect_research: rawResearch,
  };
}

function normalizeContact(raw: Record<string, unknown>): ContactEntity {
  return {
    contact_id: String(raw.contact_id ?? raw.id ?? ''),
    sponsor_id: String(raw.sponsor_id ?? ''),
    full_name: String(raw.full_name ?? ''),
    job_title: (raw.job_title as string | null | undefined) ?? null,
    decision_role: (raw.decision_role as ContactDecisionRole) ?? 'unknown',
    email: (raw.email as string | null | undefined) ?? null,
    phone: (raw.phone as string | null | undefined) ?? null,
    consent_basis: (raw.consent_basis as string | null | undefined) ?? null,
    opted_out_at: (raw.opted_out_at as string | null | undefined) ?? null,
    record_class:
      (raw.record_class as ContactEntity['record_class']) ?? 'simulated',
    source_ref: (raw.source_ref as string | null | undefined) ?? null,
    data_version:
      (raw.data_version as string | number | null | undefined) ?? null,
    created_at: (raw.created_at as string | null | undefined) ?? null,
    created_by: (raw.created_by as string | null | undefined) ?? null,
    pii_redacted: Boolean(raw.pii_redacted),
  };
}

export async function fetchCurrentUserPermissions(
  signal?: AbortSignal
): Promise<UserPermissionContext> {
  try {
    const raw = await requestJson<Record<string, unknown>>(
      OVERVIEW_API_ENDPOINTS.me,
      { signal }
    );
    return resolvePermissionContext(raw);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return DEFAULT_UNVERIFIED_PERMISSIONS;
  }
}

function normalizeCategory(raw: Record<string, unknown>): CategoryEntity {
  return {
    category_id: String(raw.category_id ?? raw.id ?? ''),
    name: String(raw.name ?? raw.category_id ?? ''),
    parent_category_id:
      (raw.parent_category_id as string | null | undefined) ?? null,
    tier: (raw.tier as string | null | undefined) ?? null,
    dataset_industry:
      (raw.dataset_industry as string | null | undefined) ?? null,
    record_class: (raw.record_class as string | null | undefined) ?? null,
  };
}

export interface ReferenceCategoriesResult {
  categories: CategoryEntity[];
  available: boolean;
}

export async function fetchReferenceCategories(
  signal?: AbortSignal
): Promise<ReferenceCategoriesResult> {
  try {
    const raw = await requestJson<
      | Array<Record<string, unknown>>
      | {
          categories?: Array<Record<string, unknown>>;
          items?: Array<Record<string, unknown>>;
        }
    >(OVERVIEW_API_ENDPOINTS.referenceCategories, { signal });

    const list = Array.isArray(raw) ? raw : raw.categories ?? raw.items ?? [];
    const categories = list
      .map(normalizeCategory)
      .filter((c) => Boolean(c.category_id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { categories, available: true };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return { categories: [], available: false };
  }
}

export interface SponsorDirectoryResult {
  sponsors: SponsorEntity[];
  categories: FilterOption[];
  cities: FilterOption[];
}

export async function fetchSponsorsDirectory(
  filters: SponsorDirectoryFilters,
  signal?: AbortSignal
): Promise<SponsorDirectoryResult> {
  const params = new URLSearchParams({
    record_class: filters.record_class,
  });
  if (filters.edition_id && filters.edition_id !== 'all') {
    params.set('edition_id', filters.edition_id);
  }
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.lifecycle_status !== 'all') {
    params.set('lifecycle_status', filters.lifecycle_status);
  }
  if (filters.category_id !== 'all') {
    params.set('category_id', filters.category_id);
  }
  if (filters.first_source !== 'all') {
    params.set('first_source', filters.first_source);
  }
  if (filters.city !== 'all') {
    params.set('city', filters.city);
  }

  const rawData = await requestJson<
    | Array<Record<string, unknown>>
    | { sponsors?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }
  >(`${OVERVIEW_API_ENDPOINTS.sponsors}?${params.toString()}`, { signal });

  const rawList = Array.isArray(rawData)
    ? rawData
    : rawData.sponsors ?? rawData.items ?? [];

  const sponsors = rawList.map(normalizeSponsor);

  const catMap = new Map<string, string>();
  const citySet = new Set<string>();
  for (const sp of sponsors) {
    if (sp.category_id) {
      catMap.set(sp.category_id, sp.category_name || sp.category_id);
    }
    if (sp.city?.trim()) {
      citySet.add(sp.city.trim());
    }
  }

  const categories: FilterOption[] = [
    { value: 'all', label: 'All categories' },
    ...Array.from(catMap.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label })),
  ];

  const cities: FilterOption[] = [
    { value: 'all', label: 'All cities' },
    ...Array.from(citySet)
      .sort((a, b) => a.localeCompare(b))
      .map((city) => ({ value: city, label: city })),
  ];

  return { sponsors, categories, cities };
}

export async function fetchSponsorById(
  sponsorId: string,
  recordClass?: SponsorRecordClass,
  editionId?: string,
  signal?: AbortSignal
): Promise<SponsorEntity> {
  const params = new URLSearchParams({ sponsor_id: sponsorId });
  if (recordClass) params.set('record_class', recordClass);
  if (editionId && editionId !== 'all') params.set('edition_id', editionId);

  const rawData = await requestJson<
    | Array<Record<string, unknown>>
    | (Record<string, unknown> & {
        sponsor?: Record<string, unknown>;
        sponsors?: Array<Record<string, unknown>>;
        items?: Array<Record<string, unknown>>;
      })
  >(`${OVERVIEW_API_ENDPOINTS.sponsors}?${params.toString()}`, { signal });

  if (Array.isArray(rawData)) {
    const match =
      rawData.find((r) => String(r.sponsor_id ?? r.id ?? '') === sponsorId) ??
      rawData[0];
    if (!match) {
      throw new SponsorApiError('Sponsor not found.', 404, 'NOT_FOUND');
    }
    return normalizeSponsor(match);
  }
  if (rawData.sponsor) {
    return normalizeSponsor(rawData.sponsor);
  }
  const arr = rawData.sponsors ?? rawData.items;
  if (Array.isArray(arr)) {
    const match =
      arr.find((r) => String(r.sponsor_id ?? r.id ?? '') === sponsorId) ??
      arr[0];
    if (!match) {
      throw new SponsorApiError('Sponsor not found.', 404, 'NOT_FOUND');
    }
    return normalizeSponsor(match);
  }
  return normalizeSponsor(rawData);
}

export async function createSponsor(
  payload: SponsorWritePayload
): Promise<{ sponsor: SponsorEntity; data_version?: string | number }> {
  const res = await requestJson<
    Record<string, unknown> & {
      sponsor?: Record<string, unknown>;
      data_version?: string | number;
    }
  >(OVERVIEW_API_ENDPOINTS.sponsors, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const sponsor = res.sponsor
    ? normalizeSponsor(res.sponsor)
    : normalizeSponsor(res);
  return { sponsor, data_version: res.data_version };
}

export async function updateSponsor(
  sponsorId: string,
  payload: Partial<SponsorWritePayload>,
  currentRecord?: SponsorEntity
): Promise<{ sponsor: SponsorEntity; data_version?: string | number }> {
  if (currentRecord && isSponsorReadOnly(currentRecord)) {
    throw new SponsorApiError(
      'This sponsor record is read-only and cannot be modified.',
      403,
      'READ_ONLY_RECORD'
    );
  }

  const res = await requestJson<
    Record<string, unknown> & {
      sponsor?: Record<string, unknown>;
      data_version?: string | number;
    }
  >(`${OVERVIEW_API_ENDPOINTS.sponsors}/${encodeURIComponent(sponsorId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  const sponsor = res.sponsor
    ? normalizeSponsor(res.sponsor)
    : normalizeSponsor(res);
  return { sponsor, data_version: res.data_version };
}

export async function fetchSponsorContacts(
  sponsorId: string,
  recordClass?: SponsorRecordClass,
  signal?: AbortSignal
): Promise<ContactEntity[]> {
  const params = new URLSearchParams({ sponsor_id: sponsorId });
  if (recordClass && recordClass !== 'external_research') {
    params.set('record_class', recordClass);
  }

  const res = await requestJson<
    | Array<Record<string, unknown>>
    | { contacts?: Array<Record<string, unknown>>; items?: Array<Record<string, unknown>> }
  >(`${OVERVIEW_API_ENDPOINTS.contacts}?${params.toString()}`, { signal });

  const list = Array.isArray(res) ? res : res.contacts ?? res.items ?? [];
  return list.map(normalizeContact);
}

export async function createContact(
  payload: ContactWritePayload,
  parentSponsor?: SponsorEntity | null
): Promise<{ contact: ContactEntity; data_version?: string | number }> {
  if (parentSponsor && isSponsorReadOnly(parentSponsor)) {
    throw new SponsorApiError(
      'Contacts cannot be added to read-only records.',
      403,
      'READ_ONLY_RECORD'
    );
  }
  const res = await requestJson<
    Record<string, unknown> & {
      contact?: Record<string, unknown>;
      data_version?: string | number;
    }
  >(OVERVIEW_API_ENDPOINTS.contacts, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const contact = res.contact
    ? normalizeContact(res.contact)
    : normalizeContact(res);
  return { contact, data_version: res.data_version };
}

export async function updateContact(
  contactId: string,
  payload: Partial<ContactWritePayload>,
  currentContact?: ContactEntity | null,
  parentSponsor?: SponsorEntity | null
): Promise<{ contact: ContactEntity; data_version?: string | number }> {
  if (currentContact && isContactReadOnly(currentContact, parentSponsor)) {
    throw new SponsorApiError(
      'This contact record is read-only and cannot be modified.',
      403,
      'READ_ONLY_RECORD'
    );
  }
  const res = await requestJson<
    Record<string, unknown> & {
      contact?: Record<string, unknown>;
      data_version?: string | number;
    }
  >(`${OVERVIEW_API_ENDPOINTS.contacts}/${encodeURIComponent(contactId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  const contact = res.contact
    ? normalizeContact(res.contact)
    : normalizeContact(res);
  return { contact, data_version: res.data_version };
}

export async function markContactOptedOut(
  contactId: string,
  currentContact?: ContactEntity | null,
  parentSponsor?: SponsorEntity | null
): Promise<{ contact: ContactEntity; data_version?: string | number }> {
  return updateContact(
    contactId,
    { opted_out_at: new Date().toISOString() },
    currentContact,
    parentSponsor
  );
}

export async function fetchSponsorOutreach(
  sponsorId: string,
  recordClass: SponsorRecordClass,
  editionId?: string,
  signal?: AbortSignal
): Promise<OutreachAttemptRecord[]> {
  if (recordClass === 'external_research') return [];
  const params = new URLSearchParams({
    sponsor_id: sponsorId,
    record_class: recordClass,
  });
  if (editionId && editionId !== 'all') params.set('edition_id', editionId);

  const res = await requestJson<
    | OutreachAttemptRecord[]
    | { outreach?: OutreachAttemptRecord[]; items?: OutreachAttemptRecord[] }
  >(`${OVERVIEW_API_ENDPOINTS.outreach}?${params.toString()}`, { signal });

  return Array.isArray(res) ? res : res.outreach ?? res.items ?? [];
}

export async function fetchSponsorInteractions(
  sponsorId: string,
  recordClass: SponsorRecordClass,
  editionId?: string,
  signal?: AbortSignal
): Promise<InteractionRecord[]> {
  if (recordClass === 'external_research') return [];
  const params = new URLSearchParams({
    sponsor_id: sponsorId,
    record_class: recordClass,
  });
  if (editionId && editionId !== 'all') params.set('edition_id', editionId);

  const res = await requestJson<
    | InteractionRecord[]
    | { interactions?: InteractionRecord[]; items?: InteractionRecord[] }
  >(`${OVERVIEW_API_ENDPOINTS.interactions}?${params.toString()}`, { signal });

  const list = Array.isArray(res) ? res : res.interactions ?? res.items ?? [];
  return [...list].sort((a, b) =>
    (b.occurred_at || '').localeCompare(a.occurred_at || '')
  );
}

export async function fetchSponsorOpportunities(
  sponsorId: string,
  recordClass: SponsorRecordClass,
  editionId?: string,
  signal?: AbortSignal
): Promise<CampaignOpportunityRecord[]> {
  if (recordClass === 'external_research') return [];
  const params = new URLSearchParams({
    sponsor_id: sponsorId,
    record_class: recordClass,
  });
  if (editionId && editionId !== 'all') params.set('edition_id', editionId);

  const res = await requestJson<
    | CampaignOpportunityRecord[]
    | { opportunities?: CampaignOpportunityRecord[]; items?: CampaignOpportunityRecord[] }
  >(`${OVERVIEW_API_ENDPOINTS.opportunities}?${params.toString()}`, { signal });

  return Array.isArray(res) ? res : res.opportunities ?? res.items ?? [];
}

export async function fetchSponsorContracts(
  sponsorId: string,
  recordClass: SponsorRecordClass,
  signal?: AbortSignal
): Promise<SponsorContractRecord[]> {
  if (recordClass === 'external_research' || recordClass === 'historical_synthetic') {
    return [];
  }
  const params = new URLSearchParams({
    sponsor_id: sponsorId,
    record_class: recordClass,
  });

  const res = await requestJson<
    | SponsorContractRecord[]
    | { contracts?: SponsorContractRecord[]; items?: SponsorContractRecord[] }
  >(`${OVERVIEW_API_ENDPOINTS.contracts}?${params.toString()}`, { signal });

  return Array.isArray(res) ? res : res.contracts ?? res.items ?? [];
}

export async function fetchCampaignsForSponsorContext(
  recordClass: SponsorRecordClass,
  editionId?: string,
  signal?: AbortSignal
): Promise<CampaignEntity[]> {
  if (recordClass === 'external_research') return [];
  const params = new URLSearchParams({
    record_class: recordClass,
  });
  if (editionId && editionId !== 'all') params.set('edition_id', editionId);

  const res = await requestJson<
    | CampaignEntity[]
    | { campaigns?: CampaignEntity[]; items?: CampaignEntity[] }
  >(`${OVERVIEW_API_ENDPOINTS.campaigns}?${params.toString()}`, { signal });

  return Array.isArray(res) ? res : res.campaigns ?? res.items ?? [];
}

/**
 * Derives campaign associations strictly from actual OUTREACH_ATTEMPT.campaign_id
 * and OPPORTUNITY.originating_campaign_id attribution relationships.
 */
export function deriveSponsorCampaigns(
  outreach: OutreachAttemptRecord[],
  opportunities: CampaignOpportunityRecord[],
  campaignsCatalog: CampaignEntity[]
): SponsorCampaignAssociation[] {
  const catalogMap = new Map<string, CampaignEntity>();
  for (const c of campaignsCatalog) {
    catalogMap.set(c.campaign_id, c);
  }

  const map = new Map<string, SponsorCampaignAssociation>();

  for (const att of outreach) {
    if (!att.campaign_id) continue;
    const cat = catalogMap.get(att.campaign_id);
    const existing = map.get(att.campaign_id);
    if (existing) {
      existing.attempt_count += 1;
    } else {
      map.set(att.campaign_id, {
        campaign_id: att.campaign_id,
        campaign_name: cat?.name || att.campaign_id,
        channel_id: cat?.channel_id ?? null,
        channel_name: cat?.channel_name ?? null,
        bet_id: cat?.bet_id ?? null,
        status: cat?.status ?? null,
        attribution_source: 'outreach_attempt',
        attempt_count: 1,
        opportunity_count: 0,
      });
    }
  }

  for (const opp of opportunities) {
    if (!opp.originating_campaign_id) continue;
    const cid = opp.originating_campaign_id;
    const cat = catalogMap.get(cid);
    const existing = map.get(cid);
    if (existing) {
      existing.opportunity_count += 1;
      if (existing.attribution_source === 'outreach_attempt') {
        existing.attribution_source = 'both';
      }
    } else {
      map.set(cid, {
        campaign_id: cid,
        campaign_name: cat?.name || cid,
        channel_id: cat?.channel_id ?? null,
        channel_name: cat?.channel_name ?? null,
        bet_id: cat?.bet_id ?? null,
        status: cat?.status ?? null,
        attribution_source: 'originating_opportunity',
        attempt_count: 0,
        opportunity_count: 1,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.campaign_name.localeCompare(b.campaign_name)
  );
}
