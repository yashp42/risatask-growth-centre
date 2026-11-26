import type { CampaignEntity } from './campaigns';

/**
 * Canonical SPONSOR.lifecycle_status enum (01_conceptual_data_model.md §4A)
 */
export type SponsorLifecycleStatus =
  | 'research_target'
  | 'prospect'
  | 'active'
  | 'past_sponsor'
  | 'do_not_contact';

/**
 * Canonical SPONSOR.first_source enum (01_conceptual_data_model.md §4A)
 */
export type SponsorFirstSource =
  | 'research'
  | 'referral'
  | 'inbound'
  | 'outreach'
  | 'renewal';

/**
 * Canonical SPONSOR.allowed_record_classes (01_conceptual_data_model.md §4A)
 */
export type SponsorRecordClass =
  | 'historical_synthetic'
  | 'external_research'
  | 'simulated'
  | 'live';

/**
 * Canonical CONTACT.decision_role enum (01_conceptual_data_model.md §4A)
 */
export type ContactDecisionRole =
  | 'decision_maker'
  | 'influencer'
  | 'user'
  | 'unknown';

/**
 * Canonical PROSPECT_RESEARCH enums (01_conceptual_data_model.md §4A)
 */
export type ProspectRouteClass =
  | 'A'
  | 'V1'
  | 'V2'
  | 'V3'
  | 'U_local'
  | 'U'
  | 'U_out';

export type ProspectResearchAction =
  | 'Pursue now'
  | 'Build a route'
  | 'Opportunistic'
  | 'Deprioritise';

export type ProspectValueTrack = 'cash' | 'in_kind';

/**
 * Canonical ROLE_ASSIGNMENT.role enum (01_conceptual_data_model.md §4G)
 */
export type CanonicalRole =
  | 'coordination_lead'
  | 'pipeline_ops'
  | 'finance_collections'
  | 'partnerships'
  | 'community'
  | 'network'
  | 'premium_sales'
  | 'viewer'
  | 'admin';

/**
 * Canonical CATEGORY entity (01_conceptual_data_model.md §4A)
 */
export type CategoryTier = 'T1' | 'T2' | 'selective';

export interface CategoryEntity {
  category_id: string;
  name: string;
  parent_category_id?: string | null;
  tier?: CategoryTier | string | null;
  dataset_industry?: string | null;
  record_class?: string | null;
}

/**
 * Canonical OWNERSHIP_ASSIGNMENT entity (01_conceptual_data_model.md §4A)
 * Versioned full-state records preserving ownership and handoff history.
 */
export type OwnershipSubjectType = 'sponsor' | 'opportunity' | 'network_partner';
export type OwnershipRelationshipRole = 'owner' | 'support';

export interface OwnershipAssignmentRecord {
  assignment_id: string;
  subject_type: OwnershipSubjectType;
  subject_id: string;
  member_id: string;
  role_in_relationship?: OwnershipRelationshipRole | null;
  reason?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  is_current?: boolean;
  record_class?: 'historical_synthetic' | 'simulated' | 'live';
  created_at?: string | null;
  created_by?: string | null;
  // Optional server-joined display label from TEAM_MEMBER
  member_name?: string | null;
}

/**
 * Canonical SPONSOR entity (01_conceptual_data_model.md §4A)
 * Exact attributes: sponsor_id, display_name, legal_name, category_id,
 * lifecycle_status, first_source, gstin, website, city.
 * Ownership is never stored on SPONSOR; current_ownership and ownership_history
 * are derived from OWNERSHIP_ASSIGNMENT.
 */
export interface SponsorEntity {
  sponsor_id: string;
  display_name: string;
  legal_name?: string | null;
  category_id?: string | null;
  lifecycle_status: SponsorLifecycleStatus;
  first_source?: SponsorFirstSource | null;
  gstin?: string | null;
  website?: string | null;
  city?: string | null;
  // Standard provenance block
  record_class: SponsorRecordClass;
  source_ref?: string | null;
  data_version?: string | number | null;
  created_at?: string | null;
  created_by?: string | null;
  // Optional read-only context joined/derived by server
  edition_id?: string | null;
  category_name?: string | null;
  category_tier?: string | null;
  current_ownership?: OwnershipAssignmentRecord | null;
  ownership_history?: OwnershipAssignmentRecord[] | null;
  gstin_redacted?: boolean;
  has_prior_edition_contract?: boolean;
  prospect_research?: ProspectResearchRecord[] | null;
}

/**
 * Write payload restricted strictly to canonical SPONSOR attributes + provenance class
 */
