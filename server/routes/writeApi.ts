import { Router, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getVerifiedActor, requireAuth, type AuthDependencies } from '../auth.ts';
import type { ServerConfig } from '../config.ts';
import type { DatabasePoolState } from '../db.ts';
import { AppApiError, asyncHandler } from '../errors.ts';
import {
  canConfirmOpportunity,
  evaluatePermission,
  requirePermission,
  type CanonicalRole,
} from '../permissions.ts';
import {
  ensureUiImportBatch,
  extractRequestedEditionAndClass,
  fetchAppDataVersion,
  generatePrefixedId,
  getCurrentSponsorOwnerId,
  getOpportunityOwnerId,
  insertAuditEvent,
  isSponsorOwner,
  rejectHistoricalWriteRequest,
  requireWriteRoles,
  resolveWritableEdition,
  resolveWritableEditionByClass,
  runWriteTransaction,
} from '../writeUtils.ts';

const SPONSOR_LIFECYCLE_VALUES = [
  'research_target',
  'prospect',
  'active',
  'past_sponsor',
  'do_not_contact',
] as const;

const SPONSOR_FIRST_SOURCE_VALUES = [
  'research',
  'referral',
  'inbound',
  'outreach',
  'renewal',
] as const;

const CONTACT_DECISION_ROLES = [
  'decision_maker',
  'influencer',
  'user',
  'unknown',
] as const;

const CONTACT_CONSENT_BASIS_VALUES = [
  'legitimate_interest',
  'inbound_consent',
  'referral_intro',
  'prior_sponsor',
  'public_directory',
  'unknown',
] as const;

const CAMPAIGN_STATUS_VALUES = ['planned', 'active', 'stopped', 'closed'] as const;

const OUTREACH_ROOT_EVENT_VALUES = [
  'outreach_sent',
  'introduction_received',
  'web_inbound',
] as const;

const INTERACTION_EVENT_VALUES = [
  'outreach_sent',
  'delivered',
  'replied',
  'meeting_booked',
  'meeting_held',
  'opt_out',
  'introduction_received',
  'web_inbound',
  'bounced',
  'meeting_cancelled',
  'follow_up_sent',
  'note',
] as const;

const INTERACTION_OUTCOME_VALUES = [
  'sent',
  'delivered',
  'positive',
  'neutral',
  'not_interested',
  'wrong_contact',
  'scheduled',
  'attended',
  'do_not_contact',
  'introduced',
  'interest_submitted',
  'no_response',
  'bounced',
  'cancelled',
  'completed',
  'other',
] as const;

const MEETING_STATUS_VALUES = ['booked', 'held', 'no_show', 'cancelled'] as const;
const MEETING_PURPOSE_VALUES = [
  'discovery',
  'renewal_screen',
  'title_pitch',
  'negotiation',
] as const;

const QUALIFICATION_STATUS_VALUES = [
  'unreviewed',
  'engaged',
  'qualified',
  'unqualified',
  'dormant',
] as const;

const OPPORTUNITY_SUPPORT_TYPES = ['cash', 'in_kind', 'mixed'] as const;
const OPPORTUNITY_STAGES = [
  'prospecting',
  'contacted',
  'proposal_sent',
  'negotiating',
  'partner_confirmed',
  'lost',
  'withdrawn',
] as const;

const DROP_REASON_VALUES = [
  'budget_mismatch',
  'timing_fit',
  'category_conflict',
  'terms_dispute',
  'no_response',
  'sla_breach_dropped',
  'sponsor_declined',
  'internal_withdrawn',
  'other',
] as const;

const LOSS_REASON_VALUES = [
  'terms_dispute',
  'budget_mismatch',
  'competitor_exclusivity',
  'timing_fit',
  'no_response',
  'category_conflict',
  'other',
] as const;

const PAYMENT_TERMS_VALUES = ['standard_50_50', '100_upfront', 'custom'] as const;
const TASK_TYPE_VALUES = [
  'follow_up',
  'proposal',
  'invoice',
  'call',
  'pitch',
  'admin',
] as const;
const TASK_STATUS_VALUES = [
  'open',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const;
const TASK_LINKED_TYPE_VALUES = [
  'sponsor',
  'opportunity',
  'invoice',
  'campaign',
  'referral',
] as const;

const PARTNER_TYPE_VALUES = [
  'creator',
  'vc_fund',
  'alumnus',
  'past_sponsor',
  'other',
] as const;
const PARTNER_STATUS_VALUES = ['invited', 'active', 'inactive'] as const;

const REFERRAL_STATUS_VALUES = [
  'speculative',
  'committed',
  'met',
  'declined',
  'lapsed',
] as const;

function asBodyObj(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw new AppApiError(400, 'INVALID_ARGUMENT', 'Request body must be a JSON object.');
  }
  return req.body as Record<string, unknown>;
}

function pick<T = unknown>(obj: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (key in obj && obj[key] !== undefined) {
      return obj[key] as T;
    }
  }
  return undefined;
}

function hasAnyKey(obj: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((k) => k in obj);
}

function normalizeConsentBasis(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  const aliases: Record<string, string> = {
    inbound_form: 'inbound_consent',
    warm_introduction: 'referral_intro',
    past_partnership: 'prior_sponsor',
    public_listing: 'public_directory',
    business_card: 'legitimate_interest',
    direct_consent: 'legitimate_interest',
  };
  return aliases[s] ?? s;
}

function normalizeDropReason(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  const aliases: Record<string, string> = {
    budget_frozen: 'budget_mismatch',
    timing_mismatch: 'timing_fit',
    category_exclusivity_conflict: 'category_conflict',
    sla_lapsed: 'sla_breach_dropped',
    sponsor_withdrew: 'sponsor_declined',
  };
  return aliases[s] ?? s;
}

function parseWithSchema<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown
): z.infer<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    throw new AppApiError(
      400,
      'VALIDATION_ERROR',
      `${path}${issue?.message || 'Invalid request payload.'}`
    );
  }
  return parsed.data;
}

function getDecision(req: Request): {
  roles: CanonicalRole[];
  scope: 'all' | 'own' | 'none';
  memberId: string;
} {
  return {
    roles: req.resolvedMember?.roles ?? [],
    scope: req.permissionDecision?.scope ?? 'none',
    memberId: req.actor?.memberId ?? '',
  };
}

