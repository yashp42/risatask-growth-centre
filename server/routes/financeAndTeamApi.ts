import { Router, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getVerifiedActor, requireAuth, type AuthDependencies } from '../auth.ts';
import type { ServerConfig } from '../config.ts';
import type { DatabasePoolState } from '../db.ts';
import { AppApiError, asyncHandler } from '../errors.ts';
import { CANONICAL_ROLE_SET, type CanonicalRole } from '../permissions.ts';
import {
  ensureUiImportBatch,
  extractRequestedEditionAndClass,
  fetchAppDataVersion,
  generatePrefixedId,
  insertAuditEvent,
  rejectHistoricalWriteRequest,
  requireWriteRoles,
  resolveWritableEdition,
  resolveWritableEditionByClass,
  runWriteTransaction,
  type WritableEditionInfo,
} from '../writeUtils.ts';

const PAYMENT_SCHEDULE_KINDS = ['advance', 'balance', 'other'] as const;
const PAYMENT_TERMS_VALUES = ['standard_50_50', '100_upfront', 'custom'] as const;
const RECEIPT_METHOD_VALUES = ['bank_transfer', 'upi', 'cheque'] as const;

function normalizeReceiptMethod(
  raw: string
): (typeof RECEIPT_METHOD_VALUES)[number] {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, '_');
  if (cleaned === 'bank_transfer' || cleaned === 'upi' || cleaned === 'cheque') {
    return cleaned;
  }
  throw new AppApiError(
    400,
    'INVALID_ARGUMENT',
    'method must be bank_transfer, upi, or cheque.'
  );
}

function normalizePaymentTerms(
  raw: string
): (typeof PAYMENT_TERMS_VALUES)[number] {
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === 'standard_50_50' || cleaned === 'standard 50/50') {
    return 'standard_50_50';
  }
  if (cleaned === '100_upfront' || cleaned === '100% upfront') {
    return '100_upfront';
  }
  if (cleaned === 'custom') {
    return 'custom';
  }
  throw new AppApiError(
    400,
    'INVALID_ARGUMENT',
    'paymentTerms must be standard_50_50, 100_upfront, or custom.'
  );
}