export interface SponsorWritePayload {
  display_name: string;
  legal_name?: string | null;
  category_id?: string | null;
  lifecycle_status: SponsorLifecycleStatus;
  first_source?: SponsorFirstSource | null;
  gstin?: string | null;
  website?: string | null;
  city?: string | null;
  record_class: 'simulated' | 'live';
  edition_id?: string;
}

/**
 * Canonical CONTACT entity (01_conceptual_data_model.md §4A)
 * Exact attributes: contact_id, sponsor_id, full_name, job_title,
 * decision_role, email, phone, consent_basis, opted_out_at.
 */
export interface ContactEntity {
  contact_id: string;
  sponsor_id: string;
  full_name: string;
  job_title?: string | null;
  decision_role: ContactDecisionRole;
  email?: string | null;
  phone?: string | null;
  consent_basis?: string | null;
  opted_out_at?: string | null;
  // Standard provenance block
  record_class: 'historical_synthetic' | 'simulated' | 'live';
  source_ref?: string | null;
  data_version?: string | number | null;
  created_at?: string | null;
  created_by?: string | null;
  // Server redaction marker if viewer lacks PII permission
  pii_redacted?: boolean;
}

export interface ContactWritePayload {
  sponsor_id: string;
  full_name: string;
  job_title?: string | null;
  decision_role: ContactDecisionRole;
  email?: string | null;
  phone?: string | null;
  consent_basis?: string | null;
  opted_out_at?: string | null;
  source_ref?: string | null;
  record_class: 'simulated' | 'live';
}

/**
 * Canonical PROSPECT_RESEARCH entity (01_conceptual_data_model.md §4A)
 */
export interface ProspectResearchRecord {
  research_id: string;
  sponsor_id: string;
  edition_id?: string | null;
  attractiveness?: number | null;
  accessibility?: number | null;
  route_class?: ProspectRouteClass | string | null;
  action?: ProspectResearchAction | string | null;
  value_track?: ProspectValueTrack | null;
  face_value_low?: number | null;
  face_value_high?: number | null;
  evidence_source_ids?: string | null;
  assessed_at: string;
  record_class: 'external_research';
  source_ref?: string | null;
  data_version?: string | number | null;
}

/**
 * Canonical CONTRACT & CONTRACT_LINE entities (01_conceptual_data_model.md §4C)
 */
export type ContractStatus = 'active' | 'amended' | 'terminated';
export type ContractConsiderationType = 'cash' | 'in_kind';

export interface SponsorContractLineRecord {
  contract_line_id: string;
  contract_id: string;
  asset_id?: string | null;
  consideration_type: ContractConsiderationType;
  value: number;
  price_id?: string | null;
  asset_name?: string | null;
}

export interface SponsorContractRecord {
  contract_id: string;
  opportunity_id: string;
  signed_at: string;
  signed_value_total: number;
  payment_terms?: string | null;
  signatory_contact_id?: string | null;
  document_uri?: string | null;
  status: ContractStatus;
  record_class: 'simulated' | 'live';
  // Optional server-joined display fields
  edition_id?: string | null;
  opportunity_name?: string | null;
  signatory_name?: string | null;
  lines?: SponsorContractLineRecord[];
}

export interface SponsorCampaignAssociation {
  campaign_id: string;
  campaign_name: string;
  channel_id?: string | null;
  channel_name?: string | null;
  bet_id?: string | null;
  status?: CampaignEntity['status'] | null;
  attribution_source:
    | 'outreach_attempt'
    | 'originating_opportunity'
    | 'both';
  attempt_count: number;
  opportunity_count: number;
}

export interface SponsorDirectoryFilters {
  search: string;
  record_class: SponsorRecordClass;
  edition_id: string;
  lifecycle_status: string;
  category_id: string;
  first_source: string;
  city: string;
}

export type SponsorSortKey =
  | 'display_name'
  | 'category_id'
  | 'lifecycle_status'
  | 'first_source'
  | 'city'
  | 'record_class';

/**
 * Frontend UI visibility and interaction context derived from GET /api/me.
 * NOTE: Client-side flags control UI rendering only; actual authorization,
 * row ownership checks, and GSTIN/PII redaction are server-side responsibilities.
 */
export interface UserPermissionContext {
  member_id: string | null;
  full_name: string | null;
  roles: CanonicalRole[];
  unrecognized_roles: string[];
  write_scope: 'all' | 'own' | 'none';
  can_write_sponsors: boolean;
  can_write_contacts: boolean;
  can_view_gstin: boolean;
  can_view_contact_pii: boolean;
  verified_by_server: boolean;
}