async function assertLinkedRecordExists(
  client: PoolClient,
  linkedType: string,
  linkedId: string
): Promise<void> {
  const tableMap: Record<string, { table: string; pk: string }> = {
    sponsor: { table: 'sponsor', pk: 'sponsor_id' },
    opportunity: { table: 'opportunity', pk: 'opportunity_id' },
    invoice: { table: 'invoice', pk: 'invoice_id' },
    campaign: { table: 'campaign', pk: 'campaign_id' },
    referral: { table: 'referral', pk: 'referral_id' },
  };
  const target = tableMap[linkedType];
  if (!target) {
    throw new AppApiError(422, 'INVALID_LINK', `Unsupported linked_type "${linkedType}".`);
  }
  const res = await client.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM public.${target.table} WHERE ${target.pk} = $1 AND NOT is_deleted
     ) AS ok`,
    [linkedId]
  );
  if (!res.rows[0]?.ok) {
    throw new AppApiError(
      422,
      'LINKED_RECORD_NOT_FOUND',
      `Linked ${linkedType} "${linkedId}" does not exist.`
    );
  }
}

export function createWriteApiRouter(
  config: ServerConfig,
  dbState: DatabasePoolState,
  authDeps: AuthDependencies
): Router {
  const router = Router();
  const authMiddleware = requireAuth(authDeps);
  const roleMiddleware = requireWriteRoles(authDeps);

  // ---------------------------------------------------------------------------
  // 1. POST /api/sponsors & PATCH /api/sponsors/:id
  // ---------------------------------------------------------------------------
  const CreateSponsorSchema = z.object({
    displayName: z.string().trim().min(1).max(200),
    legalName: z.string().trim().max(240).nullable().optional(),
    categoryId: z.string().trim().min(1).nullable().optional(),
    lifecycleStatus: z.enum(SPONSOR_LIFECYCLE_VALUES),
    firstSource: z.enum(SPONSOR_FIRST_SOURCE_VALUES).nullable().optional(),
    gstin: z.string().trim().max(32).nullable().optional(),
    website: z.string().trim().max(300).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    editionId: z.string().trim().min(1).optional(),
    recordClass: z.enum(['live', 'simulated']).optional(),
    ownerMemberId: z.string().trim().min(1).nullable().optional(),
  });

  router.post(
    '/sponsors',
    authMiddleware,
    roleMiddleware,
    requirePermission('sponsors_contacts_research', 'create'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const { editionId, requestedRecordClass } = extractRequestedEditionAndClass(
        req,
        config.editionIdDefault
      );
      rejectHistoricalWriteRequest(editionId, requestedRecordClass);

      const input = parseWithSchema(CreateSponsorSchema, {
        displayName: pick(raw, 'displayName', 'display_name'),
        legalName: pick(raw, 'legalName', 'legal_name') ?? null,
        categoryId: pick(raw, 'categoryId', 'category_id') ?? null,
        lifecycleStatus: pick(raw, 'lifecycleStatus', 'lifecycle_status'),
        firstSource: pick(raw, 'firstSource', 'first_source') ?? null,
        gstin: pick(raw, 'gstin') ?? null,
        website: pick(raw, 'website') ?? null,
        city: pick(raw, 'city') ?? null,
        editionId,
        recordClass: requestedRecordClass ?? undefined,
        ownerMemberId: pick(raw, 'ownerMemberId', 'owner_member_id') ?? null,
      });

      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      if (
        scope === 'own' &&
        input.ownerMemberId &&
        input.ownerMemberId !== actor.memberId
      ) {
        throw new AppApiError(
          403,
          'FORBIDDEN',
          'Sales roles can only assign ownership to themselves.'
        );
      }

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const edition = await resolveWritableEdition(
          client,
          input.editionId ?? editionId,
          input.recordClass ?? null
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const sponsorId = generatePrefixedId('SP-');
        const spRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.sponsor (
             sponsor_id, display_name, legal_name, category_id,
             lifecycle_status, first_source, gstin, website, city,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4,
             $5, $6, $7, $8, $9,
             $10, $11, 'ui:sponsors', 'T', $12
           )
           RETURNING *`,
          [
            sponsorId,
            input.displayName,
            input.legalName ?? null,
            input.categoryId ?? null,
            input.lifecycleStatus,
            input.firstSource ?? null,
            input.gstin ?? null,
            input.website ?? null,
            input.city ?? null,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        const ownerId =
          scope === 'own' ? actor.memberId : input.ownerMemberId ?? actor.memberId;
        if (ownerId) {
          const assignmentId = generatePrefixedId('OA-');
          await client.query(
            `INSERT INTO public.ownership_assignment (
               assignment_id, subject_type, subject_id, member_id,
               role_in_relationship, reason, version_no,
               record_class, import_batch_id, source_ref, evidence_class, created_by
             ) VALUES (
               $1, 'sponsor', $2, $3,
               'owner', 'Initial sponsor creation', 1,
               $4, $5, 'ui:sponsors', 'T', $6
             )`,
            [
              assignmentId,
              sponsorId,
              ownerId,
              edition.recordClass,
              batchId,
              actor.memberId,
            ]
          );
        }

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'SPONSOR',
          entityId: sponsorId,
          operation: 'insert',
          after: spRes.rows[0] ?? { sponsor_id: sponsorId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:sponsors',
        });

        return {
          id: sponsorId,
          dataVersion,
          data_version: dataVersion,
          sponsor: spRes.rows[0],
        };
      });

      res.status(201).json(result);
    })
  );

  const UpdateSponsorSchema = z.object({
    displayName: z.string().trim().min(1).max(200).optional(),
    legalName: z.string().trim().max(240).nullable().optional(),
    categoryId: z.string().trim().min(1).nullable().optional(),
    lifecycleStatus: z.enum(SPONSOR_LIFECYCLE_VALUES).optional(),
    firstSource: z.enum(SPONSOR_FIRST_SOURCE_VALUES).nullable().optional(),
    gstin: z.string().trim().max(32).nullable().optional(),
    website: z.string().trim().max(300).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    isDeleted: z.literal(true).optional(),
  });

  router.patch(
    '/sponsors/:id',
    authMiddleware,
    roleMiddleware,
    requirePermission('sponsors_contacts_research', 'update'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const sponsorId = req.params.id;
      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const input = parseWithSchema(UpdateSponsorSchema, {
        displayName: pick(raw, 'displayName', 'display_name'),
        legalName: hasAnyKey(raw, 'legalName', 'legal_name')
          ? pick(raw, 'legalName', 'legal_name') ?? null
          : undefined,
        categoryId: hasAnyKey(raw, 'categoryId', 'category_id')
          ? pick(raw, 'categoryId', 'category_id') ?? null
          : undefined,
        lifecycleStatus: pick(raw, 'lifecycleStatus', 'lifecycle_status'),
        firstSource: hasAnyKey(raw, 'firstSource', 'first_source')
          ? pick(raw, 'firstSource', 'first_source') ?? null
          : undefined,
        gstin: hasAnyKey(raw, 'gstin') ? pick(raw, 'gstin') ?? null : undefined,
        website: hasAnyKey(raw, 'website') ? pick(raw, 'website') ?? null : undefined,
        city: hasAnyKey(raw, 'city') ? pick(raw, 'city') ?? null : undefined,
        isDeleted: pick(raw, 'isDeleted', 'is_deleted'),
      });

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const curRes = await client.query<{
          sponsor_id: string;
          record_class: string;
        }>(
          `SELECT sponsor_id, record_class
             FROM public.sponsor
            WHERE sponsor_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [sponsorId]
        );
        const existing = curRes.rows[0];
        if (!existing) {
          throw new AppApiError(404, 'SPONSOR_NOT_FOUND', `Sponsor ${sponsorId} not found.`);
        }
        rejectHistoricalWriteRequest(null, existing.record_class);
        if (existing.record_class !== 'live' && existing.record_class !== 'simulated') {
          throw new AppApiError(403, 'READ_ONLY_RECORD', 'This sponsor record is read-only.');
        }

        if (scope === 'own') {
          const owns = await isSponsorOwner(
            client,
            sponsorId,
            actor.memberId,
            existing.record_class
          );
          if (!owns) {
            throw new AppApiError(
              403,
              'FORBIDDEN',
              'You can only edit sponsors owned by you.'
            );
          }
        }

        const edition = await resolveWritableEditionByClass(
          client,
          existing.record_class,
          config.editionIdDefault
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const sets: string[] = [];
        const params: unknown[] = [];
        const addSet = (col: string, val: unknown) => {
          params.push(val);
          sets.push(`${col} = $${params.length}`);
        };

        if (input.displayName !== undefined) addSet('display_name', input.displayName);
        if (input.legalName !== undefined) addSet('legal_name', input.legalName);
        if (input.categoryId !== undefined) addSet('category_id', input.categoryId);
        if (input.lifecycleStatus !== undefined)
          addSet('lifecycle_status', input.lifecycleStatus);
        if (input.firstSource !== undefined) addSet('first_source', input.firstSource);
        if (input.gstin !== undefined) addSet('gstin', input.gstin);
        if (input.website !== undefined) addSet('website', input.website);
        if (input.city !== undefined) addSet('city', input.city);
        if (input.isDeleted === true) addSet('is_deleted', true);

        if (sets.length === 0) {
          throw new AppApiError(400, 'INVALID_ARGUMENT', 'No updatable fields provided.');
        }

        params.push(sponsorId);
        const updRes = await client.query<Record<string, unknown>>(
          `UPDATE public.sponsor
              SET ${sets.join(', ')}
            WHERE sponsor_id = $${params.length}
              AND NOT is_deleted
            RETURNING *`,
          params
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'SPONSOR',
          entityId: sponsorId,
          operation: input.isDeleted === true ? 'delete' : 'update',
          after: updRes.rows[0] ?? { sponsor_id: sponsorId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:sponsors',
        });

        return {
          id: sponsorId,
          dataVersion,
          data_version: dataVersion,
          sponsor: updRes.rows[0],
        };
      });

      res.status(200).json(result);
    })
  );

  // ---------------------------------------------------------------------------
  // 2. POST /api/contacts & PATCH /api/contacts/:id
  // ---------------------------------------------------------------------------
  const CreateContactSchema = z.object({
    sponsorId: z.string().trim().min(1),
    fullName: z.string().trim().min(1).max(200),
    jobTitle: z.string().trim().max(160).nullable().optional(),
    decisionRole: z.enum(CONTACT_DECISION_ROLES).default('unknown'),
    email: z.string().trim().email().max(240).nullable().optional(),
    phone: z.string().trim().max(64).nullable().optional(),
    consentBasis: z.enum(CONTACT_CONSENT_BASIS_VALUES).nullable().optional(),
    optedOutAt: z.string().trim().nullable().optional(),
  });

  router.post(
    '/contacts',
    authMiddleware,
    roleMiddleware,
    requirePermission('sponsors_contacts_research', 'create'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const rawEmail = pick(raw, 'email');
      const input = parseWithSchema(CreateContactSchema, {
        sponsorId: pick(raw, 'sponsorId', 'sponsor_id'),
        fullName: pick(raw, 'fullName', 'full_name'),
        jobTitle: pick(raw, 'jobTitle', 'job_title') || null,
        decisionRole: pick(raw, 'decisionRole', 'decision_role') ?? 'unknown',
        email: rawEmail === '' || rawEmail == null ? null : rawEmail,
        phone: pick(raw, 'phone') || null,
        consentBasis: normalizeConsentBasis(
          pick(raw, 'consentBasis', 'consent_basis')
        ),
        optedOutAt: pick(raw, 'optedOutAt', 'opted_out_at') ?? null,
      });

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const spRes = await client.query<{ record_class: string }>(
          `SELECT record_class FROM public.sponsor WHERE sponsor_id = $1 AND NOT is_deleted LIMIT 1`,
          [input.sponsorId]
        );
        const sp = spRes.rows[0];
        if (!sp) {
          throw new AppApiError(404, 'SPONSOR_NOT_FOUND', `Sponsor ${input.sponsorId} not found.`);
        }
        rejectHistoricalWriteRequest(null, sp.record_class);
        if (sp.record_class !== 'live' && sp.record_class !== 'simulated') {
          throw new AppApiError(403, 'READ_ONLY_RECORD', 'Parent sponsor is read-only.');
        }

        if (scope === 'own') {
          const owns = await isSponsorOwner(
            client,
            input.sponsorId,
            actor.memberId,
            sp.record_class
          );
          if (!owns) {
            throw new AppApiError(
              403,
              'FORBIDDEN',
              'You can only add contacts to sponsors owned by you.'
            );
          }
        }

        const edition = await resolveWritableEditionByClass(
          client,
          sp.record_class,
          config.editionIdDefault
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const contactId = generatePrefixedId('CT-');
        const cRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.contact (
             contact_id, sponsor_id, full_name, job_title, decision_role,
             email, phone, consent_basis, opted_out_at,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7, $8, $9::timestamptz,
             $10, $11, 'ui:contacts', 'T', $12
           )
           RETURNING *`,
          [
            contactId,
            input.sponsorId,
            input.fullName,
            input.jobTitle ?? null,
            input.decisionRole,
            input.email ?? null,
            input.phone ?? null,
            input.consentBasis ?? null,
            input.optedOutAt ?? null,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'CONTACT',
          entityId: contactId,
          operation: 'insert',
          after: cRes.rows[0] ?? { contact_id: contactId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:contacts',
        });

        return {
          id: contactId,
          dataVersion,
          data_version: dataVersion,
          contact: cRes.rows[0],
        };
      });

      res.status(201).json(result);
    })
  );

  const UpdateContactSchema = z.object({
    fullName: z.string().trim().min(1).max(200).optional(),
    jobTitle: z.string().trim().max(160).nullable().optional(),
    decisionRole: z.enum(CONTACT_DECISION_ROLES).optional(),
    email: z.string().trim().email().max(240).nullable().optional(),
    phone: z.string().trim().max(64).nullable().optional(),
    consentBasis: z.enum(CONTACT_CONSENT_BASIS_VALUES).nullable().optional(),
    optOut: z.boolean().optional(),
    optedOutAt: z.string().trim().nullable().optional(),
    isDeleted: z.literal(true).optional(),
  });

  router.patch(
    '/contacts/:id',
    authMiddleware,
    roleMiddleware,
    requirePermission('sponsors_contacts_research', 'update'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const contactId = req.params.id;
      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const rawEmail = pick(raw, 'email');
      const input = parseWithSchema(UpdateContactSchema, {
        fullName: pick(raw, 'fullName', 'full_name'),
        jobTitle: hasAnyKey(raw, 'jobTitle', 'job_title')
          ? pick(raw, 'jobTitle', 'job_title') || null
          : undefined,
        decisionRole: pick(raw, 'decisionRole', 'decision_role'),
        email: hasAnyKey(raw, 'email')
          ? rawEmail === '' || rawEmail == null
            ? null
            : rawEmail
          : undefined,
        phone: hasAnyKey(raw, 'phone') ? pick(raw, 'phone') || null : undefined,
        consentBasis: hasAnyKey(raw, 'consentBasis', 'consent_basis')
          ? normalizeConsentBasis(pick(raw, 'consentBasis', 'consent_basis'))
          : undefined,
        optOut: pick(raw, 'optOut', 'opt_out'),
        optedOutAt: hasAnyKey(raw, 'optedOutAt', 'opted_out_at')
          ? pick(raw, 'optedOutAt', 'opted_out_at') ?? null
          : undefined,
        isDeleted: pick(raw, 'isDeleted', 'is_deleted'),
      });

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const curRes = await client.query<{
          contact_id: string;
          sponsor_id: string;
          record_class: string;
        }>(
          `SELECT contact_id, sponsor_id, record_class
             FROM public.contact
            WHERE contact_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [contactId]
        );
        const existing = curRes.rows[0];
        if (!existing) {
          throw new AppApiError(404, 'CONTACT_NOT_FOUND', `Contact ${contactId} not found.`);
        }
        rejectHistoricalWriteRequest(null, existing.record_class);

        if (scope === 'own') {
          const owns = await isSponsorOwner(
            client,
            existing.sponsor_id,
            actor.memberId,
            existing.record_class
          );
          if (!owns) {
            throw new AppApiError(
              403,
              'FORBIDDEN',
              'You can only edit contacts for sponsors owned by you.'
            );
          }
        }

        const edition = await resolveWritableEditionByClass(
          client,
          existing.record_class,
          config.editionIdDefault
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const sets: string[] = [];
        const params: unknown[] = [];
        const addSet = (col: string, val: unknown, cast = '') => {
          params.push(val);
          sets.push(`${col} = $${params.length}${cast}`);
        };

        if (input.fullName !== undefined) addSet('full_name', input.fullName);
        if (input.jobTitle !== undefined) addSet('job_title', input.jobTitle);
        if (input.decisionRole !== undefined) addSet('decision_role', input.decisionRole);
        if (input.email !== undefined) addSet('email', input.email);
        if (input.phone !== undefined) addSet('phone', input.phone);
        if (input.consentBasis !== undefined) addSet('consent_basis', input.consentBasis);
        if (input.optOut === true) {
          sets.push(`opted_out_at = COALESCE(opted_out_at, now())`);
        } else if (input.optedOutAt !== undefined) {
          addSet('opted_out_at', input.optedOutAt, '::timestamptz');
        }
        if (input.isDeleted === true) addSet('is_deleted', true);

        if (sets.length === 0) {
          throw new AppApiError(400, 'INVALID_ARGUMENT', 'No updatable fields provided.');
        }

        params.push(contactId);
        const updRes = await client.query<Record<string, unknown>>(
          `UPDATE public.contact
              SET ${sets.join(', ')}
            WHERE contact_id = $${params.length}
              AND NOT is_deleted
            RETURNING *`,
          params
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'CONTACT',
          entityId: contactId,
          operation: input.isDeleted === true ? 'delete' : 'update',
          after: updRes.rows[0] ?? { contact_id: contactId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:contacts',
        });

        return {
          id: contactId,
          dataVersion,
          data_version: dataVersion,
          contact: updRes.rows[0],
        };
      });

      res.status(200).json(result);
    })
  );

  // ---------------------------------------------------------------------------
  // 3. POST /api/ownership
  // ---------------------------------------------------------------------------
  const OwnershipSchema = z.object({
    subjectType: z.enum(['sponsor', 'opportunity', 'network_partner']),
    subjectId: z.string().trim().min(1),
    memberId: z.string().trim().min(1),
    reason: z.string().trim().max(300).nullable().optional(),
    roleInRelationship: z.enum(['owner', 'support']).default('owner'),
  });

  router.post(
    '/ownership',
    authMiddleware,
    roleMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const actor = getVerifiedActor(req);
      const roles = req.resolvedMember?.roles ?? [];

      const input = parseWithSchema(OwnershipSchema, {
        subjectType: pick(raw, 'subjectType', 'subject_type'),
        subjectId: pick(raw, 'subjectId', 'subject_id'),
        memberId: pick(raw, 'memberId', 'member_id'),
        reason: pick(raw, 'reason') ?? null,
        roleInRelationship:
          pick(raw, 'roleInRelationship', 'role_in_relationship') ?? 'owner',
      });

      const domain =
        input.subjectType === 'sponsor'
          ? 'sponsors_contacts_research'
          : input.subjectType === 'opportunity'
            ? 'opportunities_stage'
            : 'outreach_interactions_meetings_qualifications';
      const perm = evaluatePermission(roles, domain, 'update');
      if (!perm.allowed) {
        throw new AppApiError(
          403,
          'FORBIDDEN',
          `Your assigned role does not permit ownership reassignment on ${input.subjectType}.`
        );
      }

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const tableMeta =
          input.subjectType === 'sponsor'
            ? { table: 'sponsor', pk: 'sponsor_id' }
            : input.subjectType === 'opportunity'
              ? { table: 'opportunity', pk: 'opportunity_id' }
              : { table: 'network_partner', pk: 'partner_id' };

        const subRes = await client.query<{ record_class: string }>(
          `SELECT record_class FROM public.${tableMeta.table} WHERE ${tableMeta.pk} = $1 AND NOT is_deleted LIMIT 1`,
          [input.subjectId]
        );
        const subject = subRes.rows[0];
        if (!subject) {
          throw new AppApiError(
            404,
            'NOT_FOUND',
            `${input.subjectType} ${input.subjectId} not found.`
          );
        }
        rejectHistoricalWriteRequest(null, subject.record_class);
        if (subject.record_class !== 'live' && subject.record_class !== 'simulated') {
          throw new AppApiError(403, 'READ_ONLY_RECORD', 'Subject record is read-only.');
        }

        if (perm.scope === 'own') {
          let currentOwner: string | null = null;
          if (input.subjectType === 'sponsor') {
            currentOwner = await getCurrentSponsorOwnerId(
              client,
              input.subjectId,
              subject.record_class
            );
          } else if (input.subjectType === 'opportunity') {
            currentOwner = await getOpportunityOwnerId(client, input.subjectId);
          } else {
            const npRes = await client.query<{ owner_member_id: string | null }>(
              `SELECT owner_member_id FROM public.network_partner WHERE partner_id = $1 LIMIT 1`,
              [input.subjectId]
            );
            currentOwner = npRes.rows[0]?.owner_member_id ?? null;
          }
          if (currentOwner !== actor.memberId) {
            throw new AppApiError(
              403,
              'FORBIDDEN',
              'You can only reassign ownership for records you currently own.'
            );
          }
        }

        const edition = await resolveWritableEditionByClass(
          client,
          subject.record_class,
          config.editionIdDefault
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        let nextVersion = 1;
        let prevAssignmentId: string | null = null;
        if (input.roleInRelationship === 'owner') {
          const prevRes = await client.query<{
            assignment_id: string;
            version_no: number;
          }>(
            `UPDATE public.ownership_assignment
                SET valid_to = now()
              WHERE subject_type = $1
                AND subject_id = $2
                AND record_class = $3
                AND role_in_relationship = 'owner'
                AND valid_to IS NULL
                AND NOT is_deleted
              RETURNING assignment_id, version_no`,
            [input.subjectType, input.subjectId, edition.recordClass]
          );
          if (prevRes.rows[0]) {
            prevAssignmentId = prevRes.rows[0].assignment_id;
            nextVersion = Number(prevRes.rows[0].version_no ?? 1) + 1;
          }
        }

        const assignmentId = generatePrefixedId('OA-');
        const insRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.ownership_assignment (
             assignment_id, subject_type, subject_id, member_id,
             role_in_relationship, reason, version_no,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4,
             $5, $6, $7,
             $8, $9, 'ui:ownership', 'T', $10
           )
           RETURNING *`,
          [
            assignmentId,
            input.subjectType,
            input.subjectId,
            input.memberId,
            input.roleInRelationship,
            input.reason ?? null,
            nextVersion,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        if (prevAssignmentId) {
          await client.query(
            `UPDATE public.ownership_assignment
                SET superseded_by = $1
              WHERE assignment_id = $2`,
            [assignmentId, prevAssignmentId]
          );
        }

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'OWNERSHIP_ASSIGNMENT',
          entityId: assignmentId,
          operation: 'insert',
          after: insRes.rows[0] ?? { assignment_id: assignmentId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:ownership',
        });

        return {
          id: assignmentId,
          dataVersion,
          data_version: dataVersion,
          assignment: insRes.rows[0],
        };
      });

      res.status(201).json(result);
    })
  );

  // ---------------------------------------------------------------------------
  // 4. POST /api/campaigns & PATCH /api/campaigns/:id
  // ---------------------------------------------------------------------------
  const CreateCampaignSchema = z.object({
    editionId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(200),
    channelId: z.string().trim().min(1),
    betId: z.string().trim().min(1).nullable().optional(),
    ownerMemberId: z.string().trim().min(1).nullable().optional(),
    plannedStart: z.string().trim().nullable().optional(),
    plannedEnd: z.string().trim().nullable().optional(),
    objective: z.string().trim().max(1000).nullable().optional(),
    status: z.enum(CAMPAIGN_STATUS_VALUES).default('planned'),
  });

  function rejectCampaignHoursFields(raw: Record<string, unknown>): void {
    if (
      hasAnyKey(
        raw,
        'planned_hours',
        'plannedHours',
        'planned_person_weeks',
        'plannedPersonWeeks'
      )
    ) {
      throw new AppApiError(
        400,
        'INVALID_ARGUMENT',
        'Campaign records never store planned hours or person-weeks; log hours via POST /api/time-logs.'
      );
    }
  }

  router.post(
    '/campaigns',
    authMiddleware,
    roleMiddleware,
    requirePermission('outreach_interactions_meetings_qualifications', 'create'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      rejectCampaignHoursFields(raw);

      const { editionId, requestedRecordClass } = extractRequestedEditionAndClass(
        req,
        config.editionIdDefault
      );
      rejectHistoricalWriteRequest(editionId, requestedRecordClass);

      const input = parseWithSchema(CreateCampaignSchema, {
        editionId,
        name: pick(raw, 'name'),
        channelId: pick(raw, 'channelId', 'channel_id'),
        betId: pick(raw, 'betId', 'bet_id') || null,
        ownerMemberId: pick(raw, 'ownerMemberId', 'owner_member_id') || null,
        plannedStart: pick(raw, 'plannedStart', 'planned_start') || null,
        plannedEnd: pick(raw, 'plannedEnd', 'planned_end') || null,
        objective: pick(raw, 'objective') || null,
        status: pick(raw, 'status') ?? 'planned',
      });

      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      if (
        scope === 'own' &&
        input.ownerMemberId &&
        input.ownerMemberId !== actor.memberId
      ) {
        throw new AppApiError(
          403,
          'FORBIDDEN',
          'Sales roles can only create campaigns owned by themselves.'
        );
      }

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const edition = await resolveWritableEdition(
          client,
          input.editionId,
          requestedRecordClass
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const campaignId = generatePrefixedId('CA-');
        const ownerId = scope === 'own' ? actor.memberId : input.ownerMemberId ?? actor.memberId;

        const cRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.campaign (
             campaign_id, edition_id, name, channel_id, bet_id, owner_member_id,
             planned_start, planned_end, objective, status,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4, $5, $6,
             $7::timestamptz, $8::timestamptz, $9, $10,
             $11, $12, 'ui:campaigns', 'T', $13
           )
           RETURNING *`,
          [
            campaignId,
            edition.editionId,
            input.name,
            input.channelId,
            input.betId ?? null,
            ownerId,
            input.plannedStart ?? null,
            input.plannedEnd ?? null,
            input.objective ?? null,
            input.status,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'CAMPAIGN',
          entityId: campaignId,
          operation: 'insert',
          after: cRes.rows[0] ?? { campaign_id: campaignId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:campaigns',
        });

        return {
          id: campaignId,
          dataVersion,
          data_version: dataVersion,
          campaign: cRes.rows[0],
        };
      });

      res.status(201).json(result);
    })
  );

  const UpdateCampaignSchema = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    channelId: z.string().trim().min(1).optional(),
    betId: z.string().trim().min(1).nullable().optional(),
    ownerMemberId: z.string().trim().min(1).nullable().optional(),
    plannedStart: z.string().trim().nullable().optional(),
    plannedEnd: z.string().trim().nullable().optional(),
    objective: z.string().trim().max(1000).nullable().optional(),
    status: z.enum(CAMPAIGN_STATUS_VALUES).optional(),
    isDeleted: z.literal(true).optional(),
  });

  router.patch(
    '/campaigns/:id',
    authMiddleware,
    roleMiddleware,
    requirePermission('outreach_interactions_meetings_qualifications', 'update'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      rejectCampaignHoursFields(raw);

      const campaignId = req.params.id;
      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const input = parseWithSchema(UpdateCampaignSchema, {
        name: pick(raw, 'name'),
        channelId: pick(raw, 'channelId', 'channel_id'),
        betId: hasAnyKey(raw, 'betId', 'bet_id')
          ? pick(raw, 'betId', 'bet_id') || null
          : undefined,
        ownerMemberId: hasAnyKey(raw, 'ownerMemberId', 'owner_member_id')
          ? pick(raw, 'ownerMemberId', 'owner_member_id') || null
          : undefined,
        plannedStart: hasAnyKey(raw, 'plannedStart', 'planned_start')
          ? pick(raw, 'plannedStart', 'planned_start') || null
          : undefined,
        plannedEnd: hasAnyKey(raw, 'plannedEnd', 'planned_end')
          ? pick(raw, 'plannedEnd', 'planned_end') || null
          : undefined,
        objective: hasAnyKey(raw, 'objective')
          ? pick(raw, 'objective') || null
          : undefined,
        status: pick(raw, 'status'),
        isDeleted: pick(raw, 'isDeleted', 'is_deleted'),
      });

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const curRes = await client.query<{
          campaign_id: string;
          edition_id: string;
          record_class: string;
          owner_member_id: string | null;
        }>(
          `SELECT campaign_id, edition_id, record_class, owner_member_id
             FROM public.campaign
            WHERE campaign_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [campaignId]
        );
        const existing = curRes.rows[0];
        if (!existing) {
          throw new AppApiError(404, 'CAMPAIGN_NOT_FOUND', `Campaign ${campaignId} not found.`);
        }
        rejectHistoricalWriteRequest(existing.edition_id, existing.record_class);

        if (scope === 'own' && existing.owner_member_id !== actor.memberId) {
          throw new AppApiError(
            403,
            'FORBIDDEN',
            'You can only update campaigns owned by you.'
          );
        }

        const edition = await resolveWritableEdition(client, existing.edition_id);
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const sets: string[] = [];
        const params: unknown[] = [];
        const addSet = (col: string, val: unknown, cast = '') => {
          params.push(val);
          sets.push(`${col} = $${params.length}${cast}`);
        };

        if (input.name !== undefined) addSet('name', input.name);
        if (input.channelId !== undefined) addSet('channel_id', input.channelId);
        if (input.betId !== undefined) addSet('bet_id', input.betId);
        if (input.ownerMemberId !== undefined)
          addSet('owner_member_id', input.ownerMemberId);
        if (input.plannedStart !== undefined)
          addSet('planned_start', input.plannedStart, '::timestamptz');
        if (input.plannedEnd !== undefined)
          addSet('planned_end', input.plannedEnd, '::timestamptz');
        if (input.objective !== undefined) addSet('objective', input.objective);
        if (input.status !== undefined) addSet('status', input.status);
        if (input.isDeleted === true) addSet('is_deleted', true);

        if (sets.length === 0) {
          throw new AppApiError(400, 'INVALID_ARGUMENT', 'No updatable fields provided.');
        }

        params.push(campaignId);
        const updRes = await client.query<Record<string, unknown>>(
          `UPDATE public.campaign
              SET ${sets.join(', ')}
            WHERE campaign_id = $${params.length}
              AND NOT is_deleted
            RETURNING *`,
          params
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'CAMPAIGN',
          entityId: campaignId,
          operation: input.isDeleted === true ? 'delete' : 'update',
          after: updRes.rows[0] ?? { campaign_id: campaignId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:campaigns',
        });

        return {
          id: campaignId,
          dataVersion,
          data_version: dataVersion,
          campaign: updRes.rows[0],
        };
      });

      res.status(200).json(result);
    })
  );

  // ---------------------------------------------------------------------------
  // 5. POST /api/outreach & POST /api/interactions
  // ---------------------------------------------------------------------------
  const CreateOutreachSchema = z.object({
    campaignId: z.string().trim().min(1),
    sponsorId: z.string().trim().min(1),
    contactId: z.string().trim().min(1).nullable().optional(),
    referralId: z.string().trim().min(1).nullable().optional(),
    rootEventType: z.enum(OUTREACH_ROOT_EVENT_VALUES),
    startedAt: z.string().trim().min(1).optional(),
    summary: z.string().trim().max(1000).nullable().optional(),
    outcome: z.enum(INTERACTION_OUTCOME_VALUES).nullable().optional(),
  });

  router.post(
    '/outreach',
    authMiddleware,
    roleMiddleware,
    requirePermission('outreach_interactions_meetings_qualifications', 'create'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const input = parseWithSchema(CreateOutreachSchema, {
        campaignId: pick(raw, 'campaignId', 'campaign_id'),
        sponsorId: pick(raw, 'sponsorId', 'sponsor_id'),
        contactId: pick(raw, 'contactId', 'contact_id') || null,
        referralId: pick(raw, 'referralId', 'referral_id') || null,
        rootEventType: pick(raw, 'rootEventType', 'root_event_type'),
        startedAt: pick(raw, 'startedAt', 'started_at'),
        summary: pick(raw, 'summary') || null,
        outcome: pick(raw, 'outcome') || null,
      });

      const startedAtIso = input.startedAt ?? new Date().toISOString();

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const camRes = await client.query<{
          campaign_id: string;
          edition_id: string;
          record_class: string;
        }>(
          `SELECT campaign_id, edition_id, record_class
             FROM public.campaign
            WHERE campaign_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [input.campaignId]
        );
        const cam = camRes.rows[0];
        if (!cam) {
          throw new AppApiError(404, 'CAMPAIGN_NOT_FOUND', `Campaign ${input.campaignId} not found.`);
        }
        const edition = await resolveWritableEdition(client, cam.edition_id);

        const spRes = await client.query<{
          sponsor_id: string;
          lifecycle_status: string | null;
          record_class: string;
        }>(
          `SELECT sponsor_id, lifecycle_status, record_class
             FROM public.sponsor
            WHERE sponsor_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [input.sponsorId]
        );
        const sp = spRes.rows[0];
        if (!sp) {
          throw new AppApiError(404, 'SPONSOR_NOT_FOUND', `Sponsor ${input.sponsorId} not found.`);
        }
        if (sp.record_class !== edition.recordClass) {
          throw new AppApiError(
            422,
            'RECORD_CLASS_MISMATCH',
            `Sponsor ${input.sponsorId} (${sp.record_class}) does not match campaign edition (${edition.recordClass}).`
          );
        }

        if (scope === 'own') {
          const owns = await isSponsorOwner(
            client,
            input.sponsorId,
            actor.memberId,
            edition.recordClass
          );
          if (!owns) {
            throw new AppApiError(
              403,
              'FORBIDDEN',
              'You can only log outreach for sponsors owned by you.'
            );
          }
        }

        if (sp.lifecycle_status === 'do_not_contact') {
          throw new AppApiError(
            422,
            'OUTREACH_BLOCKED',
            `Outreach blocked: sponsor ${input.sponsorId} is marked do_not_contact.`
          );
        }

        if (input.contactId) {
          const ctRes = await client.query<{
            contact_id: string;
            sponsor_id: string;
            opted_out_at: string | null;
          }>(
            `SELECT contact_id, sponsor_id, opted_out_at
               FROM public.contact
              WHERE contact_id = $1
                AND NOT is_deleted
              LIMIT 1`,
            [input.contactId]
          );
          const ct = ctRes.rows[0];
          if (!ct || ct.sponsor_id !== input.sponsorId) {
            throw new AppApiError(
              422,
              'INVALID_CONTACT',
              `Contact ${input.contactId} does not belong to sponsor ${input.sponsorId}.`
            );
          }
          if (ct.opted_out_at) {
            throw new AppApiError(
              422,
              'OUTREACH_BLOCKED',
              `Outreach blocked: contact ${input.contactId} opted out at ${ct.opted_out_at}.`
            );
          }
        }

        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const attemptId = generatePrefixedId('AT-');
        const attRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.outreach_attempt (
             attempt_id, campaign_id, sponsor_id, contact_id, referral_id,
             owner_member_id, started_at, root_event_type,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7::timestamptz, $8,
             $9, $10, 'ui:outreach', 'T', $6
           )
           RETURNING *`,
          [
            attemptId,
            input.campaignId,
            input.sponsorId,
            input.contactId ?? null,
            input.referralId ?? null,
            actor.memberId,
            startedAtIso,
            input.rootEventType,
            edition.recordClass,
            batchId,
          ]
        );

        const interactionId = generatePrefixedId('IN-');
        const defaultOutcome =
          input.outcome ??
          (input.rootEventType === 'outreach_sent'
            ? 'sent'
            : input.rootEventType === 'introduction_received'
              ? 'introduced'
              : 'interest_submitted');

        const intRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.interaction (
             interaction_id, attempt_id, event_type, outcome, occurred_at,
             summary, logged_by,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4, $5::timestamptz,
             $6, $7,
             $8, $9, 'ui:outreach', 'T', $7
           )
           RETURNING *`,
          [
            interactionId,
            attemptId,
            input.rootEventType,
            defaultOutcome,
            startedAtIso,
            input.summary ?? null,
            actor.memberId,
            edition.recordClass,
            batchId,
          ]
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'OUTREACH_ATTEMPT',
          entityId: attemptId,
          operation: 'insert',
          after: {
            outreach_attempt: attRes.rows[0],
            root_interaction: intRes.rows[0],
          },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:outreach',
        });

        return {
          id: attemptId,
          interactionId,
          dataVersion,
          data_version: dataVersion,
          outreach: attRes.rows[0],
          interaction: intRes.rows[0],
        };
      });

      res.status(201).json(result);
    })
  );

  const CreateInteractionSchema = z.object({
    attemptId: z.string().trim().min(1),
    originInteractionId: z.string().trim().min(1).nullable().optional(),
    eventType: z.enum(INTERACTION_EVENT_VALUES),
    outcome: z.enum(INTERACTION_OUTCOME_VALUES).nullable().optional(),
    occurredAt: z.string().trim().min(1).optional(),
    summary: z.string().trim().max(1000).nullable().optional(),
  });

  router.post(
    '/interactions',
    authMiddleware,
    roleMiddleware,
    requirePermission('outreach_interactions_meetings_qualifications', 'create'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const input = parseWithSchema(CreateInteractionSchema, {
        attemptId: pick(raw, 'attemptId', 'attempt_id'),
        originInteractionId:
          pick(raw, 'originInteractionId', 'origin_interaction_id') || null,
        eventType: pick(raw, 'eventType', 'event_type'),
        outcome: pick(raw, 'outcome') || null,
        occurredAt: pick(raw, 'occurredAt', 'occurred_at'),
        summary: pick(raw, 'summary') || null,
      });

      const occurredAtIso = input.occurredAt ?? new Date().toISOString();

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const attRes = await client.query<{
          attempt_id: string;
          sponsor_id: string;
          owner_member_id: string | null;
          record_class: string;
        }>(
          `SELECT attempt_id, sponsor_id, owner_member_id, record_class
             FROM public.outreach_attempt
            WHERE attempt_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [input.attemptId]
        );
        const att = attRes.rows[0];
        if (!att) {
          throw new AppApiError(
            404,
            'OUTREACH_ATTEMPT_NOT_FOUND',
            `Outreach attempt ${input.attemptId} not found.`
          );
        }
        rejectHistoricalWriteRequest(null, att.record_class);

        if (scope === 'own') {
          const ownsSponsor = await isSponsorOwner(
            client,
            att.sponsor_id,
            actor.memberId,
            att.record_class
          );
          if (att.owner_member_id !== actor.memberId && !ownsSponsor) {
            throw new AppApiError(
              403,
              'FORBIDDEN',
              'You can only log interactions on your own outreach attempts or sponsors.'
            );
          }
        }

        const edition = await resolveWritableEditionByClass(
          client,
          att.record_class,
          config.editionIdDefault
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const interactionId = generatePrefixedId('IN-');
        const intRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.interaction (
             interaction_id, attempt_id, origin_interaction_id, event_type,
             outcome, occurred_at, summary, logged_by,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4,
             $5, $6::timestamptz, $7, $8,
             $9, $10, 'ui:interactions', 'T', $8
           )
           RETURNING *`,
          [
            interactionId,
            input.attemptId,
            input.originInteractionId ?? null,
            input.eventType,
            input.outcome ?? null,
            occurredAtIso,
            input.summary ?? null,
            actor.memberId,
            edition.recordClass,
            batchId,
          ]
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'INTERACTION',
          entityId: interactionId,
          operation: 'insert',
          after: intRes.rows[0] ?? { interaction_id: interactionId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:interactions',
        });

        return {
          id: interactionId,
          dataVersion,
          data_version: dataVersion,
          interaction: intRes.rows[0],
        };
      });

      res.status(201).json(result);
    })
  );

  // ---------------------------------------------------------------------------
  // 6. POST /api/meetings & PATCH /api/meetings/:id
  // ---------------------------------------------------------------------------
  const CreateMeetingSchema = z.object({
    attemptId: z.string().trim().min(1).nullable().optional(),
    opportunityId: z.string().trim().min(1).nullable().optional(),
    sponsorId: z.string().trim().min(1),
    scheduledAt: z.string().trim().min(1),
    status: z.enum(MEETING_STATUS_VALUES).default('booked'),
    purpose: z.enum(MEETING_PURPOSE_VALUES).nullable().optional(),
    attendeeMemberIds: z.array(z.string().trim().min(1)).nullable().optional(),
    outcomeNote: z.string().trim().max(2000).nullable().optional(),
  });

  router.post(
    '/meetings',
    authMiddleware,
    roleMiddleware,
    requirePermission('outreach_interactions_meetings_qualifications', 'create'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const input = parseWithSchema(CreateMeetingSchema, {
        attemptId: pick(raw, 'attemptId', 'attempt_id') || null,
        opportunityId: pick(raw, 'opportunityId', 'opportunity_id') || null,
        sponsorId: pick(raw, 'sponsorId', 'sponsor_id'),
        scheduledAt: pick(raw, 'scheduledAt', 'scheduled_at'),
        status: pick(raw, 'status') ?? 'booked',
        purpose: pick(raw, 'purpose') || null,
        attendeeMemberIds:
          pick<string[]>(raw, 'attendeeMemberIds', 'attendee_member_ids') ?? [
            actor.memberId,
          ],
        outcomeNote: pick(raw, 'outcomeNote', 'outcome_note') || null,
      });

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const spRes = await client.query<{ record_class: string }>(
          `SELECT record_class FROM public.sponsor WHERE sponsor_id = $1 AND NOT is_deleted LIMIT 1`,
          [input.sponsorId]
        );
        const sp = spRes.rows[0];
        if (!sp) {
          throw new AppApiError(404, 'SPONSOR_NOT_FOUND', `Sponsor ${input.sponsorId} not found.`);
        }
        rejectHistoricalWriteRequest(null, sp.record_class);

        if (scope === 'own') {
          const owns = await isSponsorOwner(
            client,
            input.sponsorId,
            actor.memberId,
            sp.record_class
          );
          if (!owns) {
            throw new AppApiError(
              403,
              'FORBIDDEN',
              'You can only log meetings for sponsors owned by you.'
            );
          }
        }

        const edition = await resolveWritableEditionByClass(
          client,
          sp.record_class,
          config.editionIdDefault
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const meetingId = generatePrefixedId('MT-');
        const mtRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.meeting (
             meeting_id, attempt_id, opportunity_id, sponsor_id,
             scheduled_at, status, purpose, attendee_member_ids, outcome_note,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4,
             $5::timestamptz, $6, $7, $8::text[], $9,
             $10, $11, 'ui:meetings', 'T', $12
           )
           RETURNING *`,
          [
            meetingId,
            input.attemptId ?? null,
            input.opportunityId ?? null,
            input.sponsorId,
            input.scheduledAt,
            input.status,
            input.purpose ?? null,
            input.attendeeMemberIds ?? null,
            input.outcomeNote ?? null,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'MEETING',
          entityId: meetingId,
          operation: 'insert',
          after: mtRes.rows[0] ?? { meeting_id: meetingId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:meetings',
        });

        return {
          id: meetingId,
          dataVersion,
          data_version: dataVersion,
          meeting: mtRes.rows[0],
        };
      });

      res.status(201).json(result);
    })
  );

  const UpdateMeetingSchema = z.object({
    scheduledAt: z.string().trim().min(1).optional(),
    status: z.enum(MEETING_STATUS_VALUES).optional(),
    purpose: z.enum(MEETING_PURPOSE_VALUES).nullable().optional(),
    attendeeMemberIds: z.array(z.string().trim().min(1)).nullable().optional(),
    outcomeNote: z.string().trim().max(2000).nullable().optional(),
    isDeleted: z.literal(true).optional(),
  });

  router.patch(
    '/meetings/:id',
    authMiddleware,
    roleMiddleware,
    requirePermission('outreach_interactions_meetings_qualifications', 'update'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const meetingId = req.params.id;
      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const input = parseWithSchema(UpdateMeetingSchema, {
        scheduledAt: pick(raw, 'scheduledAt', 'scheduled_at'),
        status: pick(raw, 'status'),
        purpose: hasAnyKey(raw, 'purpose') ? pick(raw, 'purpose') || null : undefined,
        attendeeMemberIds: hasAnyKey(raw, 'attendeeMemberIds', 'attendee_member_ids')
          ? pick<string[]>(raw, 'attendeeMemberIds', 'attendee_member_ids') ?? null
          : undefined,
        outcomeNote: hasAnyKey(raw, 'outcomeNote', 'outcome_note')
          ? pick(raw, 'outcomeNote', 'outcome_note') || null
          : undefined,
        isDeleted: pick(raw, 'isDeleted', 'is_deleted'),
      });

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const curRes = await client.query<{
          meeting_id: string;
          sponsor_id: string;
          record_class: string;
        }>(
          `SELECT meeting_id, sponsor_id, record_class
             FROM public.meeting
            WHERE meeting_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [meetingId]
        );
        const existing = curRes.rows[0];
        if (!existing) {
          throw new AppApiError(404, 'MEETING_NOT_FOUND', `Meeting ${meetingId} not found.`);
        }
        rejectHistoricalWriteRequest(null, existing.record_class);

        if (scope === 'own') {
          const owns = await isSponsorOwner(
            client,
            existing.sponsor_id,
            actor.memberId,
            existing.record_class
          );
          if (!owns) {
            throw new AppApiError(
              403,
              'FORBIDDEN',
              'You can only update meetings for sponsors owned by you.'
            );
          }
        }

        const edition = await resolveWritableEditionByClass(
          client,
          existing.record_class,
          config.editionIdDefault
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const sets: string[] = [];
        const params: unknown[] = [];
        const addSet = (col: string, val: unknown, cast = '') => {
          params.push(val);
          sets.push(`${col} = $${params.length}${cast}`);
        };

        if (input.scheduledAt !== undefined)
          addSet('scheduled_at', input.scheduledAt, '::timestamptz');
        if (input.status !== undefined) addSet('status', input.status);
        if (input.purpose !== undefined) addSet('purpose', input.purpose);
        if (input.attendeeMemberIds !== undefined)
          addSet('attendee_member_ids', input.attendeeMemberIds, '::text[]');
        if (input.outcomeNote !== undefined) addSet('outcome_note', input.outcomeNote);
        if (input.isDeleted === true) addSet('is_deleted', true);

        if (sets.length === 0) {
          throw new AppApiError(400, 'INVALID_ARGUMENT', 'No updatable fields provided.');
        }

        params.push(meetingId);
        const updRes = await client.query<Record<string, unknown>>(
          `UPDATE public.meeting
              SET ${sets.join(', ')}
            WHERE meeting_id = $${params.length}
              AND NOT is_deleted
            RETURNING *`,
          params
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'MEETING',
          entityId: meetingId,
          operation: input.isDeleted === true ? 'delete' : 'update',
          after: updRes.rows[0] ?? { meeting_id: meetingId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:meetings',
        });

        return {
          id: meetingId,
          dataVersion,
          data_version: dataVersion,
          meeting: updRes.rows[0],
        };
      });

      res.status(200).json(result);
    })
  );

  // ---------------------------------------------------------------------------
  // 7. POST /api/qualifications (append-only version row)
  // ---------------------------------------------------------------------------
  const CreateQualificationSchema = z.object({
    sponsorId: z.string().trim().min(1),
    editionId: z.string().trim().min(1),
    sourceCampaignId: z.string().trim().min(1).nullable().optional(),
    status: z.enum(QUALIFICATION_STATUS_VALUES),
    reason: z.string().trim().max(1000).nullable().optional(),
    checklistPassed: z.boolean().nullable().optional(),
  });

  router.post(
    '/qualifications',
    authMiddleware,
    roleMiddleware,
    requirePermission('outreach_interactions_meetings_qualifications', 'create'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const { editionId, requestedRecordClass } = extractRequestedEditionAndClass(
        req,
        config.editionIdDefault
      );
      rejectHistoricalWriteRequest(editionId, requestedRecordClass);

      const input = parseWithSchema(CreateQualificationSchema, {
        sponsorId: pick(raw, 'sponsorId', 'sponsor_id'),
        editionId,
        sourceCampaignId:
          pick(raw, 'sourceCampaignId', 'source_campaign_id') || null,
        status: pick(raw, 'status'),
        reason: pick(raw, 'reason') || null,
        checklistPassed:
          pick<boolean>(raw, 'checklistPassed', 'checklist_passed') ?? null,
      });

      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const edition = await resolveWritableEdition(
          client,
          input.editionId,
          requestedRecordClass
        );

        const spRes = await client.query<{ record_class: string }>(
          `SELECT record_class FROM public.sponsor WHERE sponsor_id = $1 AND NOT is_deleted LIMIT 1`,
          [input.sponsorId]
        );
        if (!spRes.rows[0]) {
          throw new AppApiError(404, 'SPONSOR_NOT_FOUND', `Sponsor ${input.sponsorId} not found.`);
        }
        if (spRes.rows[0].record_class !== edition.recordClass) {
          throw new AppApiError(
            422,
            'RECORD_CLASS_MISMATCH',
            `Sponsor ${input.sponsorId} (${spRes.rows[0].record_class}) does not match edition ${edition.editionId} (${edition.recordClass}).`
          );
        }

        if (scope === 'own') {
          const owns = await isSponsorOwner(
            client,
            input.sponsorId,
            actor.memberId,
            edition.recordClass
          );
          if (!owns) {
            throw new AppApiError(
              403,
              'FORBIDDEN',
              'You can only record qualifications for sponsors owned by you.'
            );
          }
        }

        const verRes = await client.query<{ max_ver: number | string | null }>(
          `SELECT COALESCE(MAX(version_no), 0) AS max_ver
             FROM public.qualification_version
            WHERE sponsor_id = $1
              AND edition_id = $2
              AND NOT is_deleted`,
          [input.sponsorId, edition.editionId]
        );
        const nextVersion = Number(verRes.rows[0]?.max_ver ?? 0) + 1;

        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const historyId = generatePrefixedId('QV-');
        const qRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.qualification_version (
             history_id, sponsor_id, edition_id, source_campaign_id,
             status, reason, checklist_passed, version_no,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4,
             $5, $6, $7, $8,
             $9, $10, 'ui:qualifications', 'T', $11
           )
           RETURNING *`,
          [
            historyId,
            input.sponsorId,
            edition.editionId,
            input.sourceCampaignId ?? null,
            input.status,
            input.reason ?? null,
            input.checklistPassed ?? null,
            nextVersion,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'QUALIFICATION_VERSION',
          entityId: historyId,
          operation: 'insert',
          after: qRes.rows[0] ?? { history_id: historyId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:qualifications',
        });

        return {
          id: historyId,
          dataVersion,
          data_version: dataVersion,
          qualification: qRes.rows[0],
        };
      });

      res.status(201).json(result);
    })
  );

  // ---------------------------------------------------------------------------
  // 8. POST /api/opportunities, PATCH /api/opportunities/:id,
  //    POST /api/opportunities/:id/stage, POST /api/opportunities/:id/confirm
  // ---------------------------------------------------------------------------
  const CreateOpportunitySchema = z.object({
    sponsorId: z.string().trim().min(1),
    editionId: z.string().trim().min(1),
    primaryContactId: z.string().trim().min(1).nullable().optional(),
    originatingCampaignId: z.string().trim().min(1).nullable().optional(),
    betId: z.string().trim().min(1).nullable().optional(),
    supportType: z.enum(OPPORTUNITY_SUPPORT_TYPES),
    isRenewal: z.boolean().default(false),
    renewalRoute: z
      .enum(['direct_past_owner', 'warm_intro', 'inbound', 'reassigned', 'other'])
      .nullable()
      .optional(),
    recoveredLead: z.boolean().default(false),
    name: z.string().trim().max(240).nullable().optional(),
    proposedValue: z.coerce.number().finite().min(0).nullable().optional(),
    ownerMemberId: z.string().trim().min(1).nullable().optional(),
  });

  router.post(
    '/opportunities',
    authMiddleware,
    roleMiddleware,
    requirePermission('opportunities_stage', 'create'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const { editionId, requestedRecordClass } = extractRequestedEditionAndClass(
        req,
        config.editionIdDefault
      );
      rejectHistoricalWriteRequest(editionId, requestedRecordClass);

      const rawProposed = pick(raw, 'proposedValue', 'proposed_value');
      const input = parseWithSchema(CreateOpportunitySchema, {
        sponsorId: pick(raw, 'sponsorId', 'sponsor_id'),
        editionId,
        primaryContactId: pick(raw, 'primaryContactId', 'primary_contact_id') || null,
        originatingCampaignId:
          pick(raw, 'originatingCampaignId', 'originating_campaign_id') || null,
        betId: pick(raw, 'betId', 'bet_id') || null,
        supportType: pick(raw, 'supportType', 'support_type'),
        isRenewal: Boolean(pick(raw, 'isRenewal', 'is_renewal') ?? false),
        renewalRoute: pick(raw, 'renewalRoute', 'renewal_route') || null,
        recoveredLead: Boolean(pick(raw, 'recoveredLead', 'recovered_lead') ?? false),
        name: pick(raw, 'name') || null,
        proposedValue:
          rawProposed === undefined || rawProposed === null || rawProposed === ''
            ? null
            : rawProposed,
        ownerMemberId: pick(raw, 'ownerMemberId', 'owner_member_id') || null,
      });

      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      if (
        scope === 'own' &&
        input.ownerMemberId &&
        input.ownerMemberId !== actor.memberId
      ) {
        throw new AppApiError(
          403,
          'FORBIDDEN',
          'Sales roles can only create opportunities owned by themselves.'
        );
      }

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const edition = await resolveWritableEdition(
          client,
          input.editionId,
          requestedRecordClass
        );

        const spRes = await client.query<{
          sponsor_id: string;
          lifecycle_status: string | null;
          record_class: string;
        }>(
          `SELECT sponsor_id, lifecycle_status, record_class
             FROM public.sponsor
            WHERE sponsor_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [input.sponsorId]
        );
        const sp = spRes.rows[0];
        if (!sp) {
          throw new AppApiError(404, 'SPONSOR_NOT_FOUND', `Sponsor ${input.sponsorId} not found.`);
        }
        if (sp.record_class !== edition.recordClass) {
          throw new AppApiError(
            422,
            'RECORD_CLASS_MISMATCH',
            `Sponsor ${input.sponsorId} (${sp.record_class}) does not match edition ${edition.editionId}.`
          );
        }
        if (sp.lifecycle_status === 'research_target') {
          throw new AppApiError(
            422,
            'INV_03_VIOLATION',
            `INV-03 violation: sponsor ${input.sponsorId} is research_target and cannot open an opportunity before an interaction with a named contact.`
          );
        }

        if (scope === 'own') {
          const owns = await isSponsorOwner(
            client,
            input.sponsorId,
            actor.memberId,
            edition.recordClass
          );
          if (!owns) {
            throw new AppApiError(
              403,
              'FORBIDDEN',
              'You can only create opportunities for sponsors owned by you.'
            );
          }
        }

        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const opportunityId = generatePrefixedId('OP-');
        const ownerId =
          scope === 'own' ? actor.memberId : input.ownerMemberId ?? actor.memberId;

        const oppRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.opportunity (
             opportunity_id, sponsor_id, edition_id, primary_contact_id,
             originating_campaign_id, bet_id, support_type, is_renewal,
             renewal_route, recovered_lead, name,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4,
             $5, $6, $7, $8,
             $9, $10, $11,
             $12, $13, 'ui:opportunities', 'T', $14
           )
           RETURNING *`,
          [
            opportunityId,
            input.sponsorId,
            edition.editionId,
            input.primaryContactId ?? null,
            input.originatingCampaignId ?? null,
            input.betId ?? null,
            input.supportType,
            input.isRenewal,
            input.renewalRoute ?? null,
            input.recoveredLead,
            input.name ?? null,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        const historyId = generatePrefixedId('HV-');
        const stgRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.opportunity_stage_version (
             history_id, opportunity_id, stage, owner_member_id,
             proposed_value, confirmed_value, version_no,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, 'prospecting', $3,
             $4, 0, 1,
             $5, $6, 'ui:opportunities', 'T', $7
           )
           RETURNING *`,
          [
            historyId,
            opportunityId,
            ownerId,
            input.proposedValue ?? null,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'OPPORTUNITY',
          entityId: opportunityId,
          operation: 'insert',
          after: {
            opportunity: oppRes.rows[0],
            initial_stage: stgRes.rows[0],
          },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:opportunities',
        });

        return {
          id: opportunityId,
          dataVersion,
          data_version: dataVersion,
          opportunity: {
            ...(oppRes.rows[0] ?? {}),
            current_stage_version: stgRes.rows[0],
          },
        };
      });

      res.status(201).json(result);
    })
  );

  const UpdateOpportunityMetadataSchema = z.object({
    name: z.string().trim().max(240).nullable().optional(),
    primaryContactId: z.string().trim().min(1).nullable().optional(),
    betId: z.string().trim().min(1).nullable().optional(),
    isDeleted: z.literal(true).optional(),
  });

  router.patch(
    '/opportunities/:id',
    authMiddleware,
    roleMiddleware,
    requirePermission('opportunities_stage', 'update'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      if (
        hasAnyKey(
          raw,
          'originating_campaign_id',
          'originatingCampaignId',
          'sponsor_id',
          'sponsorId',
          'edition_id',
          'editionId'
        )
      ) {
        throw new AppApiError(
          422,
          'IMMUTABLE_FIELD',
          'originating_campaign_id, sponsor_id, and edition_id are immutable after opportunity creation.'
        );
      }

      const opportunityId = req.params.id;
      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const input = parseWithSchema(UpdateOpportunityMetadataSchema, {
        name: hasAnyKey(raw, 'name') ? pick(raw, 'name') || null : undefined,
        primaryContactId: hasAnyKey(raw, 'primaryContactId', 'primary_contact_id')
          ? pick(raw, 'primaryContactId', 'primary_contact_id') || null
          : undefined,
        betId: hasAnyKey(raw, 'betId', 'bet_id')
          ? pick(raw, 'betId', 'bet_id') || null
          : undefined,
        isDeleted: pick(raw, 'isDeleted', 'is_deleted'),
      });

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const curRes = await client.query<{
          opportunity_id: string;
          edition_id: string;
          record_class: string;
        }>(
          `SELECT opportunity_id, edition_id, record_class
             FROM public.opportunity
            WHERE opportunity_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [opportunityId]
        );
        const existing = curRes.rows[0];
        if (!existing) {
          throw new AppApiError(
            404,
            'OPPORTUNITY_NOT_FOUND',
            `Opportunity ${opportunityId} not found.`
          );
        }
        rejectHistoricalWriteRequest(existing.edition_id, existing.record_class);

        if (scope === 'own') {
          const ownerId = await getOpportunityOwnerId(client, opportunityId);
          if (ownerId !== actor.memberId) {
            throw new AppApiError(
              403,
              'FORBIDDEN',
              'You can only edit opportunities owned by you.'
            );
          }
        }

        const edition = await resolveWritableEdition(client, existing.edition_id);
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const sets: string[] = [];
        const params: unknown[] = [];
        const addSet = (col: string, val: unknown) => {
          params.push(val);
          sets.push(`${col} = $${params.length}`);
        };
        if (input.name !== undefined) addSet('name', input.name);
        if (input.primaryContactId !== undefined)
          addSet('primary_contact_id', input.primaryContactId);
        if (input.betId !== undefined) addSet('bet_id', input.betId);
        if (input.isDeleted === true) addSet('is_deleted', true);

        if (sets.length === 0) {
          throw new AppApiError(
            400,
            'INVALID_ARGUMENT',
            'Allowed PATCH fields: name, primary_contact_id, bet_id.'
          );
        }

        params.push(opportunityId);
        const updRes = await client.query<Record<string, unknown>>(
          `UPDATE public.opportunity
              SET ${sets.join(', ')}
            WHERE opportunity_id = $${params.length}
              AND NOT is_deleted
            RETURNING *`,
          params
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'OPPORTUNITY',
          entityId: opportunityId,
          operation: input.isDeleted === true ? 'delete' : 'update',
          after: updRes.rows[0] ?? { opportunity_id: opportunityId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:opportunities',
        });

        return {
          id: opportunityId,
          dataVersion,
          data_version: dataVersion,
          opportunity: updRes.rows[0],
        };
      });

      res.status(200).json(result);
    })
  );

  const StageTransitionSchema = z.object({
    stage: z.enum(OPPORTUNITY_STAGES),
    proposedValue: z.coerce.number().finite().min(0).nullable().optional(),
    ownerMemberId: z.string().trim().min(1).nullable().optional(),
    dropReason: z.enum(DROP_REASON_VALUES).nullable().optional(),
    lossReason: z.enum(LOSS_REASON_VALUES).nullable().optional(),
  });

  router.post(
    '/opportunities/:id/stage',
    authMiddleware,
    roleMiddleware,
    requirePermission('opportunities_stage', 'update'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const opportunityId = req.params.id;
      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const rawStage = pick(raw, 'stage');
      if (rawStage === 'partner_confirmed') {
        throw new AppApiError(
          422,
          'USE_CONFIRM_ENDPOINT',
          'Moving to partner_confirmed is not permitted on /stage; use POST /api/opportunities/:id/confirm with signed contract details.'
        );
      }

      const rawProposed = pick(raw, 'proposedValue', 'proposed_value');
      const input = parseWithSchema(StageTransitionSchema, {
        stage: rawStage,
        proposedValue:
          rawProposed === undefined || rawProposed === null || rawProposed === ''
            ? undefined
            : rawProposed,
        ownerMemberId: pick(raw, 'ownerMemberId', 'owner_member_id') || undefined,
        dropReason: normalizeDropReason(pick(raw, 'dropReason', 'drop_reason')),
        lossReason: pick(raw, 'lossReason', 'loss_reason') || undefined,
      });

      if ((input.stage === 'lost' || input.stage === 'withdrawn') && !input.dropReason) {
        throw new AppApiError(
          422,
          'DROP_REASON_REQUIRED',
          'A drop reason is required when marking an opportunity as lost or withdrawn.'
        );
      }

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const oppRes = await client.query<{
          opportunity_id: string;
          edition_id: string;
          record_class: string;
        }>(
          `SELECT opportunity_id, edition_id, record_class
             FROM public.opportunity
            WHERE opportunity_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [opportunityId]
        );
        const opp = oppRes.rows[0];
        if (!opp) {
          throw new AppApiError(
            404,
            'OPPORTUNITY_NOT_FOUND',
            `Opportunity ${opportunityId} not found.`
          );
        }
        const edition = await resolveWritableEdition(client, opp.edition_id);

        const latestRes = await client.query<{
          history_id: string;
          owner_member_id: string | null;
          proposed_value: string | number | null;
          version_no: number;
        }>(
          `SELECT history_id, owner_member_id, proposed_value, version_no
             FROM public.opportunity_stage_version
            WHERE opportunity_id = $1
              AND NOT is_deleted
            ORDER BY valid_from DESC, history_id DESC
            LIMIT 1`,
          [opportunityId]
        );
        const latest = latestRes.rows[0];
        const currentOwnerId = latest?.owner_member_id ?? null;

        if (scope === 'own' && currentOwnerId !== actor.memberId) {
          throw new AppApiError(
            403,
            'FORBIDDEN',
            'You can only advance stages for opportunities owned by you.'
          );
        }
        if (
          scope === 'own' &&
          input.ownerMemberId &&
          input.ownerMemberId !== actor.memberId
        ) {
          throw new AppApiError(
            403,
            'FORBIDDEN',
            'Sales roles cannot reassign opportunity ownership via stage transition.'
          );
        }

        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const historyId = generatePrefixedId('HV-');
        const nextVersion = Number(latest?.version_no ?? 0) + 1;
        const nextOwner = input.ownerMemberId ?? currentOwnerId ?? actor.memberId;
        const nextProposed =
          input.proposedValue !== undefined
            ? input.proposedValue
            : latest?.proposed_value ?? null;

        const stgRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.opportunity_stage_version (
             history_id, opportunity_id, stage, owner_member_id,
             proposed_value, confirmed_value, drop_reason, loss_reason, version_no,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4,
             $5, 0, $6, $7, $8,
             $9, $10, 'ui:opportunity_stage', 'T', $11
           )
           RETURNING *`,
          [
            historyId,
            opportunityId,
            input.stage,
            nextOwner,
            nextProposed,
            input.stage === 'lost' || input.stage === 'withdrawn'
              ? input.dropReason
              : null,
            input.stage === 'lost' || input.stage === 'withdrawn'
              ? input.lossReason ?? null
              : null,
            nextVersion,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'OPPORTUNITY_STAGE_VERSION',
          entityId: historyId,
          operation: 'insert',
          after: stgRes.rows[0] ?? { history_id: historyId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:opportunity_stage',
        });

        return {
          id: historyId,
          dataVersion,
          data_version: dataVersion,
          stage_version: stgRes.rows[0],
        };
      });

      res.status(201).json(result);
    })
  );

  const ConfirmLineSchema = z.object({
    considerationType: z.enum(['cash', 'in_kind']),
    value: z.coerce.number().finite().positive('Contract line value must be greater than 0.'),
    assetId: z.string().trim().min(1).nullable().optional(),
    priceId: z.string().trim().min(1).nullable().optional(),
  });

  const ConfirmOpportunitySchema = z.object({
    signedAt: z.string().trim().min(1),
    paymentTerms: z.enum(PAYMENT_TERMS_VALUES),
    signatoryContactId: z.string().trim().min(1).nullable().optional(),
    documentUri: z.string().trim().max(500).nullable().optional(),
    lines: z.array(ConfirmLineSchema).min(1, 'At least one contract line is required.'),
    signedValueTotal: z.coerce.number().finite().min(0),
  });

  router.post(
    '/opportunities/:id/confirm',
    authMiddleware,
    roleMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const opportunityId = req.params.id;
      const actor = getVerifiedActor(req);
      const roles = req.resolvedMember?.roles ?? [];

      const rawLines = Array.isArray(raw.lines)
        ? raw.lines.map((line) => {
            const l = (line ?? {}) as Record<string, unknown>;
            return {
              considerationType: pick(l, 'considerationType', 'consideration_type'),
              value: pick(l, 'value'),
              assetId: pick(l, 'assetId', 'asset_id') || null,
              priceId: pick(l, 'priceId', 'price_id') || null,
            };
          })
        : [];

      const input = parseWithSchema(ConfirmOpportunitySchema, {
        signedAt: pick(raw, 'signedAt', 'signed_at') ?? new Date().toISOString(),
        paymentTerms: pick(raw, 'paymentTerms', 'payment_terms'),
        signatoryContactId:
          pick(raw, 'signatoryContactId', 'signatory_contact_id') || null,
        documentUri: pick(raw, 'documentUri', 'document_uri') || null,
        lines: rawLines,
        signedValueTotal: pick(raw, 'signedValueTotal', 'signed_value_total'),
      });

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const oppRes = await client.query<{
          opportunity_id: string;
          sponsor_id: string;
          edition_id: string;
          record_class: string;
        }>(
          `SELECT opportunity_id, sponsor_id, edition_id, record_class
             FROM public.opportunity
            WHERE opportunity_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [opportunityId]
        );
        const opp = oppRes.rows[0];
        if (!opp) {
          throw new AppApiError(
            404,
            'OPPORTUNITY_NOT_FOUND',
            `Opportunity ${opportunityId} not found.`
          );
        }
        const edition = await resolveWritableEdition(client, opp.edition_id);

        const latestRes = await client.query<{
          owner_member_id: string | null;
          proposed_value: string | number | null;
          stage: string;
          version_no: number;
        }>(
          `SELECT owner_member_id, proposed_value, stage, version_no
             FROM public.opportunity_stage_version
            WHERE opportunity_id = $1
              AND NOT is_deleted
            ORDER BY valid_from DESC, history_id DESC
            LIMIT 1`,
          [opportunityId]
        );
        const latest = latestRes.rows[0];
        const isOwner =
          latest?.owner_member_id === actor.memberId ||
          (await isSponsorOwner(
            client,
            opp.sponsor_id,
            actor.memberId,
            edition.recordClass
          ));

        if (!canConfirmOpportunity(roles, isOwner)) {
          throw new AppApiError(
            403,
            'FORBIDDEN',
            'Confirming a partnership requires coordination_lead or the owning sales role for their own deal.'
          );
        }

        const existingContract = await client.query<{ contract_id: string }>(
          `SELECT contract_id
             FROM public.contract
            WHERE opportunity_id = $1
              AND status = 'active'
              AND valid_to IS NULL
              AND NOT is_deleted
            LIMIT 1`,
          [opportunityId]
        );
        if (existingContract.rows[0]) {
          throw new AppApiError(
            422,
            'CONTRACT_ALREADY_EXISTS',
            `Opportunity ${opportunityId} already has active contract ${existingContract.rows[0].contract_id}.`
          );
        }

        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const contractId = generatePrefixedId('KC-');
        const cRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.contract (
             contract_id, opportunity_id, signed_at, signed_value_total,
             payment_terms, signatory_contact_id, document_uri, status, version_no,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3::timestamptz, $4,
             $5, $6, $7, 'active', 1,
             $8, $9, 'ui:opportunity_confirm', 'T', $10
           )
           RETURNING *`,
          [
            contractId,
            opportunityId,
            input.signedAt,
            input.signedValueTotal,
            input.paymentTerms,
            input.signatoryContactId ?? null,
            input.documentUri ?? null,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        const insertedLines: Array<Record<string, unknown>> = [];
        for (const line of input.lines) {
          const lineId = generatePrefixedId('KL-');
          const lRes = await client.query<Record<string, unknown>>(
            `INSERT INTO public.contract_line (
               contract_line_id, contract_id, asset_id, consideration_type, value, price_id,
               record_class, import_batch_id, source_ref, evidence_class, created_by
             ) VALUES (
               $1, $2, $3, $4, $5, $6,
               $7, $8, 'ui:opportunity_confirm', 'T', $9
             )
             RETURNING *`,
            [
              lineId,
              contractId,
              line.assetId ?? null,
              line.considerationType,
              line.value,
              line.priceId ?? null,
              edition.recordClass,
              batchId,
              actor.memberId,
            ]
          );
          if (lRes.rows[0]) insertedLines.push(lRes.rows[0]);
        }

        const historyId = generatePrefixedId('HV-');
        const nextVersion = Number(latest?.version_no ?? 0) + 1;
        const stgRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.opportunity_stage_version (
             history_id, opportunity_id, stage, owner_member_id,
             proposed_value, confirmed_value, version_no,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, 'partner_confirmed', $3,
             $4, $5, $6,
             $7, $8, 'ui:opportunity_confirm', 'T', $9
           )
           RETURNING *`,
          [
            historyId,
            opportunityId,
            latest?.owner_member_id ?? actor.memberId,
            latest?.proposed_value ?? input.signedValueTotal,
            input.signedValueTotal,
            nextVersion,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'CONTRACT',
          entityId: contractId,
          operation: 'insert',
          after: {
            contract: cRes.rows[0],
            lines: insertedLines,
            stage_version: stgRes.rows[0],
          },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:opportunity_confirm',
        });

        return {
          id: contractId,
          contractId,
          opportunityId,
          historyId,
          dataVersion,
          data_version: dataVersion,
          contract: {
            ...(cRes.rows[0] ?? {}),
            lines: insertedLines,
          },
          stage_version: stgRes.rows[0],
        };
      });

      res.status(201).json(result);
    })
  );

  // ---------------------------------------------------------------------------
  // 9. POST /api/tasks & PATCH /api/tasks/:id
  // ---------------------------------------------------------------------------
  const CreateTaskSchema = z.object({
    title: z.string().trim().min(1).max(240),
    taskType: z.enum(TASK_TYPE_VALUES),
    ownerMemberId: z.string().trim().min(1).optional(),
    dueAt: z.string().trim().min(1),
    status: z.enum(TASK_STATUS_VALUES).default('open'),
    linkedType: z.enum(TASK_LINKED_TYPE_VALUES).nullable().optional(),
    linkedId: z.string().trim().min(1).nullable().optional(),
    betId: z.string().trim().min(1).nullable().optional(),
    editionId: z.string().trim().min(1),
  });

  router.post(
    '/tasks',
    authMiddleware,
    roleMiddleware,
    requirePermission('tasks', 'create'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const { editionId, requestedRecordClass } = extractRequestedEditionAndClass(
        req,
        config.editionIdDefault
      );
      rejectHistoricalWriteRequest(editionId, requestedRecordClass);

      const input = parseWithSchema(CreateTaskSchema, {
        title: pick(raw, 'title'),
        taskType: pick(raw, 'taskType', 'task_type'),
        ownerMemberId: pick(raw, 'ownerMemberId', 'owner_member_id') || undefined,
        dueAt: pick(raw, 'dueAt', 'due_at'),
        status: pick(raw, 'status') ?? 'open',
        linkedType: pick(raw, 'linkedType', 'linked_type') || null,
        linkedId: pick(raw, 'linkedId', 'linked_id') || null,
        betId: pick(raw, 'betId', 'bet_id') || null,
        editionId,
      });

      if ((input.linkedType && !input.linkedId) || (!input.linkedType && input.linkedId)) {
        throw new AppApiError(
          400,
          'INVALID_LINKED_PAIR',
          'linked_type and linked_id must both be supplied together.'
        );
      }

      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      if (
        scope === 'own' &&
        input.ownerMemberId &&
        input.ownerMemberId !== actor.memberId
      ) {
        throw new AppApiError(
          403,
          'FORBIDDEN',
          'You can only create tasks assigned to yourself.'
        );
      }

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const edition = await resolveWritableEdition(
          client,
          input.editionId,
          requestedRecordClass
        );

        if (input.linkedType && input.linkedId) {
          await assertLinkedRecordExists(client, input.linkedType, input.linkedId);
        }

        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const taskId = generatePrefixedId('TK-');
        const ownerId =
          scope === 'own' ? actor.memberId : input.ownerMemberId ?? actor.memberId;

        const tRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.task (
             task_id, title, task_type, owner_member_id, due_at, status,
             completed_at, linked_type, linked_id, bet_id, origin,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4, $5::timestamptz, $6,
             ${input.status === 'done' ? 'now()' : 'NULL'}, $7, $8, $9, 'manual',
             $10, $11, 'ui:tasks', 'T', $12
           )
           RETURNING *`,
          [
            taskId,
            input.title,
            input.taskType,
            ownerId,
            input.dueAt,
            input.status,
            input.linkedType ?? null,
            input.linkedId ?? null,
            input.betId ?? null,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'TASK',
          entityId: taskId,
          operation: 'insert',
          after: tRes.rows[0] ?? { task_id: taskId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:tasks',
        });

        return {
          id: taskId,
          dataVersion,
          data_version: dataVersion,
          task: tRes.rows[0],
        };
      });

      res.status(201).json(result);
    })
  );

  const UpdateTaskSchema = z.object({
    title: z.string().trim().min(1).max(240).optional(),
    taskType: z.enum(TASK_TYPE_VALUES).optional(),
    ownerMemberId: z.string().trim().min(1).optional(),
    dueAt: z.string().trim().min(1).optional(),
    status: z.enum(TASK_STATUS_VALUES).optional(),
    linkedType: z.enum(TASK_LINKED_TYPE_VALUES).nullable().optional(),
    linkedId: z.string().trim().min(1).nullable().optional(),
    betId: z.string().trim().min(1).nullable().optional(),
    isDeleted: z.literal(true).optional(),
  });

  router.patch(
    '/tasks/:id',
    authMiddleware,
    roleMiddleware,
    requirePermission('tasks', 'update'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const taskId = req.params.id;
      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const input = parseWithSchema(UpdateTaskSchema, {
        title: pick(raw, 'title'),
        taskType: pick(raw, 'taskType', 'task_type'),
        ownerMemberId: pick(raw, 'ownerMemberId', 'owner_member_id'),
        dueAt: pick(raw, 'dueAt', 'due_at'),
        status: pick(raw, 'status'),
        linkedType: hasAnyKey(raw, 'linkedType', 'linked_type')
          ? pick(raw, 'linkedType', 'linked_type') || null
          : undefined,
        linkedId: hasAnyKey(raw, 'linkedId', 'linked_id')
          ? pick(raw, 'linkedId', 'linked_id') || null
          : undefined,
        betId: hasAnyKey(raw, 'betId', 'bet_id')
          ? pick(raw, 'betId', 'bet_id') || null
          : undefined,
        isDeleted: pick(raw, 'isDeleted', 'is_deleted'),
      });

      if (
        (input.linkedType !== undefined || input.linkedId !== undefined) &&
        Boolean(input.linkedType) !== Boolean(input.linkedId)
      ) {
        throw new AppApiError(
          400,
          'INVALID_LINKED_PAIR',
          'linked_type and linked_id must both be set or both be null.'
        );
      }

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const curRes = await client.query<{
          task_id: string;
          owner_member_id: string;
          record_class: string;
        }>(
          `SELECT task_id, owner_member_id, record_class
             FROM public.task
            WHERE task_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [taskId]
        );
        const existing = curRes.rows[0];
        if (!existing) {
          throw new AppApiError(404, 'TASK_NOT_FOUND', `Task ${taskId} not found.`);
        }
        rejectHistoricalWriteRequest(null, existing.record_class);

        if (scope === 'own' && existing.owner_member_id !== actor.memberId) {
          throw new AppApiError(
            403,
            'FORBIDDEN',
            'You can only edit tasks assigned to you.'
          );
        }
        if (
          scope === 'own' &&
          input.ownerMemberId &&
          input.ownerMemberId !== actor.memberId
        ) {
          throw new AppApiError(
            403,
            'FORBIDDEN',
            'You cannot reassign task ownership with your current role.'
          );
        }

        if (input.linkedType && input.linkedId) {
          await assertLinkedRecordExists(client, input.linkedType, input.linkedId);
        }

        const edition = await resolveWritableEditionByClass(
          client,
          existing.record_class,
          config.editionIdDefault
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const sets: string[] = [];
        const params: unknown[] = [];
        const addSet = (col: string, val: unknown, cast = '') => {
          params.push(val);
          sets.push(`${col} = $${params.length}${cast}`);
        };

        if (input.title !== undefined) addSet('title', input.title);
        if (input.taskType !== undefined) addSet('task_type', input.taskType);
        if (input.ownerMemberId !== undefined)
          addSet('owner_member_id', input.ownerMemberId);
        if (input.dueAt !== undefined) addSet('due_at', input.dueAt, '::timestamptz');
        if (input.status !== undefined) {
          addSet('status', input.status);
          if (input.status === 'done') {
            sets.push(`completed_at = COALESCE(completed_at, now())`);
          } else {
            sets.push(`completed_at = NULL`);
          }
        }
        if (input.linkedType !== undefined) addSet('linked_type', input.linkedType);
        if (input.linkedId !== undefined) addSet('linked_id', input.linkedId);
        if (input.betId !== undefined) addSet('bet_id', input.betId);
        if (input.isDeleted === true) addSet('is_deleted', true);

        if (sets.length === 0) {
          throw new AppApiError(400, 'INVALID_ARGUMENT', 'No updatable fields provided.');
        }

        params.push(taskId);
        const updRes = await client.query<Record<string, unknown>>(
          `UPDATE public.task
              SET ${sets.join(', ')}
            WHERE task_id = $${params.length}
              AND NOT is_deleted
            RETURNING *`,
          params
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'TASK',
          entityId: taskId,
          operation: input.isDeleted === true ? 'delete' : 'update',
          after: updRes.rows[0] ?? { task_id: taskId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:tasks',
        });

        return {
          id: taskId,
          dataVersion,
          data_version: dataVersion,
          task: updRes.rows[0],
        };
      });

      res.status(200).json(result);
    })
  );

  // ---------------------------------------------------------------------------
  // 10. PATCH /api/escalations/:id
  // ---------------------------------------------------------------------------
  const UpdateEscalationSchema = z.object({
    status: z.enum(['acknowledged', 'action_taken', 'closed']),
    actionTaken: z.string().trim().max(2000).nullable().optional(),
  });

  router.patch(
    '/escalations/:id',
    authMiddleware,
    roleMiddleware,
    requirePermission('escalations', 'update'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const escalationId = req.params.id;
      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const input = parseWithSchema(UpdateEscalationSchema, {
        status: pick(raw, 'status'),
        actionTaken: pick(raw, 'actionTaken', 'action_taken') ?? null,
      });

      if (input.status === 'closed' && (!input.actionTaken || !input.actionTaken.trim())) {
        throw new AppApiError(
          422,
          'ACTION_TAKEN_REQUIRED',
          'Closing an escalation requires action_taken text.'
        );
      }

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const curRes = await client.query<{
          escalation_id: string;
          owner_member_id: string | null;
          record_class: string;
        }>(
          `SELECT escalation_id, owner_member_id, record_class
             FROM public.escalation
            WHERE escalation_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [escalationId]
        );
        const existing = curRes.rows[0];
        if (!existing) {
          throw new AppApiError(
            404,
            'ESCALATION_NOT_FOUND',
            `Escalation ${escalationId} not found.`
          );
        }
        rejectHistoricalWriteRequest(null, existing.record_class);

        if (scope === 'own' && existing.owner_member_id !== actor.memberId) {
          throw new AppApiError(
            403,
            'FORBIDDEN',
            'You can only update escalations assigned to you.'
          );
        }

        const edition = await resolveWritableEditionByClass(
          client,
          existing.record_class,
          config.editionIdDefault
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const updRes = await client.query<Record<string, unknown>>(
          `UPDATE public.escalation
              SET status = $1,
                  action_taken = COALESCE($2, action_taken),
                  closed_at = ${input.status === 'closed' ? 'COALESCE(closed_at, now())' : 'NULL'}
            WHERE escalation_id = $3
              AND NOT is_deleted
            RETURNING *`,
          [input.status, input.actionTaken ?? null, escalationId]
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'ESCALATION',
          entityId: escalationId,
          operation: 'update',
          after: updRes.rows[0] ?? { escalation_id: escalationId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:escalations',
        });

        return {
          id: escalationId,
          dataVersion,
          data_version: dataVersion,
          escalation: updRes.rows[0],
        };
      });

      res.status(200).json(result);
    })
  );

  // ---------------------------------------------------------------------------
  // 11. POST /api/time-logs
  // ---------------------------------------------------------------------------
  const CreateTimeLogSchema = z.object({
    memberId: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).nullable().optional(),
    betId: z.string().trim().min(1).nullable().optional(),
    taskType: z.enum(TASK_TYPE_VALUES),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'work_date must be YYYY-MM-DD.'),
    hours: z.coerce.number().finite().gt(0).lte(16),
    editionId: z.string().trim().min(1),
  });

  router.post(
    '/time-logs',
    authMiddleware,
    roleMiddleware,
    requirePermission('hours_staffing', 'create'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const { editionId, requestedRecordClass } = extractRequestedEditionAndClass(
        req,
        config.editionIdDefault
      );
      rejectHistoricalWriteRequest(editionId, requestedRecordClass);

      const input = parseWithSchema(CreateTimeLogSchema, {
        memberId: pick(raw, 'memberId', 'member_id') || undefined,
        taskId: pick(raw, 'taskId', 'task_id') || null,
        betId: pick(raw, 'betId', 'bet_id') || null,
        taskType: pick(raw, 'taskType', 'task_type'),
        workDate: pick(raw, 'workDate', 'work_date'),
        hours: pick(raw, 'hours'),
        editionId,
      });

      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      if (scope === 'own' && input.memberId && input.memberId !== actor.memberId) {
        throw new AppApiError(
          403,
          'FORBIDDEN',
          'You can only log hours for yourself.'
        );
      }

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const edition = await resolveWritableEdition(
          client,
          input.editionId,
          requestedRecordClass
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const timeLogId = generatePrefixedId('TL-');
        const targetMember =
          scope === 'own' ? actor.memberId : input.memberId ?? actor.memberId;

        const tlRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.time_log (
             time_log_id, member_id, task_id, bet_id, task_type, work_date, hours,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4, $5, $6::date, $7,
             $8, $9, 'ui:time_logs', 'T', $10
           )
           RETURNING *`,
          [
            timeLogId,
            targetMember,
            input.taskId ?? null,
            input.betId ?? null,
            input.taskType,
            input.workDate,
            input.hours,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'TIME_LOG',
          entityId: timeLogId,
          operation: 'insert',
          after: tlRes.rows[0] ?? { time_log_id: timeLogId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:time_logs',
        });

        return {
          id: timeLogId,
          dataVersion,
          data_version: dataVersion,
          time_log: tlRes.rows[0],
        };
      });

      res.status(201).json(result);
    })
  );

  // ---------------------------------------------------------------------------
  // 12. POST/PATCH /api/network-partners & POST /api/referrals
  // ---------------------------------------------------------------------------
  const CreateNetworkPartnerSchema = z.object({
    partnerType: z.enum(PARTNER_TYPE_VALUES),
    name: z.string().trim().min(1).max(200),
    ownerMemberId: z.string().trim().min(1).nullable().optional(),
    recruitedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    status: z.enum(PARTNER_STATUS_VALUES).default('invited'),
    editionId: z.string().trim().min(1),
  });

  router.post(
    '/network-partners',
    authMiddleware,
    roleMiddleware,
    requirePermission('outreach_interactions_meetings_qualifications', 'create'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const { editionId, requestedRecordClass } = extractRequestedEditionAndClass(
        req,
        config.editionIdDefault
      );
      rejectHistoricalWriteRequest(editionId, requestedRecordClass);

      const input = parseWithSchema(CreateNetworkPartnerSchema, {
        partnerType: pick(raw, 'partnerType', 'partner_type'),
        name: pick(raw, 'name'),
        ownerMemberId: pick(raw, 'ownerMemberId', 'owner_member_id') || null,
        recruitedAt: pick(raw, 'recruitedAt', 'recruited_at') || null,
        status: pick(raw, 'status') ?? 'invited',
        editionId,
      });

      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      if (
        scope === 'own' &&
        input.ownerMemberId &&
        input.ownerMemberId !== actor.memberId
      ) {
        throw new AppApiError(
          403,
          'FORBIDDEN',
          'Sales roles can only create network partners owned by themselves.'
        );
      }

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const edition = await resolveWritableEdition(
          client,
          input.editionId,
          requestedRecordClass
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const partnerId = generatePrefixedId('NP-');
        const ownerId =
          scope === 'own' ? actor.memberId : input.ownerMemberId ?? actor.memberId;

        const npRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.network_partner (
             partner_id, partner_type, name, owner_member_id, recruited_at, status,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4, $5::date, $6,
             $7, $8, 'ui:network_partners', 'T', $9
           )
           RETURNING *`,
          [
            partnerId,
            input.partnerType,
            input.name,
            ownerId,
            input.recruitedAt ?? null,
            input.status,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'NETWORK_PARTNER',
          entityId: partnerId,
          operation: 'insert',
          after: npRes.rows[0] ?? { partner_id: partnerId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:network_partners',
        });

        return {
          id: partnerId,
          dataVersion,
          data_version: dataVersion,
          network_partner: npRes.rows[0],
        };
      });

      res.status(201).json(result);
    })
  );

  const UpdateNetworkPartnerSchema = z.object({
    partnerType: z.enum(PARTNER_TYPE_VALUES).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    ownerMemberId: z.string().trim().min(1).nullable().optional(),
    recruitedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    status: z.enum(PARTNER_STATUS_VALUES).optional(),
    isDeleted: z.literal(true).optional(),
  });

  router.patch(
    '/network-partners/:id',
    authMiddleware,
    roleMiddleware,
    requirePermission('outreach_interactions_meetings_qualifications', 'update'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const partnerId = req.params.id;
      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const input = parseWithSchema(UpdateNetworkPartnerSchema, {
        partnerType: pick(raw, 'partnerType', 'partner_type'),
        name: pick(raw, 'name'),
        ownerMemberId: hasAnyKey(raw, 'ownerMemberId', 'owner_member_id')
          ? pick(raw, 'ownerMemberId', 'owner_member_id') || null
          : undefined,
        recruitedAt: hasAnyKey(raw, 'recruitedAt', 'recruited_at')
          ? pick(raw, 'recruitedAt', 'recruited_at') || null
          : undefined,
        status: pick(raw, 'status'),
        isDeleted: pick(raw, 'isDeleted', 'is_deleted'),
      });

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const curRes = await client.query<{
          partner_id: string;
          owner_member_id: string | null;
          record_class: string;
        }>(
          `SELECT partner_id, owner_member_id, record_class
             FROM public.network_partner
            WHERE partner_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [partnerId]
        );
        const existing = curRes.rows[0];
        if (!existing) {
          throw new AppApiError(
            404,
            'NETWORK_PARTNER_NOT_FOUND',
            `Network partner ${partnerId} not found.`
          );
        }
        rejectHistoricalWriteRequest(null, existing.record_class);

        if (scope === 'own' && existing.owner_member_id !== actor.memberId) {
          throw new AppApiError(
            403,
            'FORBIDDEN',
            'You can only edit network partners owned by you.'
          );
        }

        const edition = await resolveWritableEditionByClass(
          client,
          existing.record_class,
          config.editionIdDefault
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const sets: string[] = [];
        const params: unknown[] = [];
        const addSet = (col: string, val: unknown, cast = '') => {
          params.push(val);
          sets.push(`${col} = $${params.length}${cast}`);
        };
        if (input.partnerType !== undefined) addSet('partner_type', input.partnerType);
        if (input.name !== undefined) addSet('name', input.name);
        if (input.ownerMemberId !== undefined)
          addSet('owner_member_id', input.ownerMemberId);
        if (input.recruitedAt !== undefined)
          addSet('recruited_at', input.recruitedAt, '::date');
        if (input.status !== undefined) addSet('status', input.status);
        if (input.isDeleted === true) addSet('is_deleted', true);

        if (sets.length === 0) {
          throw new AppApiError(400, 'INVALID_ARGUMENT', 'No updatable fields provided.');
        }

        params.push(partnerId);
        const updRes = await client.query<Record<string, unknown>>(
          `UPDATE public.network_partner
              SET ${sets.join(', ')}
            WHERE partner_id = $${params.length}
              AND NOT is_deleted
            RETURNING *`,
          params
        );

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'NETWORK_PARTNER',
          entityId: partnerId,
          operation: input.isDeleted === true ? 'delete' : 'update',
          after: updRes.rows[0] ?? { partner_id: partnerId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:network_partners',
        });

        return {
          id: partnerId,
          dataVersion,
          data_version: dataVersion,
          network_partner: updRes.rows[0],
        };
      });

      res.status(200).json(result);
    })
  );

  const CreateReferralSchema = z.object({
    referralId: z.string().trim().min(1).nullable().optional(),
    partnerId: z.string().trim().min(1),
    sponsorId: z.string().trim().min(1),
    contactId: z.string().trim().min(1).nullable().optional(),
    campaignId: z.string().trim().min(1).nullable().optional(),
    commitmentStatus: z.enum(REFERRAL_STATUS_VALUES),
    committedAt: z.string().trim().nullable().optional(),
    askSentAt: z.string().trim().nullable().optional(),
  });

  router.post(
    '/referrals',
    authMiddleware,
    roleMiddleware,
    requirePermission('outreach_interactions_meetings_qualifications', 'create'),
    asyncHandler(async (req: Request, res: Response) => {
      const raw = asBodyObj(req);
      const actor = getVerifiedActor(req);
      const { scope } = getDecision(req);

      const input = parseWithSchema(CreateReferralSchema, {
        referralId: pick(raw, 'referralId', 'referral_id') || null,
        partnerId: pick(raw, 'partnerId', 'partner_id'),
        sponsorId: pick(raw, 'sponsorId', 'sponsor_id'),
        contactId: pick(raw, 'contactId', 'contact_id') || null,
        campaignId: pick(raw, 'campaignId', 'campaign_id') || null,
        commitmentStatus: pick(raw, 'commitmentStatus', 'commitment_status'),
        committedAt: pick(raw, 'committedAt', 'committed_at') || null,
        askSentAt: pick(raw, 'askSentAt', 'ask_sent_at') || null,
      });

      if (input.commitmentStatus === 'committed' && !input.contactId) {
        throw new AppApiError(
          422,
          'INV_04_VIOLATION',
          'INV-04: Committed introduction requires a named contact_id.'
        );
      }

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const npRes = await client.query<{
          partner_id: string;
          owner_member_id: string | null;
          record_class: string;
        }>(
          `SELECT partner_id, owner_member_id, record_class
             FROM public.network_partner
            WHERE partner_id = $1
              AND NOT is_deleted
            LIMIT 1`,
          [input.partnerId]
        );
        const partner = npRes.rows[0];
        if (!partner) {
          throw new AppApiError(
            404,
            'NETWORK_PARTNER_NOT_FOUND',
            `Network partner ${input.partnerId} not found.`
          );
        }
        rejectHistoricalWriteRequest(null, partner.record_class);

        if (scope === 'own') {
          const ownsSponsor = await isSponsorOwner(
            client,
            input.sponsorId,
            actor.memberId,
            partner.record_class
          );
          if (partner.owner_member_id !== actor.memberId && !ownsSponsor) {
            throw new AppApiError(
              403,
              'FORBIDDEN',
              'You can only create or update referrals for your own network partners or sponsors.'
            );
          }
        }

        const edition = await resolveWritableEditionByClass(
          client,
          partner.record_class,
          config.editionIdDefault
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        let nextVersion = 1;
        let supersededId: string | null = null;
        if (input.referralId) {
          const prevRes = await client.query<{
            referral_id: string;
            version_no: number;
          }>(
            `UPDATE public.referral
                SET valid_to = now()
              WHERE referral_id = $1
                AND valid_to IS NULL
                AND NOT is_deleted
              RETURNING referral_id, version_no`,
            [input.referralId]
          );
          if (prevRes.rows[0]) {
            supersededId = prevRes.rows[0].referral_id;
            nextVersion = Number(prevRes.rows[0].version_no ?? 1) + 1;
          }
        } else {
          const prevActive = await client.query<{
            referral_id: string;
            version_no: number;
          }>(
            `UPDATE public.referral
                SET valid_to = now()
              WHERE partner_id = $1
                AND sponsor_id = $2
                AND record_class = $3
                AND valid_to IS NULL
                AND NOT is_deleted
              RETURNING referral_id, version_no`,
            [input.partnerId, input.sponsorId, edition.recordClass]
          );
          if (prevActive.rows[0]) {
            supersededId = prevActive.rows[0].referral_id;
            nextVersion = Number(prevActive.rows[0].version_no ?? 1) + 1;
          }
        }

        const referralId = generatePrefixedId('RF-');
        const rfRes = await client.query<Record<string, unknown>>(
          `INSERT INTO public.referral (
             referral_id, partner_id, sponsor_id, contact_id, campaign_id,
             commitment_status, committed_at, ask_sent_at, version_no,
             record_class, import_batch_id, source_ref, evidence_class, created_by
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6, $7::timestamptz, $8::timestamptz, $9,
             $10, $11, 'ui:referrals', 'T', $12
           )
           RETURNING *`,
          [
            referralId,
            input.partnerId,
            input.sponsorId,
            input.contactId ?? null,
            input.campaignId ?? null,
            input.commitmentStatus,
            input.committedAt ??
              (input.commitmentStatus === 'committed' ? new Date().toISOString() : null),
            input.askSentAt ?? null,
            nextVersion,
            edition.recordClass,
            batchId,
            actor.memberId,
          ]
        );

        if (supersededId) {
          await client.query(
            `UPDATE public.referral SET superseded_by = $1 WHERE referral_id = $2`,
            [referralId, supersededId]
          );
        }

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'REFERRAL',
          entityId: referralId,
          operation: 'insert',
          after: rfRes.rows[0] ?? { referral_id: referralId },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:referrals',
        });

        return {
          id: referralId,
          dataVersion,
          data_version: dataVersion,
          referral: rfRes.rows[0],
        };
      });

      res.status(201).json(result);
    })
  );

  return router;
}