function normalizeTimestampInput(raw: string, fieldName: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00+05:30`;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new AppApiError(
      400,
      'INVALID_ARGUMENT',
      `${fieldName} must be a valid ISO timestamp or date.`
    );
  }
  return trimmed;
}

function parseBodyWithSchema<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown
): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    throw new AppApiError(
      400,
      'VALIDATION_ERROR',
      `${path}${issue?.message ?? 'Invalid request payload.'}`
    );
  }
  return result.data;
}

function assertFinanceRole(req: Request): void {
  const roles = req.resolvedMember?.roles ?? [];
  if (!roles.includes('finance_collections')) {
    throw new AppApiError(
      403,
      'FORBIDDEN',
      'Only finance_collections may perform financial writes.'
    );
  }
}

function assertTeamAdminRole(req: Request): void {
  const roles = req.resolvedMember?.roles ?? [];
  if (!roles.includes('coordination_lead') && !roles.includes('admin')) {
    throw new AppApiError(
      403,
      'FORBIDDEN',
      'Only coordination_lead or admin may manage team members and roles.'
    );
  }
}

async function resolveContractEdition(
  client: PoolClient,
  contractId: string,
  requestedEditionId?: string | null,
  requestedRecordClass?: string | null
): Promise<WritableEditionInfo> {
  const res = await client.query<{
    contract_id: string;
    edition_id: string;
    record_class: string;
  }>(
    `SELECT c.contract_id, o.edition_id, c.record_class
       FROM public.contract c
       JOIN public.opportunity o ON o.opportunity_id = c.opportunity_id
      WHERE c.contract_id = $1
        AND c.valid_to IS NULL
        AND NOT c.is_deleted
      LIMIT 1`,
    [contractId]
  );

  const row = res.rows[0];
  if (!row) {
    throw new AppApiError(
      404,
      'NOT_FOUND',
      `Active contract "${contractId}" was not found.`
    );
  }

  rejectHistoricalWriteRequest(row.edition_id, row.record_class);
  if (row.record_class !== 'live' && row.record_class !== 'simulated') {
    throw new AppApiError(
      403,
      'READ_ONLY_EDITION',
      `Contract "${contractId}" belongs to read-only record_class "${row.record_class}".`
    );
  }

  if (requestedRecordClass && requestedRecordClass !== row.record_class) {
    throw new AppApiError(
      422,
      'RECORD_CLASS_MISMATCH',
      `Contract "${contractId}" is in record_class "${row.record_class}", not "${requestedRecordClass}".`
    );
  }
  if (requestedEditionId && requestedEditionId !== row.edition_id) {
    throw new AppApiError(
      422,
      'EDITION_MISMATCH',
      `Contract "${contractId}" belongs to edition "${row.edition_id}", not "${requestedEditionId}".`
    );
  }

  return {
    editionId: row.edition_id,
    recordClass: row.record_class,
  };
}

async function resolveEditionForWrite(
  client: PoolClient,
  req: Request,
  defaultEditionId: string
): Promise<WritableEditionInfo> {
  const body =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};
  const explicitEdition =
    typeof body.editionId === 'string' && body.editionId.trim()
      ? body.editionId.trim()
      : typeof body.edition_id === 'string' && body.edition_id.trim()
        ? body.edition_id.trim()
        : null;
  const { editionId, requestedRecordClass } = extractRequestedEditionAndClass(
    req,
    defaultEditionId
  );

  if (!explicitEdition && requestedRecordClass) {
    return resolveWritableEditionByClass(
      client,
      requestedRecordClass,
      defaultEditionId
    );
  }
  return resolveWritableEdition(client, editionId, requestedRecordClass);
}

const createScheduleSchema = z
  .object({
    contractId: z.string().trim().min(1).optional(),
    contract_id: z.string().trim().min(1).optional(),
    kind: z.enum(PAYMENT_SCHEDULE_KINDS),
    amountDue: z.coerce.number().positive().optional(),
    amount_due: z.coerce.number().positive().optional(),
    dueDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD')
      .optional(),
    due_date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'due_date must be YYYY-MM-DD')
      .optional(),
    editionId: z.string().trim().optional(),
    edition_id: z.string().trim().optional(),
    recordClass: z.string().trim().optional(),
    record_class: z.string().trim().optional(),
  })
  .refine((d) => Boolean(d.contractId ?? d.contract_id), {
    message: 'contractId is required.',
  })
  .refine((d) => (d.amountDue ?? d.amount_due) !== undefined, {
    message: 'amountDue is required and must be greater than zero.',
  })
  .refine((d) => Boolean(d.dueDate ?? d.due_date), {
    message: 'dueDate is required.',
  });

const createInvoiceSchema = z
  .object({
    contractId: z.string().trim().min(1).optional(),
    contract_id: z.string().trim().min(1).optional(),
    scheduleItemId: z.string().trim().min(1).nullable().optional(),
    schedule_item_id: z.string().trim().min(1).nullable().optional(),
    invoiceNo: z.string().trim().min(1).max(80).optional(),
    invoice_no: z.string().trim().min(1).max(80).optional(),
    issuedAt: z.string().trim().min(1).optional(),
    issued_at: z.string().trim().min(1).optional(),
    amount: z.coerce.number().positive(),
    taxAmount: z.coerce.number().min(0).nullable().optional(),
    tax_amount: z.coerce.number().min(0).nullable().optional(),
    documentUri: z.string().trim().max(500).nullable().optional(),
    document_uri: z.string().trim().max(500).nullable().optional(),
    editionId: z.string().trim().optional(),
    edition_id: z.string().trim().optional(),
    recordClass: z.string().trim().optional(),
    record_class: z.string().trim().optional(),
  })
  .refine((d) => Boolean(d.contractId ?? d.contract_id), {
    message: 'contractId is required.',
  })
  .refine((d) => Boolean(d.invoiceNo ?? d.invoice_no), {
    message: 'invoiceNo is required.',
  })
  .refine((d) => Boolean(d.issuedAt ?? d.issued_at), {
    message: 'issuedAt is required.',
  });

const cancelInvoiceSchema = z.object({
  reason: z.string().trim().min(2, 'Cancellation reason is required.').max(500),
  editionId: z.string().trim().optional(),
  edition_id: z.string().trim().optional(),
  recordClass: z.string().trim().optional(),
  record_class: z.string().trim().optional(),
});

const createReceiptSchema = z
  .object({
    sponsorId: z.string().trim().min(1).optional(),
    sponsor_id: z.string().trim().min(1).optional(),
    receivedAt: z.string().trim().min(1).optional(),
    received_at: z.string().trim().min(1).optional(),
    amount: z.coerce.number().positive(),
    method: z.string().trim().min(1),
    bankReference: z.string().trim().min(1).max(120).optional(),
    bank_reference: z.string().trim().min(1).max(120).optional(),
    reconciled: z.boolean().optional(),
    editionId: z.string().trim().optional(),
    edition_id: z.string().trim().optional(),
    recordClass: z.string().trim().optional(),
    record_class: z.string().trim().optional(),
  })
  .refine((d) => Boolean(d.sponsorId ?? d.sponsor_id), {
    message: 'sponsorId is required.',
  })
  .refine((d) => Boolean(d.receivedAt ?? d.received_at), {
    message: 'receivedAt is required.',
  })
  .refine((d) => Boolean(d.bankReference ?? d.bank_reference), {
    message: 'bankReference is required.',
  });

const allocateReceiptSchema = z
  .object({
    receiptId: z.string().trim().min(1).optional(),
    receipt_id: z.string().trim().min(1).optional(),
    invoiceId: z.string().trim().min(1).nullable().optional(),
    invoice_id: z.string().trim().min(1).nullable().optional(),
    scheduleItemId: z.string().trim().min(1).nullable().optional(),
    schedule_item_id: z.string().trim().min(1).nullable().optional(),
    amount: z.coerce.number().positive(),
    editionId: z.string().trim().optional(),
    edition_id: z.string().trim().optional(),
    recordClass: z.string().trim().optional(),
    record_class: z.string().trim().optional(),
  })
  .refine((d) => Boolean(d.receiptId ?? d.receipt_id), {
    message: 'receiptId is required.',
  })
  .refine(
    (d) =>
      Boolean(
        (d.invoiceId ?? d.invoice_id) ||
          (d.scheduleItemId ?? d.schedule_item_id)
      ),
    {
      message: 'At least one of invoiceId or scheduleItemId is required.',
    }
  );

const reconcileReceiptSchema = z.object({
  editionId: z.string().trim().optional(),
  edition_id: z.string().trim().optional(),
  recordClass: z.string().trim().optional(),
  record_class: z.string().trim().optional(),
});

const createTeamMemberSchema = z
  .object({
    fullName: z.string().trim().min(2).max(160).optional(),
    full_name: z.string().trim().min(2).max(160).optional(),
    email: z.string().trim().email().max(200).nullable().optional(),
    editionId: z.string().trim().optional(),
    edition_id: z.string().trim().optional(),
    recordClass: z.string().trim().optional(),
    record_class: z.string().trim().optional(),
  })
  .refine((d) => Boolean(d.fullName ?? d.full_name), {
    message: 'fullName is required.',
  });

const linkAuthUserSchema = z
  .object({
    authUserId: z.string().trim().uuid('authUserId must be a valid UUID.').optional(),
    auth_user_id: z.string().trim().uuid('auth_user_id must be a valid UUID.').optional(),
    editionId: z.string().trim().optional(),
    edition_id: z.string().trim().optional(),
    recordClass: z.string().trim().optional(),
    record_class: z.string().trim().optional(),
  })
  .refine((d) => Boolean(d.authUserId ?? d.auth_user_id), {
    message: 'authUserId is required.',
  });

const assignRoleSchema = z
  .object({
    memberId: z.string().trim().min(1).optional(),
    member_id: z.string().trim().min(1).optional(),
    role: z
      .string()
      .trim()
      .refine((v): v is CanonicalRole => CANONICAL_ROLE_SET.has(v as CanonicalRole), {
        message: 'Invalid canonical role.',
      }),
    editionId: z.string().trim().optional(),
    edition_id: z.string().trim().optional(),
    recordClass: z.string().trim().optional(),
    record_class: z.string().trim().optional(),
  })
  .refine((d) => Boolean(d.memberId ?? d.member_id), {
    message: 'memberId is required.',
  });

const endRoleSchema = z.object({
  editionId: z.string().trim().optional(),
  edition_id: z.string().trim().optional(),
  recordClass: z.string().trim().optional(),
  record_class: z.string().trim().optional(),
});

export function createFinanceAndTeamApiRouter(
  config: ServerConfig,
  dbState: DatabasePoolState,
  authDeps: AuthDependencies
): Router {
  const router = Router();
  const authMiddleware = requireAuth(authDeps);
  const resolveRolesMiddleware = requireWriteRoles(authDeps);

  // ---------------------------------------------------------------------------
  // 1. POST /api/collections/schedule (+ /api/payment-schedule alias)
  // ---------------------------------------------------------------------------
  const handleCreateSchedule = asyncHandler(
    async (req: Request, res: Response) => {
      assertFinanceRole(req);
      const actor = getVerifiedActor(req);
      const body = parseBodyWithSchema(createScheduleSchema, req.body);

      const contractId = (body.contractId ?? body.contract_id)!;
      const amountDue = (body.amountDue ?? body.amount_due)!;
      const dueDate = (body.dueDate ?? body.due_date)!;
      const requestedEdition = body.editionId ?? body.edition_id ?? null;
      const requestedClass = body.recordClass ?? body.record_class ?? null;

      rejectHistoricalWriteRequest(requestedEdition, requestedClass);

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const edition = await resolveContractEdition(
          client,
          contractId,
          requestedEdition,
          requestedClass
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );
        const scheduleItemId = generatePrefixedId('PS-');
        const rpcRes = await client.query<{
          schedule_item_id: string;
          contract_id: string;
          record_class: 'live' | 'simulated';
          data_version: string | number;
        }>(
          `SELECT schedule_item_id, contract_id, record_class, data_version
             FROM public.record_payment_schedule_item(
               $1, $2, $3, $4, $5::date, $6, $7, $8
             )`,
          [
            scheduleItemId,
            contractId,
            body.kind,
            amountDue,
            dueDate,
            batchId,
            'ui:/collections/schedule',
            'T',
          ]
        );
        const row = rpcRes.rows[0];
        if (!row) {
          throw new AppApiError(
            500,
            'RPC_EMPTY_RESULT',
            'record_payment_schedule_item returned no result.'
          );
        }
        return {
          scheduleItemId: row.schedule_item_id,
          contractId: row.contract_id,
          recordClass: row.record_class,
          dataVersion: Number(row.data_version),
        };
      });

      res.status(201).json({
        id: result.scheduleItemId,
        schedule_item_id: result.scheduleItemId,
        contract_id: result.contractId,
        kind: body.kind,
        amount_due: amountDue,
        due_date: dueDate,
        record_class: result.recordClass,
        data_version: result.dataVersion,
        dataVersion: result.dataVersion,
        schedule_item: {
          schedule_item_id: result.scheduleItemId,
          contract_id: result.contractId,
          kind: body.kind,
          amount_due: amountDue,
          due_date: dueDate,
          status: 'due',
          derived_status: 'due',
          allocated_amount: 0,
          remaining_amount: amountDue,
          record_class: result.recordClass,
          data_version: result.dataVersion,
        },
      });
    }
  );

  router.post(
    '/collections/schedule',
    authMiddleware,
    resolveRolesMiddleware,
    handleCreateSchedule
  );
  router.post(
    '/payment-schedule',
    authMiddleware,
    resolveRolesMiddleware,
    handleCreateSchedule
  );

  // ---------------------------------------------------------------------------
  // 2. POST /api/collections/invoices (+ /api/invoices alias)
  // ---------------------------------------------------------------------------
  const handleCreateInvoice = asyncHandler(
    async (req: Request, res: Response) => {
      assertFinanceRole(req);
      const actor = getVerifiedActor(req);
      const body = parseBodyWithSchema(createInvoiceSchema, req.body);

      const contractId = (body.contractId ?? body.contract_id)!;
      const scheduleItemId =
        body.scheduleItemId ?? body.schedule_item_id ?? null;
      const invoiceNo = (body.invoiceNo ?? body.invoice_no)!;
      const issuedAt = normalizeTimestampInput(
        (body.issuedAt ?? body.issued_at)!,
        'issuedAt'
      );
      const taxAmount = body.taxAmount ?? body.tax_amount ?? 0;
      const documentUri = body.documentUri ?? body.document_uri ?? null;
      const requestedEdition = body.editionId ?? body.edition_id ?? null;
      const requestedClass = body.recordClass ?? body.record_class ?? null;

      rejectHistoricalWriteRequest(requestedEdition, requestedClass);

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const edition = await resolveContractEdition(
          client,
          contractId,
          requestedEdition,
          requestedClass
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );
        const invoiceId = generatePrefixedId('IV-');
        const rpcRes = await client.query<{
          invoice_id: string;
          invoice_no: string;
          record_class: 'live' | 'simulated';
          data_version: string | number;
        }>(
          `SELECT invoice_id, invoice_no, record_class, data_version
             FROM public.record_invoice(
               $1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9, $10, $11
             )`,
          [
            invoiceId,
            invoiceNo,
            contractId,
            scheduleItemId,
            issuedAt,
            body.amount,
            taxAmount,
            documentUri,
            batchId,
            'ui:/collections/invoices',
            'T',
          ]
        );
        const row = rpcRes.rows[0];
        if (!row) {
          throw new AppApiError(
            500,
            'RPC_EMPTY_RESULT',
            'record_invoice returned no result.'
          );
        }
        return {
          invoiceId: row.invoice_id,
          invoiceNo: row.invoice_no,
          recordClass: row.record_class,
          dataVersion: Number(row.data_version),
        };
      });

      res.status(201).json({
        id: result.invoiceId,
        invoice_id: result.invoiceId,
        invoice_no: result.invoiceNo,
        contract_id: contractId,
        schedule_item_id: scheduleItemId,
        issued_at: issuedAt,
        amount: body.amount,
        tax_amount: taxAmount,
        status: 'issued',
        document_uri: documentUri,
        record_class: result.recordClass,
        data_version: result.dataVersion,
        dataVersion: result.dataVersion,
        invoice: {
          invoice_id: result.invoiceId,
          invoice_no: result.invoiceNo,
          contract_id: contractId,
          schedule_item_id: scheduleItemId,
          issued_at: issuedAt,
          amount: body.amount,
          tax_amount: taxAmount,
          status: 'issued',
          document_uri: documentUri,
          record_class: result.recordClass,
          data_version: result.dataVersion,
        },
      });
    }
  );

  router.post(
    '/collections/invoices',
    authMiddleware,
    resolveRolesMiddleware,
    handleCreateInvoice
  );
  router.post(
    '/invoices',
    authMiddleware,
    resolveRolesMiddleware,
    handleCreateInvoice
  );

  // ---------------------------------------------------------------------------
  // 3. POST /api/collections/invoices/:id/cancel (+ /api/invoices/:id/cancel)
  // ---------------------------------------------------------------------------
  const handleCancelInvoice = asyncHandler(
    async (req: Request, res: Response) => {
      assertFinanceRole(req);
      const actor = getVerifiedActor(req);
      const invoiceId = String(req.params.id ?? '').trim();
      if (!invoiceId) {
        throw new AppApiError(400, 'INVALID_ARGUMENT', 'Invoice ID is required.');
      }
      const body = parseBodyWithSchema(cancelInvoiceSchema, req.body);

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const lookupRes = await client.query<{
          edition_id: string;
          record_class: string;
        }>(
          `SELECT o.edition_id, inv.record_class
             FROM public.invoice inv
             JOIN public.contract c ON c.contract_id = inv.contract_id
             JOIN public.opportunity o ON o.opportunity_id = c.opportunity_id
            WHERE inv.invoice_id = $1
              AND NOT inv.is_deleted
            LIMIT 1`,
          [invoiceId]
        );

        let edition: WritableEditionInfo;
        if (lookupRes.rows[0]) {
          const found = lookupRes.rows[0];
          rejectHistoricalWriteRequest(found.edition_id, found.record_class);
          edition = await resolveWritableEdition(
            client,
            found.edition_id,
            body.recordClass ?? body.record_class ?? null
          );
        } else {
          edition = await resolveEditionForWrite(
            client,
            req,
            config.editionIdDefault
          );
        }

        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const rpcRes = await client.query<{
          invoice_id: string;
          status: string;
          data_version: string | number;
        }>(
          `SELECT invoice_id, status, data_version
             FROM public.cancel_invoice($1, $2, $3, $4, $5, $6)`,
          [
            edition.editionId,
            invoiceId,
            body.reason,
            batchId,
            'ui:/collections/invoices/cancel',
            'T',
          ]
        );
        const row = rpcRes.rows[0];
        if (!row) {
          throw new AppApiError(
            500,
            'RPC_EMPTY_RESULT',
            'cancel_invoice returned no result.'
          );
        }
        return {
          invoiceId: row.invoice_id,
          status: row.status,
          dataVersion: Number(row.data_version),
        };
      });

      res.status(200).json({
        id: result.invoiceId,
        invoice_id: result.invoiceId,
        status: result.status,
        data_version: result.dataVersion,
        dataVersion: result.dataVersion,
      });
    }
  );

  router.post(
    '/collections/invoices/:id/cancel',
    authMiddleware,
    resolveRolesMiddleware,
    handleCancelInvoice
  );
  router.post(
    '/invoices/:id/cancel',
    authMiddleware,
    resolveRolesMiddleware,
    handleCancelInvoice
  );

  // ---------------------------------------------------------------------------
  // 4. POST /api/collections/receipts (+ /api/receipts alias)
  // ---------------------------------------------------------------------------
  const handleCreateReceipt = asyncHandler(
    async (req: Request, res: Response) => {
      assertFinanceRole(req);
      const actor = getVerifiedActor(req);
      const body = parseBodyWithSchema(createReceiptSchema, req.body);

      if (body.reconciled === true) {
        throw new AppApiError(
          422,
          'UNRECONCILED_FIRST_REQUIRED',
          'Receipts are always recorded unreconciled (reconciled = false); reconcile in a separate step.'
        );
      }

      const sponsorId = (body.sponsorId ?? body.sponsor_id)!;
      const receivedAt = normalizeTimestampInput(
        (body.receivedAt ?? body.received_at)!,
        'receivedAt'
      );
      const method = normalizeReceiptMethod(body.method);
      const bankReference = (body.bankReference ?? body.bank_reference)!;

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const edition = await resolveEditionForWrite(
          client,
          req,
          config.editionIdDefault
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );
        const receiptId = generatePrefixedId('RC-');

        const rpcRes = await client.query<{
          receipt_id: string;
          sponsor_id: string;
          reconciled: boolean;
          record_class: 'live' | 'simulated';
          data_version: string | number;
        }>(
          `SELECT receipt_id, sponsor_id, reconciled, record_class, data_version
             FROM public.record_receipt(
               $1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10
             )`,
          [
            edition.editionId,
            receiptId,
            sponsorId,
            receivedAt,
            body.amount,
            method,
            bankReference,
            batchId,
            'ui:/collections/receipts',
            'D',
          ]
        );
        const row = rpcRes.rows[0];
        if (!row) {
          throw new AppApiError(
            500,
            'RPC_EMPTY_RESULT',
            'record_receipt returned no result.'
          );
        }
        return {
          receiptId: row.receipt_id,
          sponsorId: row.sponsor_id,
          reconciled: Boolean(row.reconciled),
          recordClass: row.record_class,
          dataVersion: Number(row.data_version),
        };
      });

      res.status(201).json({
        id: result.receiptId,
        receipt_id: result.receiptId,
        sponsor_id: result.sponsorId,
        received_at: receivedAt,
        amount: body.amount,
        method,
        bank_reference: bankReference,
        reconciled: result.reconciled,
        record_class: result.recordClass,
        data_version: result.dataVersion,
        dataVersion: result.dataVersion,
        receipt: {
          receipt_id: result.receiptId,
          sponsor_id: result.sponsorId,
          received_at: receivedAt,
          amount: body.amount,
          method,
          bank_reference: bankReference,
          reconciled: result.reconciled,
          unreconciled: !result.reconciled,
          reconciled_at: null,
          recorded_by: actor.memberId,
          record_class: result.recordClass,
          data_version: result.dataVersion,
        },
      });
    }
  );

  router.post(
    '/collections/receipts',
    authMiddleware,
    resolveRolesMiddleware,
    handleCreateReceipt
  );
  router.post(
    '/receipts',
    authMiddleware,
    resolveRolesMiddleware,
    handleCreateReceipt
  );

  // ---------------------------------------------------------------------------
  // 5. POST /api/collections/allocations
  // ---------------------------------------------------------------------------
  router.post(
    '/collections/allocations',
    authMiddleware,
    resolveRolesMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      assertFinanceRole(req);
      const actor = getVerifiedActor(req);
      const body = parseBodyWithSchema(allocateReceiptSchema, req.body);

      const receiptId = (body.receiptId ?? body.receipt_id)!;
      const invoiceId = body.invoiceId ?? body.invoice_id ?? null;
      const scheduleItemId =
        body.scheduleItemId ?? body.schedule_item_id ?? null;

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const receiptLookup = await client.query<{ record_class: string }>(
          `SELECT record_class
             FROM public.receipt
            WHERE receipt_id = $1 AND NOT is_deleted
            LIMIT 1`,
          [receiptId]
        );
        let edition: WritableEditionInfo;
        if (receiptLookup.rows[0]) {
          const rClass = receiptLookup.rows[0].record_class;
          rejectHistoricalWriteRequest(null, rClass);
          const explicitEd = body.editionId ?? body.edition_id ?? null;
          if (explicitEd) {
            edition = await resolveWritableEdition(client, explicitEd, rClass);
          } else {
            edition = await resolveWritableEditionByClass(
              client,
              rClass,
              config.editionIdDefault
            );
          }
        } else {
          edition = await resolveEditionForWrite(
            client,
            req,
            config.editionIdDefault
          );
        }

        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );
        const allocationId = generatePrefixedId('AL-');

        const rpcRes = await client.query<{
          allocation_id: string;
          receipt_id: string;
          record_class: 'live' | 'simulated';
          data_version: string | number;
        }>(
          `SELECT allocation_id, receipt_id, record_class, data_version
             FROM public.allocate_receipt(
               $1, $2, $3, $4, $5, $6, $7, $8, $9
             )`,
          [
            edition.editionId,
            allocationId,
            receiptId,
            invoiceId,
            scheduleItemId,
            body.amount,
            batchId,
            'ui:/collections/allocations',
            'D',
          ]
        );
        const row = rpcRes.rows[0];
        if (!row) {
          throw new AppApiError(
            500,
            'RPC_EMPTY_RESULT',
            'allocate_receipt returned no result.'
          );
        }
        return {
          allocationId: row.allocation_id,
          receiptId: row.receipt_id,
          recordClass: row.record_class,
          dataVersion: Number(row.data_version),
        };
      });

      res.status(201).json({
        id: result.allocationId,
        allocation_id: result.allocationId,
        receipt_id: result.receiptId,
        invoice_id: invoiceId,
        schedule_item_id: scheduleItemId,
        amount: body.amount,
        record_class: result.recordClass,
        data_version: result.dataVersion,
        dataVersion: result.dataVersion,
        allocation: {
          allocation_id: result.allocationId,
          receipt_id: result.receiptId,
          invoice_id: invoiceId,
          schedule_item_id: scheduleItemId,
          amount: body.amount,
          record_class: result.recordClass,
        },
      });
    })
  );

  // ---------------------------------------------------------------------------
  // 6. POST /api/collections/receipts/:id/reconcile
  // ---------------------------------------------------------------------------
  router.post(
    '/collections/receipts/:id/reconcile',
    authMiddleware,
    resolveRolesMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      assertFinanceRole(req);
      const actor = getVerifiedActor(req);
      const receiptId = String(req.params.id ?? '').trim();
      if (!receiptId) {
        throw new AppApiError(400, 'INVALID_ARGUMENT', 'Receipt ID is required.');
      }
      const body = parseBodyWithSchema(reconcileReceiptSchema, req.body ?? {});

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const receiptLookup = await client.query<{ record_class: string }>(
          `SELECT record_class
             FROM public.receipt
            WHERE receipt_id = $1 AND NOT is_deleted
            LIMIT 1`,
          [receiptId]
        );
        let edition: WritableEditionInfo;
        if (receiptLookup.rows[0]) {
          const rClass = receiptLookup.rows[0].record_class;
          rejectHistoricalWriteRequest(null, rClass);
          const explicitEd = body.editionId ?? body.edition_id ?? null;
          if (explicitEd) {
            edition = await resolveWritableEdition(client, explicitEd, rClass);
          } else {
            edition = await resolveWritableEditionByClass(
              client,
              rClass,
              config.editionIdDefault
            );
          }
        } else {
          edition = await resolveEditionForWrite(
            client,
            req,
            config.editionIdDefault
          );
        }

        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const rpcRes = await client.query<{
          receipt_id: string;
          reconciled: boolean;
          reconciled_at: string | Date;
          data_version: string | number;
        }>(
          `SELECT receipt_id, reconciled, reconciled_at, data_version
             FROM public.reconcile_receipt($1, $2, $3, $4, $5)`,
          [
            edition.editionId,
            receiptId,
            batchId,
            'ui:/collections/receipts/reconcile',
            'D',
          ]
        );
        const row = rpcRes.rows[0];
        if (!row) {
          throw new AppApiError(
            500,
            'RPC_EMPTY_RESULT',
            'reconcile_receipt returned no result.'
          );
        }
        return {
          receiptId: row.receipt_id,
          reconciled: Boolean(row.reconciled),
          reconciledAt: row.reconciled_at,
          dataVersion: Number(row.data_version),
        };
      });

      res.status(200).json({
        id: result.receiptId,
        receipt_id: result.receiptId,
        reconciled: result.reconciled,
        reconciled_at: result.reconciledAt,
        data_version: result.dataVersion,
        dataVersion: result.dataVersion,
      });
    })
  );

  // ---------------------------------------------------------------------------
  // 7. PATCH /api/contracts/:id (finance_collections, payment_terms only)
  // ---------------------------------------------------------------------------
  router.patch(
    '/contracts/:id',
    authMiddleware,
    resolveRolesMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      assertFinanceRole(req);
      const actor = getVerifiedActor(req);
      const contractId = String(req.params.id ?? '').trim();
      if (!contractId) {
        throw new AppApiError(400, 'INVALID_ARGUMENT', 'Contract ID is required.');
      }

      const rawBody =
        req.body && typeof req.body === 'object' && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};
      const allowedKeys = new Set([
        'payment_terms',
        'paymentTerms',
        'editionId',
        'edition_id',
        'recordClass',
        'record_class',
      ]);
      for (const key of Object.keys(rawBody)) {
        if (!allowedKeys.has(key)) {
          throw new AppApiError(
            422,
            'IMMUTABLE_CONTRACT_FIELD',
            `Field "${key}" cannot be edited on a signed contract; only payment_terms may be updated.`
          );
        }
      }

      const rawTerms = rawBody.paymentTerms ?? rawBody.payment_terms;
      if (typeof rawTerms !== 'string' || !rawTerms.trim()) {
        throw new AppApiError(
          400,
          'VALIDATION_ERROR',
          'paymentTerms is required.'
        );
      }
      const paymentTerms = normalizePaymentTerms(rawTerms);
      const requestedEdition =
        typeof (rawBody.editionId ?? rawBody.edition_id) === 'string'
          ? String(rawBody.editionId ?? rawBody.edition_id).trim()
          : null;
      const requestedClass =
        typeof (rawBody.recordClass ?? rawBody.record_class) === 'string'
          ? String(rawBody.recordClass ?? rawBody.record_class).trim()
          : null;

      rejectHistoricalWriteRequest(requestedEdition, requestedClass);

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const edition = await resolveContractEdition(
          client,
          contractId,
          requestedEdition,
          requestedClass
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );

        const updRes = await client.query<Record<string, unknown>>(
          `UPDATE public.contract
              SET payment_terms = $1,
                  updated_at = now()
            WHERE contract_id = $2
              AND valid_to IS NULL
              AND NOT is_deleted
          RETURNING contract_id, opportunity_id, signed_at, signed_value_total,
                    payment_terms, signatory_contact_id, document_uri, status,
                    record_class`,
          [paymentTerms, contractId]
        );
        const updated = updRes.rows[0];
        if (!updated) {
          throw new AppApiError(
            404,
            'NOT_FOUND',
            `Active contract "${contractId}" was not found.`
          );
        }

        const dataVersion = await fetchAppDataVersion(client);
        await insertAuditEvent(client, {
          actorId: actor.memberId,
          entity: 'CONTRACT',
          entityId: contractId,
          operation: 'update',
          after: { payment_terms: paymentTerms },
          dataVersion,
          recordClass: edition.recordClass,
          importBatchId: batchId,
          sourceRef: 'ui:/contracts/:id',
          evidenceClass: 'T',
        });

        return { updated, dataVersion };
      });

      res.status(200).json({
        id: contractId,
        contract_id: contractId,
        payment_terms: paymentTerms,
        data_version: result.dataVersion,
        dataVersion: result.dataVersion,
        contract: {
          ...result.updated,
          signed_value_total: Number(result.updated.signed_value_total ?? 0),
        },
      });
    })
  );

  // ---------------------------------------------------------------------------
  // 8. Team & Role Administration (coordination_lead or admin ONLY)
  // ---------------------------------------------------------------------------
  router.post(
    '/team/members',
    authMiddleware,
    resolveRolesMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      assertTeamAdminRole(req);
      const actor = getVerifiedActor(req);
      const body = parseBodyWithSchema(createTeamMemberSchema, req.body);

      const fullName = (body.fullName ?? body.full_name)!;
      const email = body.email ?? null;

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const edition = await resolveEditionForWrite(
          client,
          req,
          config.editionIdDefault
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );
        const memberId = generatePrefixedId('TM-');
        const rpcRes = await client.query<{ data_version: string | number }>(
          `SELECT public.create_team_member($1, $2, $3, $4, $5) AS data_version`,
          [memberId, fullName, email, edition.editionId, batchId]
        );
        const dataVersion = Number(rpcRes.rows[0]?.data_version ?? 0);
        return {
          memberId,
          edition,
          dataVersion,
        };
      });

      res.status(201).json({
        id: result.memberId,
        member_id: result.memberId,
        full_name: fullName,
        email,
        auth_linked: false,
        edition_id: result.edition.editionId,
        record_class: result.edition.recordClass,
        data_version: result.dataVersion,
        dataVersion: result.dataVersion,
      });
    })
  );

  router.post(
    '/team/members/:id/link',
    authMiddleware,
    resolveRolesMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      assertTeamAdminRole(req);
      const actor = getVerifiedActor(req);
      const memberId = String(req.params.id ?? '').trim();
      if (!memberId) {
        throw new AppApiError(400, 'INVALID_ARGUMENT', 'Member ID is required.');
      }
      const body = parseBodyWithSchema(linkAuthUserSchema, req.body);
      const authUserId = (body.authUserId ?? body.auth_user_id)!;

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const memberLookup = await client.query<{ record_class: string }>(
          `SELECT record_class
             FROM public.team_member
            WHERE member_id = $1 AND NOT is_deleted
            LIMIT 1`,
          [memberId]
        );
        let edition: WritableEditionInfo;
        if (memberLookup.rows[0]) {
          const mClass = memberLookup.rows[0].record_class;
          rejectHistoricalWriteRequest(null, mClass);
          const explicitEd = body.editionId ?? body.edition_id ?? null;
          edition = explicitEd
            ? await resolveWritableEdition(client, explicitEd, mClass)
            : await resolveWritableEditionByClass(
                client,
                mClass,
                config.editionIdDefault
              );
        } else {
          edition = await resolveEditionForWrite(
            client,
            req,
            config.editionIdDefault
          );
        }

        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );
        const rpcRes = await client.query<{ data_version: string | number }>(
          `SELECT public.link_auth_user($1, $2::uuid, $3) AS data_version`,
          [memberId, authUserId, batchId]
        );
        return {
          dataVersion: Number(rpcRes.rows[0]?.data_version ?? 0),
        };
      });

      res.status(200).json({
        id: memberId,
        member_id: memberId,
        auth_linked: true,
        data_version: result.dataVersion,
        dataVersion: result.dataVersion,
      });
    })
  );

  router.post(
    '/team/roles',
    authMiddleware,
    resolveRolesMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      assertTeamAdminRole(req);
      const actor = getVerifiedActor(req);
      const body = parseBodyWithSchema(assignRoleSchema, req.body);
      const memberId = (body.memberId ?? body.member_id)!;

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const edition = await resolveEditionForWrite(
          client,
          req,
          config.editionIdDefault
        );
        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );
        const roleAssignmentId = generatePrefixedId('RA-');
        const rpcRes = await client.query<{ data_version: string | number }>(
          `SELECT public.assign_role($1, $2, $3, $4, $5) AS data_version`,
          [roleAssignmentId, memberId, edition.editionId, body.role, batchId]
        );
        return {
          roleAssignmentId,
          edition,
          dataVersion: Number(rpcRes.rows[0]?.data_version ?? 0),
        };
      });

      res.status(201).json({
        id: result.roleAssignmentId,
        role_assignment_id: result.roleAssignmentId,
        member_id: memberId,
        edition_id: result.edition.editionId,
        role: body.role,
        record_class: result.edition.recordClass,
        data_version: result.dataVersion,
        dataVersion: result.dataVersion,
      });
    })
  );

  router.post(
    '/team/roles/:id/end',
    authMiddleware,
    resolveRolesMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      assertTeamAdminRole(req);
      const actor = getVerifiedActor(req);
      const roleAssignmentId = String(req.params.id ?? '').trim();
      if (!roleAssignmentId) {
        throw new AppApiError(
          400,
          'INVALID_ARGUMENT',
          'Role assignment ID is required.'
        );
      }
      const body = parseBodyWithSchema(endRoleSchema, req.body ?? {});

      const result = await runWriteTransaction(actor, dbState, async (client) => {
        const lookup = await client.query<{
          edition_id: string;
          record_class: string;
        }>(
          `SELECT edition_id, record_class
             FROM public.role_assignment
            WHERE role_assignment_id = $1 AND NOT is_deleted
            LIMIT 1`,
          [roleAssignmentId]
        );
        let edition: WritableEditionInfo;
        if (lookup.rows[0]) {
          rejectHistoricalWriteRequest(
            lookup.rows[0].edition_id,
            lookup.rows[0].record_class
          );
          edition = await resolveWritableEdition(
            client,
            lookup.rows[0].edition_id,
            body.recordClass ?? body.record_class ?? null
          );
        } else {
          edition = await resolveEditionForWrite(
            client,
            req,
            config.editionIdDefault
          );
        }

        const batchId = await ensureUiImportBatch(
          client,
          edition.editionId,
          edition.recordClass,
          actor.memberId
        );
        const rpcRes = await client.query<{ data_version: string | number }>(
          `SELECT public.end_role($1, $2) AS data_version`,
          [roleAssignmentId, batchId]
        );
        return {
          dataVersion: Number(rpcRes.rows[0]?.data_version ?? 0),
        };
      });

      res.status(200).json({
        id: roleAssignmentId,
        role_assignment_id: roleAssignmentId,
        is_current: false,
        data_version: result.dataVersion,
        dataVersion: result.dataVersion,
      });
    })
  );

  return router;
}
