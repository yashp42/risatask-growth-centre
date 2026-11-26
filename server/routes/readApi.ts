import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import {
  requireAuth,
  resolveMemberRoles,
  type AuthDependencies,
} from '../auth.ts';
import type { ServerConfig } from '../config.ts';
import type { DatabasePoolState } from '../db.ts';
import { AppApiError, asyncHandler, mapPgErrorToAppError, sendJsonError } from '../errors.ts';
import {
  addDaysIso,
  computeCashGateStatus,
  computeGateStatus,
  computeWeekEndDates,
  extractIstDateFromTimestamp,
  formatShortDisplayDate,
  getTodayIstIso,
  isValidIsoDate,
} from '../gates.ts';
import {
  evaluatePermission,
  type BusinessEntityDomain,
  type CanonicalRole,
  type PermissionScope,
} from '../permissions.ts';
import { evaluateRuleBand, type RuleMetricSnapshot } from '../ruleBands.ts';

export const ALLOWED_METRIC_FILTER_KEYS = [
  'campaign_id',
  'channel_group',
  'bet_id',
  'scenario_id',
] as const;

export const ALLOWED_METRIC_FILTER_KEY_SET: ReadonlySet<string> = new Set(
  ALLOWED_METRIC_FILTER_KEYS
);

export const ALLOWED_CHANNEL_GROUPS: ReadonlySet<string> = new Set([
  'warm',
  'inbound',
  'cold',
  'renewal',
  'premium',
]);

export const VIEWER_RESTRICTED_METRICS: ReadonlySet<string> = new Set([
  'M-01',
  'M-06',
  'M-07',
  'M-25',
  'M-27',
]);

const METRIC_ID_RE = /^M-(0[1-9]|[12][0-9]|30)$/;
const VALID_RECORD_CLASSES = new Set(['historical_synthetic', 'live', 'simulated']);

export interface ScopeAndRedactionProfile {
  isAdminOnly: boolean;
  isViewerOnly: boolean;
  hasAllBusinessScope: boolean;
  sponsorsScope: PermissionScope;
  opportunitiesScope: PermissionScope;
  contractsScope: PermissionScope;
  tasksScope: PermissionScope;
  escalationsScope: PermissionScope;
  scheduleScope: PermissionScope;
  receiptsScope: PermissionScope;
  canViewAudit: boolean;
  redactFinancials: boolean;
  redactPii: boolean;
  redactBankReference: boolean;
}

export function evaluateScopeAndRedaction(
  roles: ReadonlyArray<CanonicalRole>
): ScopeAndRedactionProfile {
  const sponsors = evaluatePermission(roles, 'sponsors_contacts_research', 'read');
  const opportunities = evaluatePermission(roles, 'opportunities_stage', 'read');
  const contracts = evaluatePermission(roles, 'contracts_lines', 'read');
  const tasks = evaluatePermission(roles, 'tasks', 'read');
  const escalations = evaluatePermission(roles, 'escalations', 'read');
  const schedule = evaluatePermission(roles, 'payment_schedule_invoices', 'read');
  const receipts = evaluatePermission(roles, 'receipts_allocations', 'read');
  const targets = evaluatePermission(roles, 'targets_rules_scenarios_metrics', 'read');

  const isAdminOnly =
    roles.length > 0 && roles.every((r) => r === 'admin');
  const isViewerOnly =
    roles.length > 0 && roles.every((r) => r === 'viewer' || r === 'admin') && roles.includes('viewer');
  const hasAllReceipts = receipts.scope === 'all';
  const canViewAudit =
    roles.includes('coordination_lead') || roles.includes('admin');

  return {
    isAdminOnly,
    isViewerOnly,
    hasAllBusinessScope:
      targets.allowed &&
      sponsors.scope === 'all' &&
      opportunities.scope === 'all',
    sponsorsScope: sponsors.scope,
    opportunitiesScope: opportunities.scope,
    contractsScope: contracts.scope,
    tasksScope: tasks.scope,
    escalationsScope: escalations.scope,
    scheduleScope: schedule.scope,
    receiptsScope: receipts.scope,
    canViewAudit,
    redactFinancials: isViewerOnly || !schedule.allowed,
    redactPii: isViewerOnly,
    redactBankReference: !hasAllReceipts,
  };
}

export function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface EnrichedReceiptAllocation {
  allocation_id: string;
  receipt_id: string;
  invoice_id: string | null;
  schedule_item_id: string | null;
  contract_id: string | null;
  amount: number;
  created_at: string | null;
}

export function buildEnrichedReceipts(
  receiptRows: ReadonlyArray<Record<string, unknown>>,
  allocationRows: ReadonlyArray<Record<string, unknown>>,
  redactBankReference: boolean
): Array<Record<string, unknown>> {
  const allocsByReceipt = new Map<string, EnrichedReceiptAllocation[]>();
  const allocTotalByReceipt = new Map<string, number>();

  for (const row of allocationRows) {
    const rid = String(row.receipt_id);
    const amount = toNum(row.amount) ?? 0;
    allocTotalByReceipt.set(
      rid,
      Math.round(((allocTotalByReceipt.get(rid) ?? 0) + amount) * 100) / 100
    );
    const list = allocsByReceipt.get(rid) ?? [];
    list.push({
      allocation_id: String(row.allocation_id),
      receipt_id: rid,
      invoice_id: (row.invoice_id as string | null) ?? null,
      schedule_item_id: (row.schedule_item_id as string | null) ?? null,
      contract_id: (row.contract_id as string | null) ?? null,
      amount,
      created_at: (row.created_at as string | null) ?? null,
    });
    allocsByReceipt.set(rid, list);
  }

  return receiptRows.map((r) => {
    const receiptId = String(r.receipt_id);
    const amount = toNum(r.amount) ?? 0;
    const allocatedAmount = allocTotalByReceipt.get(receiptId) ?? 0;
    const unallocatedAmount = Math.max(
      0,
      Math.round((amount - allocatedAmount) * 100) / 100
    );
    const reconciled = Boolean(r.reconciled);
    const rawAllocations = allocsByReceipt.get(receiptId) ?? [];
    const primaryContractId =
      rawAllocations.find((a) => Boolean(a.contract_id))?.contract_id ?? null;

    return {
      receipt_id: r.receipt_id,
      sponsor_id: r.sponsor_id,
      sponsor_name: r.sponsor_name,
      contract_id: redactBankReference ? null : primaryContractId,
      received_at: r.received_at,
      amount,
      allocated_amount: allocatedAmount,
      unallocated_amount: unallocatedAmount,
      method: r.method,
      bank_reference: redactBankReference ? null : r.bank_reference ?? null,
      bank_reference_redacted: redactBankReference,
      totals_only_redacted: redactBankReference,
      reconciled,
      unreconciled: !reconciled,
      counted_as_collected: reconciled && allocatedAmount > 0,
      reconciled_at: r.reconciled_at,
      recorded_by: r.recorded_by,
      recorded_by_name: r.recorded_by_name,
      record_class: r.record_class,
      allocations: redactBankReference ? [] : rawAllocations,
    };
  });
}

function toIsoDateOnly(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  return str || null;
}

/**
 * Validates metric filter keys strictly against the Stage 2 SQL whitelist:
 * ONLY campaign_id, channel_group, bet_id, scenario_id.
 * Throws AppApiError(400, 'INVALID_ARGUMENT') on any unknown key.
 */
export function sanitizeMetricFilters(
  rawFilters: unknown
): Record<string, string> {
  if (rawFilters === undefined || rawFilters === null) {
    return {};
  }
  if (typeof rawFilters !== 'object' || Array.isArray(rawFilters)) {
    throw new AppApiError(
      400,
      'INVALID_ARGUMENT',
      'filters must be a JSON object.'
    );
  }

  const input = rawFilters as Record<string, unknown>;
  const cleaned: Record<string, string> = {};

  for (const [key, rawVal] of Object.entries(input)) {
    if (!ALLOWED_METRIC_FILTER_KEY_SET.has(key)) {
      throw new AppApiError(
        400,
        'INVALID_ARGUMENT',
        `Unsupported metric filter key "${key}". Allowed keys: ${ALLOWED_METRIC_FILTER_KEYS.join(', ')}.`
      );
    }
    if (rawVal === undefined || rawVal === null) continue;
    const str = String(rawVal).trim();
    if (!str || str === 'all') continue;
    if (key === 'channel_group' && !ALLOWED_CHANNEL_GROUPS.has(str)) {
      throw new AppApiError(
        400,
        'INVALID_ARGUMENT',
        `Invalid channel_group "${str}". Allowed values: warm, inbound, cold, renewal, premium.`
      );
    }
    cleaned[key] = str;
  }

  return cleaned;
}

export interface CoercedMetricResult {
  metric_id: string;
  value: number | null;
  unit: string | null;
  numerator: number | null;
  denominator: number | null;
  computable: boolean;
  reason: string | null;
  applied_filters: Record<string, unknown>;
  record_class: string;
  edition_id: string;
  as_of: string;
  data_version: number | null;
  definition_version: string | null;
  series_key: string | null;
}

export function coerceMetricRow(raw: Record<string, unknown>): CoercedMetricResult {
  const rawApplied = raw.applied_filters;
  const appliedFilters =
    rawApplied && typeof rawApplied === 'object' && !Array.isArray(rawApplied)
      ? (rawApplied as Record<string, unknown>)
      : {};

  return {
    metric_id: String(raw.metric_id ?? ''),
    value: toNum(raw.value),
    unit: raw.unit !== null && raw.unit !== undefined ? String(raw.unit) : null,
    numerator: toNum(raw.numerator),
    denominator: toNum(raw.denominator),
    computable: Boolean(raw.computable),
    reason: raw.reason !== null && raw.reason !== undefined ? String(raw.reason) : null,
    applied_filters: appliedFilters,
    record_class: String(raw.record_class ?? ''),
    edition_id: String(raw.edition_id ?? ''),
    as_of: toIsoDateOnly(raw.as_of) ?? '',
    data_version: toNum(raw.data_version),
    definition_version:
      raw.definition_version !== null && raw.definition_version !== undefined
        ? String(raw.definition_version)
        : null,
    series_key:
      raw.series_key !== null && raw.series_key !== undefined
        ? String(raw.series_key)
        : null,
  };
}

function getQueryString(req: Request, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = req.query[key];
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
  }
  return null;
}

function ensurePool(dbState: DatabasePoolState) {
  if (!dbState.configured || !dbState.pool) {
    throw new AppApiError(
      503,
      dbState.configured ? 'DB_UNAVAILABLE' : 'DATABASE_NOT_CONFIGURED',
      dbState.configured
        ? 'PostgreSQL connection pool is unavailable.'
        : 'DATABASE_URL is not configured.'
    );
  }
  return dbState.pool;
}

function parseEditionAndClass(
  req: Request,
  defaultEditionId: string
): { editionId: string; requestedRecordClass: string | null } {
  const editionId =
    getQueryString(req, 'editionId', 'edition_id') || defaultEditionId;
  const requestedRecordClass = getQueryString(req, 'recordClass', 'record_class');
  if (
    requestedRecordClass &&
    requestedRecordClass !== 'external_research' &&
    !VALID_RECORD_CLASSES.has(requestedRecordClass)
  ) {
    throw new AppApiError(
      400,
      'INVALID_ARGUMENT',
      `Invalid record_class "${requestedRecordClass}".`
    );
  }
  return { editionId, requestedRecordClass };
}

async function resolveEditionContext(
  dbState: DatabasePoolState,
  editionId: string,
  requestedRecordClass: string | null
): Promise<{
  edition_id: string;
  name: string;
  record_class: string;
  starts_at: string;
  season_start: string | null;
  preseason_start: string | null;
  is_current: boolean;
}> {
  const pool = ensurePool(dbState);
  const res = await pool.query<{
    edition_id: string;
    name: string;
    record_class: string;
    starts_at: Date | string;
    season_start: Date | string | null;
    preseason_start: Date | string | null;
    is_current: boolean;
  }>(
    `SELECT edition_id, name, record_class, starts_at, season_start, preseason_start, is_current
       FROM public.festival_edition
      WHERE edition_id = $1
        AND NOT is_deleted
      LIMIT 1`,
    [editionId]
  );

  const row = res.rows[0];
  if (!row) {
    throw new AppApiError(
      404,
      'EDITION_NOT_FOUND',
      `Festival edition "${editionId}" does not exist.`
    );
  }

  if (
    requestedRecordClass &&
    requestedRecordClass !== 'external_research' &&
    requestedRecordClass !== row.record_class
  ) {
    throw new AppApiError(
      400,
      'INVALID_ARGUMENT',
      `Edition ${editionId} holds record_class "${row.record_class}", not "${requestedRecordClass}".`
    );
  }

  return {
    edition_id: row.edition_id,
    name: row.name,
    record_class: row.record_class,
    starts_at:
      row.starts_at instanceof Date
        ? row.starts_at.toISOString()
        : String(row.starts_at),
    season_start: toIsoDateOnly(row.season_start),
    preseason_start: toIsoDateOnly(row.preseason_start),
    is_current: Boolean(row.is_current),
  };
}

export function createReadApiRouter(
  config: ServerConfig,
  dbState: DatabasePoolState,
  authDeps: AuthDependencies
): Router {
  const router = Router();
  const authMiddleware = requireAuth(authDeps);

  /**
   * Resolves verified roles ALWAYS against defaultEditionId (ED-2026-DEMO),
   * so switching the viewed editionId to ED-2025 (historical_synthetic) never
   * fails role resolution on role_assignment.
   */
  const resolveReadRoles: RequestHandler = async (
    req: Request,
    _res: Response,
    next: NextFunction
  ) => {
    if (!req.authUser) {
      next(
        new AppApiError(
          401,
          'AUTH_REQUIRED',
          'Authentication required before resolving roles.'
        )
      );
      return;
    }

    const resolution = await resolveMemberRoles(
      authDeps.dbState,
      req.authUser,
      authDeps.defaultEditionId
    );

    if (resolution.status !== 'resolved') {
      next(
        new AppApiError(
          resolution.httpStatus,
          resolution.code,
          resolution.message
        )
      );
      return;
    }

    req.resolvedMember = resolution.member;
    next();
  };

  function requireReadDomain(domain: BusinessEntityDomain): RequestHandler {
    return (req: Request, _res: Response, next: NextFunction) => {
      const roles = req.resolvedMember?.roles;
      if (!roles || roles.length === 0) {
        next(
          new AppApiError(
            403,
            'ROLE_NOT_RESOLVED',
            'Verified canonical role assignment is required.'
          )
        );
        return;
      }

      const decision = evaluatePermission(roles, domain, 'read');
      if (!decision.allowed) {
        next(
          new AppApiError(
            403,
            'FORBIDDEN',
            `Your assigned role does not permit reading ${domain}.`
          )
        );
        return;
      }

      req.permissionDecision = decision;
      next();
    };
  }

  function getScopeProfile(req: Request): {
    actorMemberId: string;
    roles: CanonicalRole[];
    profile: ScopeAndRedactionProfile;
  } {
    const roles = req.resolvedMember?.roles ?? [];
    const actorMemberId = req.actor?.memberId ?? req.resolvedMember?.member_id ?? '';
    return {
      actorMemberId,
      roles,
      profile: evaluateScopeAndRedaction(roles),
    };
  }

  function wrapDb<T>(promise: Promise<T>): Promise<T> {
    return promise.catch((err) => {
      throw mapPgErrorToAppError(err);
    });
  }

  // ---------------------------------------------------------------------------
  // 1. GET /api/editions
  // ---------------------------------------------------------------------------
  router.get(
    '/editions',
    authMiddleware,
    resolveReadRoles,
    asyncHandler(async (_req: Request, res: Response) => {
      const pool = ensurePool(dbState);
      const qRes = await wrapDb(
        pool.query<{
          edition_id: string;
          name: string;
          record_class: string;
          starts_at: Date | string;
          season_start: Date | string | null;
          preseason_start: Date | string | null;
          is_current: boolean;
        }>(
          `SELECT edition_id, name, record_class, starts_at, season_start, preseason_start, is_current
             FROM public.festival_edition
            WHERE NOT is_deleted
            ORDER BY is_current DESC, starts_at DESC`
        )
      );

      const editions = qRes.rows.map((row) => ({
        edition_id: row.edition_id,
        name: row.name,
        record_class: row.record_class,
        starts_at:
          row.starts_at instanceof Date
            ? row.starts_at.toISOString()
            : String(row.starts_at),
        season_start: toIsoDateOnly(row.season_start),
        preseason_start: toIsoDateOnly(row.preseason_start),
        is_current: Boolean(row.is_current),
      }));

      res.status(200).json({
        editions,
        default_edition_id: config.editionIdDefault,
      });
    })
  );

  // ---------------------------------------------------------------------------
  // 2. POST /api/metrics/query & POST /api/metrics/series
  // ---------------------------------------------------------------------------
  const MetricQuerySchema = z.object({
    metricIds: z.array(z.string().trim()).min(1).max(30).optional(),
    metric_ids: z.array(z.string().trim()).min(1).max(30).optional(),
    editionId: z.string().trim().min(1).optional(),
    edition_id: z.string().trim().min(1).optional(),
    recordClass: z.string().trim().min(1).optional(),
    record_class: z.string().trim().min(1).optional(),
    asOf: z.string().trim().min(1).optional(),
    as_of: z.string().trim().min(1).optional(),
    filters: z.unknown().optional(),
  });

  router.post(
    '/metrics/query',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = MetricQuerySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppApiError(
          400,
          'INVALID_ARGUMENT',
          parsed.error.issues[0]?.message || 'Invalid metrics query payload.'
        );
      }

      const rawMetricIds = parsed.data.metricIds ?? parsed.data.metric_ids;
      if (!rawMetricIds || rawMetricIds.length === 0) {
        throw new AppApiError(
          400,
          'INVALID_ARGUMENT',
          'metricIds (or metric_ids) array with 1 to 30 metric IDs is required.'
        );
      }
      for (const id of rawMetricIds) {
        if (!METRIC_ID_RE.test(id)) {
          throw new AppApiError(
            400,
            'INVALID_ARGUMENT',
            `Invalid metric ID "${id}". Expected M-01 through M-30.`
          );
        }
      }

      const { profile } = getScopeProfile(req);
      if (profile.isViewerOnly) {
        const forbiddenId = rawMetricIds.find((id) =>
          VIEWER_RESTRICTED_METRICS.has(id)
        );
        if (forbiddenId) {
          throw new AppApiError(
            403,
            'FORBIDDEN',
            `Viewer role is not permitted to query restricted metric ${forbiddenId}.`
          );
        }
      }

      const editionId =
        parsed.data.editionId ??
        parsed.data.edition_id ??
        config.editionIdDefault;
      const requestedClass =
        parsed.data.recordClass ?? parsed.data.record_class ?? null;
      if (requestedClass && !VALID_RECORD_CLASSES.has(requestedClass)) {
        throw new AppApiError(
          400,
          'INVALID_ARGUMENT',
          `Invalid record_class "${requestedClass}".`
        );
      }

      const asOf =
        parsed.data.asOf ?? parsed.data.as_of ?? getTodayIstIso();
      if (!isValidIsoDate(asOf)) {
        throw new AppApiError(
          400,
          'INVALID_ARGUMENT',
          `as_of must be a valid YYYY-MM-DD date (received "${asOf}").`
        );
      }

      const cleanedFilters = sanitizeMetricFilters(parsed.data.filters);
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedClass
      );
      const recordClass = requestedClass ?? editionCtx.record_class;

      const pool = ensurePool(dbState);
      const filterJson = JSON.stringify(cleanedFilters);
      const results: CoercedMetricResult[] = [];

      for (const metricId of rawMetricIds) {
        const qRes = await wrapDb(
          pool.query<Record<string, unknown>>(
            `SELECT * FROM metrics.get_metric($1, $2, $3, $4::date, $5::jsonb)`,
            [metricId, recordClass, editionCtx.edition_id, asOf, filterJson]
          )
        );
        for (const row of qRes.rows) {
          results.push(coerceMetricRow(row));
        }
      }

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: recordClass,
        as_of: asOf,
        results,
        metrics: results,
      });
    })
  );

  const MetricSeriesSchema = z.object({
    metricId: z.string().trim().optional(),
    metric_id: z.string().trim().optional(),
    editionId: z.string().trim().min(1).optional(),
    edition_id: z.string().trim().min(1).optional(),
    recordClass: z.string().trim().min(1).optional(),
    record_class: z.string().trim().min(1).optional(),
    asOfDates: z.array(z.string().trim()).min(1).max(12).optional(),
    as_of_dates: z.array(z.string().trim()).min(1).max(12).optional(),
    filters: z.unknown().optional(),
  });

  router.post(
    '/metrics/series',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = MetricSeriesSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppApiError(
          400,
          'INVALID_ARGUMENT',
          parsed.error.issues[0]?.message || 'Invalid metrics series payload.'
        );
      }

      const metricId = parsed.data.metricId ?? parsed.data.metric_id ?? '';
      if (!METRIC_ID_RE.test(metricId)) {
        throw new AppApiError(
          400,
          'INVALID_ARGUMENT',
          `Invalid metricId "${metricId}". Expected M-01 through M-30.`
        );
      }

      const { profile } = getScopeProfile(req);
      if (profile.isViewerOnly && VIEWER_RESTRICTED_METRICS.has(metricId)) {
        throw new AppApiError(
          403,
          'FORBIDDEN',
          `Viewer role is not permitted to query restricted metric ${metricId}.`
        );
      }

      const asOfDates = parsed.data.asOfDates ?? parsed.data.as_of_dates;
      if (!asOfDates || asOfDates.length === 0) {
        throw new AppApiError(
          400,
          'INVALID_ARGUMENT',
          'asOfDates array with 1 to 12 dates is required.'
        );
      }
      for (const dt of asOfDates) {
        if (!isValidIsoDate(dt)) {
          throw new AppApiError(
            400,
            'INVALID_ARGUMENT',
            `Invalid YYYY-MM-DD date "${dt}" in asOfDates.`
          );
        }
      }

      const editionId =
        parsed.data.editionId ??
        parsed.data.edition_id ??
        config.editionIdDefault;
      const requestedClass =
        parsed.data.recordClass ?? parsed.data.record_class ?? null;
      if (requestedClass && !VALID_RECORD_CLASSES.has(requestedClass)) {
        throw new AppApiError(
          400,
          'INVALID_ARGUMENT',
          `Invalid record_class "${requestedClass}".`
        );
      }

      const cleanedFilters = sanitizeMetricFilters(parsed.data.filters);
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedClass
      );
      const recordClass = requestedClass ?? editionCtx.record_class;

      const pool = ensurePool(dbState);
      const filterJson = JSON.stringify(cleanedFilters);
      const series: Array<{ as_of: string; rows: CoercedMetricResult[] }> = [];

      for (const asOf of asOfDates) {
        const qRes = await wrapDb(
          pool.query<Record<string, unknown>>(
            `SELECT * FROM metrics.get_metric($1, $2, $3, $4::date, $5::jsonb)`,
            [metricId, recordClass, editionCtx.edition_id, asOf, filterJson]
          )
        );
        series.push({
          as_of: asOf,
          rows: qRes.rows.map(coerceMetricRow),
        });
      }

      res.status(200).json({
        metric_id: metricId,
        edition_id: editionCtx.edition_id,
        record_class: recordClass,
        series,
      });
    })
  );

  // ---------------------------------------------------------------------------
  // 3. GET /api/gates & GET /api/reference/gates
  // ---------------------------------------------------------------------------
  const handleGetGates = asyncHandler(async (req: Request, res: Response) => {
    const { editionId, requestedRecordClass } = parseEditionAndClass(
      req,
      config.editionIdDefault
    );
    const asOf = getQueryString(req, 'asOf', 'as_of') ?? getTodayIstIso();
    if (!isValidIsoDate(asOf)) {
      throw new AppApiError(
        400,
        'INVALID_ARGUMENT',
        `Invalid asOf date "${asOf}".`
      );
    }

    const editionCtx = await resolveEditionContext(
      dbState,
      editionId,
      requestedRecordClass
    );
    const pool = ensurePool(dbState);

    const targetsRes = await wrapDb(
      pool.query<{
        target_id: string;
        edition_id: string;
        kpi_id: string;
        kpi_name: string | null;
        metric_id: string | null;
        scenario_id: string | null;
        scenario_name: string | null;
        period: string | null;
        target_value: string | number;
        decision_id: string | null;
        record_class: string;
      }>(
        `SELECT tv.target_id, tv.edition_id, tv.kpi_id,
                kd.name AS kpi_name, kd.metric_id,
                tv.scenario_id, sr.name AS scenario_name,
                tv.period, tv.target_value, tv.decision_id, tv.record_class
           FROM public.target_version tv
           LEFT JOIN public.kpi_definition kd ON kd.kpi_id = tv.kpi_id AND NOT kd.is_deleted
           LEFT JOIN public.scenario_reference sr ON sr.scenario_id = tv.scenario_id AND NOT sr.is_deleted
          WHERE tv.edition_id = $1
            AND tv.valid_to IS NULL
            AND NOT tv.is_deleted
          ORDER BY tv.kpi_id, tv.period, tv.scenario_id NULLS LAST`,
        [editionCtx.edition_id]
      )
    );

    const weekSchedule = editionCtx.season_start
      ? computeWeekEndDates(editionCtx.season_start, 10).map((w) => ({
          ...w,
          passed: w.week_end <= asOf,
        }))
      : [];

    const weekEndByPeriod = new Map<string, string>();
    for (const w of weekSchedule) {
      weekEndByPeriod.set(w.period, w.week_end);
    }

    // Evaluate M-08 at passed gate checkpoints (W4..W9) and at asOf
    const gateWeekPeriods = ['W4', 'W5', 'W6', 'W7', 'W8', 'W9'];
    const m08ByPeriod = new Map<string, CoercedMetricResult>();

    for (const period of gateWeekPeriods) {
      const weekEnd = weekEndByPeriod.get(period);
      if (weekEnd && weekEnd <= asOf) {
        const mRes = await wrapDb(
          pool.query<Record<string, unknown>>(
            `SELECT * FROM metrics.get_metric('M-08', $1, $2, $3::date, '{}'::jsonb)`,
            [editionCtx.record_class, editionCtx.edition_id, weekEnd]
          )
        );
        if (mRes.rows[0]) {
          m08ByPeriod.set(period, coerceMetricRow(mRes.rows[0]));
        }
      }
    }

    const { profile } = getScopeProfile(req);
    let m06Snapshot: CoercedMetricResult | null = null;
    if (!profile.isViewerOnly) {
      const m06Res = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT * FROM metrics.get_metric('M-06', $1, $2, $3::date, '{}'::jsonb)`,
          [editionCtx.record_class, editionCtx.edition_id, asOf]
        )
      );
      if (m06Res.rows[0]) {
        m06Snapshot = coerceMetricRow(m06Res.rows[0]);
      }
    }

    const baseByPeriod = new Map<string, number>();
    const planByPeriod = new Map<string, number>();
    let cashGateTarget: number | null = null;

    for (const row of targetsRes.rows) {
      const val = toNum(row.target_value);
      const periodKey = row.period ? row.period.toUpperCase() : '';
      if (row.kpi_id === 'K-G-01' && val !== null) {
        if (row.scenario_id === 'SC-01') baseByPeriod.set(periodKey, val);
        if (row.scenario_id === 'SC-02') planByPeriod.set(periodKey, val);
      }
      if (row.kpi_id === 'K-G-02' && val !== null) {
        cashGateTarget = val;
      }
    }

    const weeklyEvaluation = gateWeekPeriods.map((period) => {
      const weekEnd = weekEndByPeriod.get(period) ?? null;
      const baseTarget = baseByPeriod.get(period) ?? null;
      const planTarget = planByPeriod.get(period) ?? null;
      const metric = m08ByPeriod.get(period) ?? null;
      const actualValue = metric && metric.computable ? metric.value : null;
      const passed = Boolean(weekEnd && weekEnd <= asOf);
      const status = passed
        ? computeGateStatus(actualValue, baseTarget, planTarget)
        : 'unavailable';

      return {
        period,
        week_no: Number(period.slice(1)),
        week_end: weekEnd,
        passed,
        base_target: baseTarget,
        plan_target: planTarget,
        actual_value: actualValue,
        computable: metric?.computable ?? false,
        reason: metric?.reason ?? (passed ? null : 'Checkpoint date not yet reached'),
        status,
      };
    });

    const latestPassed =
      [...weeklyEvaluation].reverse().find((w) => w.passed) ?? null;

    const festDateIst = extractIstDateFromTimestamp(editionCtx.starts_at);
    const cashGateDueDate = festDateIst ? addDaysIso(festDateIst, -7) : null;
    const isHistorical = editionCtx.record_class === 'historical_synthetic';
    const isCashGateBeforeDue =
      !isHistorical && Boolean(cashGateDueDate && asOf < cashGateDueDate);

    const cashGateStatus = isCashGateBeforeDue
      ? computeCashGateStatus(null, cashGateTarget, {
          asOf,
          dueDate: cashGateDueDate,
          isHistorical,
        })
      : m06Snapshot && m06Snapshot.computable && cashGateTarget !== null
        ? computeCashGateStatus(m06Snapshot.value, cashGateTarget, {
            asOf,
            dueDate: cashGateDueDate,
            isHistorical,
          })
        : 'unavailable';

    const gates = targetsRes.rows.map((row) => {
      const targetValue = toNum(row.target_value);
      const periodKey = row.period ? row.period.toUpperCase() : '';
      const isPacingGate = row.kpi_id === 'K-G-01';
      const isCashGate = row.kpi_id === 'K-G-02';
      const weekEval = isPacingGate
        ? weeklyEvaluation.find((w) => w.period === periodKey) ?? null
        : null;

      let statusLabel: string | null = null;
      let pass: boolean | null = null;
      if (isPacingGate && weekEval && weekEval.passed) {
        statusLabel = weekEval.status;
        pass =
          weekEval.actual_value !== null && targetValue !== null
            ? weekEval.actual_value >= targetValue
            : null;
      } else if (isCashGate) {
        if (isCashGateBeforeDue) {
          statusLabel = cashGateStatus;
          pass = null;
        } else {
          statusLabel =
            m06Snapshot && !m06Snapshot.computable
              ? m06Snapshot.reason || 'Not computable'
              : cashGateStatus;
          pass =
            m06Snapshot?.computable && m06Snapshot.value !== null && targetValue !== null
              ? m06Snapshot.value >= targetValue
              : null;
        }
      }

      return {
        gate_id: row.target_id,
        target_id: row.target_id,
        edition_id: row.edition_id,
        kpi_id: row.kpi_id,
        name:
          row.kpi_name ??
          (isCashGate ? 'T−7 cash collection gate' : `Pacing gate ${row.period ?? ''}`),
        metric_id: row.metric_id ?? (isCashGate ? 'M-06' : isPacingGate ? 'M-08' : null),
        scenario_id: row.scenario_id,
        scenario_name: row.scenario_name,
        period: row.period,
        week_no:
          row.period && /^W-?\d+$/i.test(row.period)
            ? Number(row.period.slice(1))
            : null,
        week_end: weekEndByPeriod.get(periodKey) ?? null,
        target_value: targetValue,
        threshold: targetValue,
        threshold_label:
          isCashGate && targetValue !== null
            ? `≥ ${(targetValue * 100).toFixed(0)}% collected ÷ signed cash`
            : null,
        checkpoint_label: row.period,
        actual_value: isCashGate
          ? m06Snapshot?.value ?? null
          : weekEval?.actual_value ?? null,
        status: statusLabel,
        pass,
        decision_id: row.decision_id,
        record_class: row.record_class,
      };
    });

    res.status(200).json({
      edition_id: editionCtx.edition_id,
      record_class: editionCtx.record_class,
      as_of: asOf,
      season_start: editionCtx.season_start,
      starts_at: editionCtx.starts_at,
      weeks: weekSchedule,
      weekly_pacing: weeklyEvaluation,
      latest_passed_week: latestPassed,
      cash_gate: {
        kpi_id: 'K-G-02',
        metric_id: 'M-06',
        threshold: cashGateTarget ?? 0.85,
        due_date: cashGateDueDate,
        is_due: !isCashGateBeforeDue && (isHistorical || Boolean(cashGateDueDate)),
        actual_value: m06Snapshot?.value ?? null,
        computable: m06Snapshot?.computable ?? false,
        reason: m06Snapshot?.reason ?? (profile.isViewerOnly ? 'Restricted for viewer role' : null),
        status: cashGateStatus,
      },
      gates,
    });
  });

  router.get(
    '/gates',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    handleGetGates
  );
  router.get(
    '/reference/gates',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    handleGetGates
  );

  // ---------------------------------------------------------------------------
  // 4. GET /api/rules & GET /api/reference/rules
  // ---------------------------------------------------------------------------
  const RULE_METRIC_OVERRIDE: Record<string, string> = {
    'EX-B1a': 'M-19',
    'EX-B2': 'M-25',
    'EX-B2 (gate)': 'M-06',
    'EX-B4a': 'M-28',
    'EX-B3a': 'M-29',
  };

  const handleGetRules = asyncHandler(async (req: Request, res: Response) => {
    const { editionId, requestedRecordClass } = parseEditionAndClass(
      req,
      config.editionIdDefault
    );
    const asOf = getQueryString(req, 'asOf', 'as_of') ?? getTodayIstIso();
    if (!isValidIsoDate(asOf)) {
      throw new AppApiError(
        400,
        'INVALID_ARGUMENT',
        `Invalid asOf date "${asOf}".`
      );
    }

    const editionCtx = await resolveEditionContext(
      dbState,
      editionId,
      requestedRecordClass
    );
    const pool = ensurePool(dbState);
    const { profile } = getScopeProfile(req);

    const qRes = await wrapDb(
      pool.query<{
        rule_id: string;
        kpi_id: string;
        evaluate_at: string;
        keep_if: string | null;
        change_if: string | null;
        escalate_if: string;
        response: string;
        owner_role: string | null;
        decision_id: string | null;
        rule_status: string;
        kpi_name: string | null;
        bet_id: string | null;
        metric_id: string | null;
      }>(
        `SELECT tr.rule_id, tr.kpi_id, tr.evaluate_at, tr.keep_if, tr.change_if,
                tr.escalate_if, tr.response, tr.owner_role, tr.decision_id, tr.rule_status,
                kd.name AS kpi_name, kd.bet_id, kd.metric_id
           FROM public.threshold_rule tr
           LEFT JOIN public.kpi_definition kd
             ON kd.kpi_id = tr.kpi_id
            AND kd.valid_to IS NULL
            AND NOT kd.is_deleted
          WHERE tr.valid_to IS NULL
            AND NOT tr.is_deleted
          ORDER BY tr.rule_id`
      )
    );

    const metricCache = new Map<string, CoercedMetricResult>();
    const neededMetricIds = new Set<string>();
    for (const row of qRes.rows) {
      const mappedId = RULE_METRIC_OVERRIDE[row.rule_id] ?? row.metric_id;
      if (mappedId && METRIC_ID_RE.test(mappedId)) {
        if (!profile.isViewerOnly || !VIEWER_RESTRICTED_METRICS.has(mappedId)) {
          neededMetricIds.add(mappedId);
        }
      }
    }

    for (const mId of neededMetricIds) {
      const mRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT * FROM metrics.get_metric($1, $2, $3, $4::date, '{}'::jsonb)`,
          [mId, editionCtx.record_class, editionCtx.edition_id, asOf]
        )
      );
      if (mRes.rows[0]) {
        metricCache.set(mId, coerceMetricRow(mRes.rows[0]));
      }
    }

    const festDateIst = extractIstDateFromTimestamp(editionCtx.starts_at);
    const cashGateDueDate = festDateIst ? addDaysIso(festDateIst, -7) : null;
    const isHistorical = editionCtx.record_class === 'historical_synthetic';
    const cashGateNotDueMessage =
      !isHistorical && cashGateDueDate && asOf < cashGateDueDate
        ? `Not yet due: evaluated on ${formatShortDisplayDate(cashGateDueDate)}`
        : null;

    const rules = qRes.rows.map((row) => {
      const effectiveMetricId =
        RULE_METRIC_OVERRIDE[row.rule_id] ?? row.metric_id ?? null;
      const isRestrictedForViewer =
        Boolean(effectiveMetricId) &&
        profile.isViewerOnly &&
        VIEWER_RESTRICTED_METRICS.has(effectiveMetricId!);

      const metricRow =
        effectiveMetricId && !isRestrictedForViewer
          ? metricCache.get(effectiveMetricId) ?? null
          : null;

      const snapshot: RuleMetricSnapshot | null = isRestrictedForViewer
        ? {
            metric_id: effectiveMetricId,
            value: null,
            computable: false,
            reason: 'Restricted for viewer role',
          }
        : metricRow
          ? {
              metric_id: effectiveMetricId,
              value: metricRow.value,
              computable: metricRow.computable,
              reason: metricRow.reason,
            }
          : effectiveMetricId
            ? {
                metric_id: effectiveMetricId,
                value: null,
                computable: false,
                reason: 'Metric unavailable',
              }
            : null;

      const evaluation = evaluateRuleBand(
        row.rule_id,
        snapshot,
        row.rule_id === 'EX-B2 (gate)'
          ? { notDueMessage: cashGateNotDueMessage }
          : undefined
      );

      return {
        rule_id: row.rule_id,
        kpi_id: row.kpi_id,
        kpi_name: row.kpi_name,
        bet_id: row.bet_id,
        metric_id: effectiveMetricId,
        evaluate_at: row.evaluate_at,
        keep_if: row.keep_if,
        change_if: row.change_if,
        escalate_if: row.escalate_if,
        response: row.response,
        owner_role: row.owner_role,
        decision_id: row.decision_id,
        rule_status: row.rule_status,
        current_value: metricRow?.value ?? null,
        current_numerator: metricRow?.numerator ?? null,
        current_denominator: metricRow?.denominator ?? null,
        current_unit: metricRow?.unit ?? null,
        computable: metricRow?.computable ?? false,
        reason:
          metricRow?.reason ??
          (isRestrictedForViewer ? 'Restricted for viewer role' : null),
        band: evaluation.band,
        status_label: evaluation.status_label,
        severity: evaluation.severity,
        record_class: editionCtx.record_class,
        as_of: asOf,
      };
    });

    res.status(200).json({
      edition_id: editionCtx.edition_id,
      record_class: editionCtx.record_class,
      as_of: asOf,
      rules,
    });
  });

  router.get(
    '/rules',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    handleGetRules
  );
  router.get(
    '/reference/rules',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    handleGetRules
  );

  // ---------------------------------------------------------------------------
  // 5. Reference Catalog Routes
  // ---------------------------------------------------------------------------
  router.get(
    '/reference/scenarios',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    asyncHandler(async (_req: Request, res: Response) => {
      const pool = ensurePool(dbState);
      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT scenario_id, name, status, status_label, expected_cash, p10, p50, p90,
                  window_pw, preseason_pw, decision_id, output_checksum, source_ref
             FROM public.scenario_reference
            WHERE NOT is_deleted
            ORDER BY scenario_id`
        )
      );
      const scenarios = qRes.rows.map((r) => ({
        ...r,
        expected_cash: toNum(r.expected_cash),
        p10: toNum(r.p10),
        p50: toNum(r.p50),
        p90: toNum(r.p90),
        window_pw: toNum(r.window_pw),
        preseason_pw: toNum(r.preseason_pw),
      }));
      res.status(200).json({ scenarios });
    })
  );

  router.get(
    '/reference/metrics',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    asyncHandler(async (_req: Request, res: Response) => {
      const pool = ensurePool(dbState);
      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT metric_id, name, kpi_id, business_meaning, formula, numerator, denominator,
                  aggregation, time_period, inclusion_exclusion, value_nature, unit,
                  computable_2025, example_value_2025, definition_version
             FROM public.metric_definition
            WHERE valid_to IS NULL AND NOT is_deleted
            ORDER BY metric_id`
        )
      );
      const metrics = qRes.rows.map((r) => ({
        ...r,
        example_value_2025: toNum(r.example_value_2025),
      }));
      res.status(200).json({ metrics });
    })
  );

  router.get(
    '/reference/kpis',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    asyncHandler(async (_req: Request, res: Response) => {
      const pool = ensurePool(dbState);
      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT kpi_id, name, bet_id, kpi_type, definition, grain, frequency, metric_id
             FROM public.kpi_definition
            WHERE valid_to IS NULL AND NOT is_deleted
            ORDER BY kpi_id`
        )
      );
      res.status(200).json({ kpis: qRes.rows });
    })
  );

  router.get(
    '/reference/bets',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    asyncHandler(async (_req: Request, res: Response) => {
      const pool = ensurePool(dbState);
      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT bet_id, name, rank, decision_id, scenarios
             FROM public.bet
            WHERE NOT is_deleted
            ORDER BY rank NULLS LAST, bet_id`
        )
      );
      const bets = qRes.rows.map((r) => ({
        ...r,
        rank: toNum(r.rank),
      }));
      res.status(200).json({ bets });
    })
  );

  router.get(
    '/reference/channels',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    asyncHandler(async (_req: Request, res: Response) => {
      const pool = ensurePool(dbState);
      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT channel_id, name, channel_group, is_active
             FROM public.channel
            WHERE NOT is_deleted
            ORDER BY channel_group, name`
        )
      );
      res.status(200).json({ channels: qRes.rows });
    })
  );

  router.get(
    '/reference/categories',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('sponsors_contacts_research'),
    asyncHandler(async (_req: Request, res: Response) => {
      const pool = ensurePool(dbState);
      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT category_id, name, parent_category_id, tier, dataset_industry, record_class
             FROM public.category
            WHERE NOT is_deleted
            ORDER BY name`
        )
      );
      res.status(200).json({ categories: qRes.rows });
    })
  );

  router.get(
    '/reference/experiments',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    asyncHandler(async (_req: Request, res: Response) => {
      const pool = ensurePool(dbState);
      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT experiment_id, bet_id, hypothesis, population, intervention,
                  sample_size, time_limit, primary_kpi_id, rule_id, status
             FROM public.experiment
            WHERE NOT is_deleted
            ORDER BY experiment_id`
        )
      );
      res.status(200).json({ experiments: qRes.rows });
    })
  );

  router.get(
    '/reference/assumptions',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    asyncHandler(async (_req: Request, res: Response) => {
      const pool = ensurePool(dbState);
      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT assumption_id, variable, frozen_value, unit, uncertainty,
                  status, rationale, validation_method, evidence_class
             FROM public.model_assumption
            WHERE NOT is_deleted
            ORDER BY assumption_id`
        )
      );
      res.status(200).json({ assumptions: qRes.rows });
    })
  );

  router.get(
    '/reference/decisions',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    asyncHandler(async (_req: Request, res: Response) => {
      const pool = ensurePool(dbState);
      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT decision_id, title, status, approved_at, approved_by,
                  superseded_by_id, document_uri, evidence_class
             FROM public.decision_record
            WHERE NOT is_deleted
            ORDER BY decision_id`
        )
      );
      res.status(200).json({ decisions: qRes.rows });
    })
  );

  router.get(
    '/reference/assets',
    authMiddleware,
    resolveReadRoles,
    asyncHandler(async (req: Request, res: Response) => {
      const roles = req.resolvedMember?.roles ?? [];
      const canReadAssets =
        evaluatePermission(roles, 'contracts_lines', 'read').allowed ||
        evaluatePermission(roles, 'opportunities_stage', 'read').allowed ||
        evaluatePermission(roles, 'targets_rules_scenarios_metrics', 'read').allowed;
      if (!canReadAssets) {
        throw new AppApiError(403, 'FORBIDDEN', 'Role lacks permission to read inventory assets.');
      }

      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      const pool = ensurePool(dbState);
      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT asset_id, edition_id, asset_type, slots_total, deliverables,
                  is_premium, record_class
             FROM public.inventory_asset
            WHERE edition_id = $1
              AND NOT is_deleted
            ORDER BY asset_type, asset_id`,
          [editionCtx.edition_id]
        )
      );
      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        assets: qRes.rows.map((r) => ({
          ...r,
          slots_total: toNum(r.slots_total),
          is_premium: Boolean(r.is_premium),
        })),
      });
    })
  );

  // ---------------------------------------------------------------------------
  // 6. GET /api/team & GET /api/team-members
  // ---------------------------------------------------------------------------
  const handleGetTeam = asyncHandler(async (req: Request, res: Response) => {
    const roles = req.resolvedMember?.roles ?? [];
    const canReadTeam =
      roles.includes('admin') ||
      evaluatePermission(roles, 'targets_rules_scenarios_metrics', 'read').allowed;
    if (!canReadTeam) {
      throw new AppApiError(
        403,
        'FORBIDDEN',
        'Role lacks permission to read team members.'
      );
    }

    const { editionId, requestedRecordClass } = parseEditionAndClass(
      req,
      config.editionIdDefault
    );
    const editionCtx = await resolveEditionContext(
      dbState,
      editionId,
      requestedRecordClass
    );
    const roleEditionId =
      editionCtx.record_class === 'historical_synthetic'
        ? config.editionIdDefault
        : editionCtx.edition_id;
    const pool = ensurePool(dbState);

    const qRes = await wrapDb(
      pool.query<{
        member_id: string;
        full_name: string;
        email: string | null;
        auth_linked: boolean;
        fte_share: string | number | null;
        active_from: Date | string | null;
        active_to: Date | string | null;
        is_active: boolean;
        record_class: string;
        roles: string[] | null;
        role_assignments: Array<{
          role_assignment_id: string;
          role: string;
          edition_id: string;
          valid_from: string | null;
        }> | null;
      }>(
        `SELECT tm.member_id, tm.full_name, tm.email,
                (tm.auth_user_id IS NOT NULL) AS auth_linked,
                tm.fte_share,
                tm.active_from, tm.active_to, tm.is_active, tm.record_class,
                COALESCE(
                  array_agg(DISTINCT ra.role) FILTER (WHERE ra.role IS NOT NULL),
                  ARRAY[]::text[]
                ) AS roles,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'role_assignment_id', ra.role_assignment_id,
                      'role', ra.role,
                      'edition_id', ra.edition_id,
                      'valid_from', ra.valid_from
                    )
                    ORDER BY ra.valid_from DESC, ra.role_assignment_id
                  ) FILTER (WHERE ra.role_assignment_id IS NOT NULL),
                  '[]'::json
                ) AS role_assignments
           FROM public.team_member tm
           LEFT JOIN public.role_assignment ra
             ON ra.member_id = tm.member_id
            AND ra.edition_id = $2
            AND ra.is_current = true
            AND ra.valid_to IS NULL
            AND NOT ra.is_deleted
          WHERE tm.record_class = $1
            AND NOT tm.is_deleted
          GROUP BY tm.member_id
          ORDER BY tm.full_name, tm.member_id`,
        [editionCtx.record_class, roleEditionId]
      )
    );

    const { profile } = getScopeProfile(req);
    const members = qRes.rows.map((row) => ({
      member_id: row.member_id,
      full_name: row.full_name,
      email: profile.redactPii ? null : row.email,
      auth_linked: Boolean(row.auth_linked),
      fte_share: toNum(row.fte_share),
      active_from: toIsoDateOnly(row.active_from),
      active_to: toIsoDateOnly(row.active_to),
      is_active: Boolean(row.is_active),
      record_class: row.record_class,
      roles: row.roles ?? [],
      role_assignments: Array.isArray(row.role_assignments)
        ? row.role_assignments
        : [],
    }));

    res.status(200).json({
      edition_id: editionCtx.edition_id,
      record_class: editionCtx.record_class,
      team: members,
      members,
    });
  });

  router.get(
    '/team',
    authMiddleware,
    resolveReadRoles,
    handleGetTeam
  );
  router.get(
    '/team-members',
    authMiddleware,
    resolveReadRoles,
    handleGetTeam
  );

  // ---------------------------------------------------------------------------
  // 7. GET /api/sponsors & GET /api/sponsors/:id
  // ---------------------------------------------------------------------------
  async function loadSponsorById(
    sponsorId: string,
    editionId: string,
    recordClass: string,
    actorMemberId: string,
    profile: ScopeAndRedactionProfile
  ) {
    const pool = ensurePool(dbState);

    const spParams: unknown[] = [sponsorId, recordClass];
    let ownerGuardSql = '';
    if (profile.sponsorsScope === 'own') {
      spParams.push(actorMemberId);
      ownerGuardSql = `AND (
        EXISTS (
          SELECT 1 FROM public.ownership_assignment oa_chk
           WHERE oa_chk.subject_type = 'sponsor'
             AND oa_chk.subject_id = s.sponsor_id
             AND oa_chk.record_class = s.record_class
             AND oa_chk.member_id = $3
             AND oa_chk.valid_to IS NULL
             AND NOT oa_chk.is_deleted
        ) OR s.created_by = $3
      )`;
    }

    const spRes = await wrapDb(
      pool.query<Record<string, unknown>>(
        `SELECT s.sponsor_id, s.display_name, s.legal_name, s.category_id,
                c.name AS category_name, s.lifecycle_status, s.first_source,
                s.gstin, s.website, s.city, s.record_class, s.source_ref,
                s.evidence_class, s.data_version, s.created_at, s.created_by
           FROM public.sponsor s
           LEFT JOIN public.category c ON c.category_id = s.category_id AND NOT c.is_deleted
          WHERE s.sponsor_id = $1
            AND s.record_class = $2
            AND NOT s.is_deleted
            ${ownerGuardSql}
          LIMIT 1`,
        spParams
      )
    );

    const spRow = spRes.rows[0];
    if (!spRow) {
      return null;
    }

    const [
      contactsRes,
      ownershipRes,
      qualRes,
      researchRes,
      oppsRes,
      outreachRes,
      interactionsRes,
    ] = await Promise.all([
      wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT contact_id, sponsor_id, full_name, job_title, decision_role,
                  email, phone, consent_basis, opted_out_at, record_class,
                  source_ref, data_version, created_at, created_by
             FROM public.contact
            WHERE sponsor_id = $1 AND record_class = $2 AND NOT is_deleted
            ORDER BY created_at ASC`,
          [sponsorId, recordClass]
        )
      ),
      wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT oa.assignment_id, oa.subject_type, oa.subject_id, oa.member_id,
                  tm.full_name AS member_name, oa.role_in_relationship, oa.reason,
                  oa.valid_from, oa.valid_to, oa.version_no, oa.record_class, oa.created_by
             FROM public.ownership_assignment oa
             LEFT JOIN public.team_member tm ON tm.member_id = oa.member_id
            WHERE oa.subject_type = 'sponsor'
              AND oa.subject_id = $1
              AND oa.record_class = $2
              AND NOT oa.is_deleted
            ORDER BY oa.valid_from DESC, oa.version_no DESC`,
          [sponsorId, recordClass]
        )
      ),
      wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT qv.history_id, qv.sponsor_id, qv.edition_id, qv.source_campaign_id,
                  qv.status, qv.reason, qv.checklist_passed, qv.valid_from, qv.valid_to,
                  qv.version_no, qv.record_class
             FROM public.qualification_version qv
            WHERE qv.sponsor_id = $1 AND qv.edition_id = $2 AND qv.record_class = $3
              AND NOT qv.is_deleted
            ORDER BY qv.valid_from DESC, qv.version_no DESC`,
          [sponsorId, editionId, recordClass]
        )
      ),
      wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT research_id, sponsor_id, edition_id, attractiveness, accessibility,
                  route_class, action, value_track, face_value_low, face_value_high,
                  evidence_source_ids, assessed_at, valid_from, valid_to, version_no, record_class
             FROM public.prospect_research
            WHERE sponsor_id = $1
              AND (edition_id = $2 OR edition_id IS NULL)
              AND NOT is_deleted
            ORDER BY valid_from DESC, version_no DESC`,
          [sponsorId, editionId]
        )
      ),
      wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT o.opportunity_id, o.sponsor_id, o.edition_id, o.primary_contact_id,
                  o.originating_campaign_id, camp.name AS originating_campaign_name,
                  o.bet_id, o.support_type, o.is_renewal, o.renewal_route,
                  o.recovered_lead, o.name, o.record_class,
                  sv.stage, sv.owner_member_id, tm.full_name AS owner_name,
                  sv.proposed_value, sv.confirmed_value, sv.drop_reason, sv.loss_reason,
                  sv.valid_from AS stage_valid_from
             FROM public.opportunity o
             LEFT JOIN public.campaign camp ON camp.campaign_id = o.originating_campaign_id
             LEFT JOIN LATERAL (
               SELECT * FROM public.opportunity_stage_version osv
                WHERE osv.opportunity_id = o.opportunity_id
                  AND NOT osv.is_deleted
                ORDER BY osv.valid_from DESC, osv.history_id DESC
                LIMIT 1
             ) sv ON true
             LEFT JOIN public.team_member tm ON tm.member_id = sv.owner_member_id
            WHERE o.sponsor_id = $1 AND o.edition_id = $2 AND o.record_class = $3
              AND NOT o.is_deleted
            ORDER BY o.created_at DESC`,
          [sponsorId, editionId, recordClass]
        )
      ),
      wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT oa.attempt_id, oa.campaign_id, camp.name AS campaign_name,
                  oa.sponsor_id, oa.contact_id, oa.referral_id, oa.owner_member_id,
                  tm.full_name AS owner_name, oa.started_at, oa.root_event_type, oa.record_class
             FROM public.outreach_attempt oa
             JOIN public.campaign camp ON camp.campaign_id = oa.campaign_id
             LEFT JOIN public.team_member tm ON tm.member_id = oa.owner_member_id
            WHERE oa.sponsor_id = $1 AND camp.edition_id = $2 AND oa.record_class = $3
              AND NOT oa.is_deleted
            ORDER BY oa.started_at DESC`,
          [sponsorId, editionId, recordClass]
        )
      ),
      wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT i.interaction_id, i.attempt_id, i.event_type, i.outcome,
                  i.occurred_at, i.summary, i.logged_by, tm.full_name AS logged_by_name,
                  i.record_class
             FROM public.interaction i
             JOIN public.outreach_attempt oa ON oa.attempt_id = i.attempt_id
             JOIN public.campaign camp ON camp.campaign_id = oa.campaign_id
             LEFT JOIN public.team_member tm ON tm.member_id = i.logged_by
            WHERE oa.sponsor_id = $1 AND camp.edition_id = $2 AND i.record_class = $3
              AND NOT i.is_deleted
            ORDER BY i.occurred_at DESC`,
          [sponsorId, editionId, recordClass]
        )
      ),
    ]);

    const currentOwner =
      ownershipRes.rows.find(
        (r) => r.valid_to === null && r.role_in_relationship === 'owner'
      ) ?? ownershipRes.rows.find((r) => r.valid_to === null) ?? null;

    const currentQualification =
      qualRes.rows.find((r) => r.valid_to === null) ?? qualRes.rows[0] ?? null;

    const currentResearch =
      researchRes.rows.find((r) => r.valid_to === null) ?? researchRes.rows[0] ?? null;

    const contacts = contactsRes.rows.map((c) => ({
      ...c,
      email: profile.redactPii ? null : c.email ?? null,
      phone: profile.redactPii ? null : c.phone ?? null,
      pii_redacted: profile.redactPii,
    }));

    return {
      ...spRow,
      gstin: profile.redactPii ? null : spRow.gstin ?? null,
      gstin_redacted: profile.redactPii,
      owner_member_id: currentOwner?.member_id ?? null,
      owner_name: currentOwner?.member_name ?? null,
      qualification_status: currentQualification?.status ?? null,
      current_ownership: currentOwner,
      ownership_history: ownershipRes.rows,
      current_qualification: currentQualification,
      qualification_history: qualRes.rows,
      prospect_research: currentResearch
        ? {
            ...currentResearch,
            attractiveness: toNum(currentResearch.attractiveness),
            accessibility: toNum(currentResearch.accessibility),
            face_value_low: toNum(currentResearch.face_value_low),
            face_value_high: toNum(currentResearch.face_value_high),
            assessed_at: toIsoDateOnly(currentResearch.assessed_at),
          }
        : null,
      research_history: researchRes.rows.map((r) => ({
        ...r,
        attractiveness: toNum(r.attractiveness),
        accessibility: toNum(r.accessibility),
        face_value_low: toNum(r.face_value_low),
        face_value_high: toNum(r.face_value_high),
        assessed_at: toIsoDateOnly(r.assessed_at),
      })),
      contacts,
      opportunities: oppsRes.rows.map((o) => ({
        ...o,
        proposed_value: toNum(o.proposed_value),
        confirmed_value: toNum(o.confirmed_value),
      })),
      outreach: outreachRes.rows,
      interactions: interactionsRes.rows,
    };
  }

  router.get(
    '/sponsors',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('sponsors_contacts_research'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      const { actorMemberId, profile } = getScopeProfile(req);

      const sponsorIdParam = getQueryString(req, 'sponsor_id', 'sponsorId');
      if (sponsorIdParam) {
        const sponsor = await loadSponsorById(
          sponsorIdParam,
          editionCtx.edition_id,
          editionCtx.record_class,
          actorMemberId,
          profile
        );
        if (!sponsor) {
          throw new AppApiError(404, 'NOT_FOUND', `Sponsor "${sponsorIdParam}" was not found.`);
        }
        res.status(200).json({ sponsor, sponsors: [sponsor] });
        return;
      }

      const pool = ensurePool(dbState);
      const search = getQueryString(req, 'search', 'q');
      const lifecycle = getQueryString(req, 'lifecycle_status', 'lifecycleStatus');
      const categoryId = getQueryString(req, 'category_id', 'categoryId');
      const firstSource = getQueryString(req, 'first_source', 'firstSource');
      const city = getQueryString(req, 'city');

      const params: unknown[] = [editionCtx.record_class, editionCtx.edition_id];
      const where: string[] = [
        's.record_class = $1',
        'NOT s.is_deleted',
      ];

      if (profile.sponsorsScope === 'own') {
        params.push(actorMemberId);
        where.push(`(oa.member_id = $${params.length} OR s.created_by = $${params.length})`);
      }
      if (search) {
        params.push(`%${search}%`);
        where.push(
          `(s.display_name ILIKE $${params.length} OR COALESCE(s.legal_name, '') ILIKE $${params.length} OR COALESCE(c.name, '') ILIKE $${params.length})`
        );
      }
      if (lifecycle && lifecycle !== 'all') {
        params.push(lifecycle);
        where.push(`s.lifecycle_status = $${params.length}`);
      }
      if (categoryId && categoryId !== 'all') {
        params.push(categoryId);
        where.push(`s.category_id = $${params.length}`);
      }
      if (firstSource && firstSource !== 'all') {
        params.push(firstSource);
        where.push(`s.first_source = $${params.length}`);
      }
      if (city && city !== 'all') {
        params.push(city);
        where.push(`s.city = $${params.length}`);
      }

      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT s.sponsor_id, s.display_name, s.legal_name, s.category_id,
                  c.name AS category_name, s.lifecycle_status, s.first_source,
                  s.gstin, s.website, s.city, s.record_class, s.source_ref,
                  s.evidence_class, s.data_version, s.created_at, s.created_by,
                  oa.member_id AS owner_member_id,
                  tm.full_name AS owner_name,
                  qv.status AS qualification_status,
                  pr.route_class, pr.action AS research_action,
                  pr.attractiveness, pr.accessibility
             FROM public.sponsor s
             LEFT JOIN public.category c ON c.category_id = s.category_id AND NOT c.is_deleted
             LEFT JOIN LATERAL (
               SELECT member_id FROM public.ownership_assignment oax
                WHERE oax.subject_type = 'sponsor'
                  AND oax.subject_id = s.sponsor_id
                  AND oax.record_class = s.record_class
                  AND oax.valid_to IS NULL
                  AND NOT oax.is_deleted
                ORDER BY CASE WHEN oax.role_in_relationship = 'owner' THEN 0 ELSE 1 END,
                         oax.valid_from DESC
                LIMIT 1
             ) oa ON true
             LEFT JOIN public.team_member tm ON tm.member_id = oa.member_id
             LEFT JOIN LATERAL (
               SELECT status FROM public.qualification_version qvx
                WHERE qvx.sponsor_id = s.sponsor_id
                  AND qvx.edition_id = $2
                  AND qvx.record_class = s.record_class
                  AND qvx.valid_to IS NULL
                  AND NOT qvx.is_deleted
                ORDER BY qvx.valid_from DESC, qvx.version_no DESC
                LIMIT 1
             ) qv ON true
             LEFT JOIN LATERAL (
               SELECT route_class, action, attractiveness, accessibility
                 FROM public.prospect_research prx
                WHERE prx.sponsor_id = s.sponsor_id
                  AND (prx.edition_id = $2 OR prx.edition_id IS NULL)
                  AND prx.valid_to IS NULL
                  AND NOT prx.is_deleted
                ORDER BY prx.valid_from DESC, prx.version_no DESC
                LIMIT 1
             ) pr ON true
            WHERE ${where.join(' AND ')}
            ORDER BY s.display_name ASC`,
          params
        )
      );

      const sponsors = qRes.rows.map((row) => ({
        ...row,
        gstin: profile.redactPii ? null : row.gstin ?? null,
        gstin_redacted: profile.redactPii,
        attractiveness: toNum(row.attractiveness),
        accessibility: toNum(row.accessibility),
      }));

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        sponsors,
      });
    })
  );

  router.get(
    '/sponsors/:id',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('sponsors_contacts_research'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      const { actorMemberId, profile } = getScopeProfile(req);

      const sponsor = await loadSponsorById(
        req.params.id,
        editionCtx.edition_id,
        editionCtx.record_class,
        actorMemberId,
        profile
      );
      if (!sponsor) {
        throw new AppApiError(
          404,
          'NOT_FOUND',
          `Sponsor "${req.params.id}" was not found.`
        );
      }

      res.status(200).json({ sponsor });
    })
  );

  // ---------------------------------------------------------------------------
  // 8. GET /api/contacts
  // ---------------------------------------------------------------------------
  router.get(
    '/contacts',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('sponsors_contacts_research'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      const { actorMemberId, profile } = getScopeProfile(req);
      const pool = ensurePool(dbState);

      const sponsorId = getQueryString(req, 'sponsor_id', 'sponsorId');
      const params: unknown[] = [editionCtx.record_class];
      const where = ['c.record_class = $1', 'NOT c.is_deleted'];

      if (sponsorId) {
        params.push(sponsorId);
        where.push(`c.sponsor_id = $${params.length}`);
      }

      if (profile.sponsorsScope === 'own') {
        params.push(actorMemberId);
        where.push(`(
          EXISTS (
            SELECT 1 FROM public.ownership_assignment oa
             WHERE oa.subject_type = 'sponsor'
               AND oa.subject_id = c.sponsor_id
               AND oa.record_class = c.record_class
               AND oa.member_id = $${params.length}
               AND oa.valid_to IS NULL
               AND NOT oa.is_deleted
          ) OR c.created_by = $${params.length}
        )`);
      }

      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT c.contact_id, c.sponsor_id, s.display_name AS sponsor_name,
                  c.full_name, c.job_title, c.decision_role, c.email, c.phone,
                  c.consent_basis, c.opted_out_at, c.record_class, c.source_ref,
                  c.data_version, c.created_at, c.created_by
             FROM public.contact c
             JOIN public.sponsor s ON s.sponsor_id = c.sponsor_id AND NOT s.is_deleted
            WHERE ${where.join(' AND ')}
            ORDER BY s.display_name, c.full_name`,
          params
        )
      );

      const contacts = qRes.rows.map((row) => ({
        ...row,
        email: profile.redactPii ? null : row.email ?? null,
        phone: profile.redactPii ? null : row.phone ?? null,
        pii_redacted: profile.redactPii,
      }));

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        contacts,
      });
    })
  );

  // ---------------------------------------------------------------------------
  // 9. GET /api/campaigns & GET /api/campaigns/:id
  // ---------------------------------------------------------------------------
  async function loadCampaigns(
    editionId: string,
    recordClass: string,
    filters: {
      campaignId?: string | null;
      channelId?: string | null;
      betId?: string | null;
      status?: string | null;
      ownerMemberId?: string | null;
      search?: string | null;
    }
  ) {
    const pool = ensurePool(dbState);
    const params: unknown[] = [editionId, recordClass];
    const where: string[] = [
      'c.edition_id = $1',
      'c.record_class = $2',
      'NOT c.is_deleted',
    ];

    if (filters.campaignId) {
      params.push(filters.campaignId);
      where.push(`c.campaign_id = $${params.length}`);
    }
    if (filters.channelId && filters.channelId !== 'all') {
      params.push(filters.channelId);
      where.push(`c.channel_id = $${params.length}`);
    }
    if (filters.betId && filters.betId !== 'all') {
      params.push(filters.betId);
      where.push(`c.bet_id = $${params.length}`);
    }
    if (filters.status && filters.status !== 'all') {
      params.push(filters.status);
      where.push(`c.status = $${params.length}`);
    }
    if (filters.ownerMemberId && filters.ownerMemberId !== 'all') {
      params.push(filters.ownerMemberId);
      where.push(`c.owner_member_id = $${params.length}`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      where.push(
        `(c.name ILIKE $${params.length} OR COALESCE(c.objective, '') ILIKE $${params.length})`
      );
    }

    const qRes = await wrapDb(
      pool.query<Record<string, unknown>>(
        `SELECT c.campaign_id, c.edition_id, c.name, c.channel_id,
                ch.name AS channel_name, ch.channel_group,
                c.bet_id, b.name AS bet_name,
                c.owner_member_id, tm.full_name AS owner_name,
                c.planned_start, c.planned_end, c.objective, c.status,
                c.record_class, c.source_ref, c.data_version, c.created_at, c.created_by
           FROM public.campaign c
           LEFT JOIN public.channel ch ON ch.channel_id = c.channel_id
           LEFT JOIN public.bet b ON b.bet_id = c.bet_id
           LEFT JOIN public.team_member tm ON tm.member_id = c.owner_member_id
          WHERE ${where.join(' AND ')}
          ORDER BY c.planned_start ASC NULLS LAST, c.campaign_id`,
        params
      )
    );

    return qRes.rows;
  }

  router.get(
    '/campaigns',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );

      const campaignId = getQueryString(req, 'campaign_id', 'campaignId');
      const campaigns = await loadCampaigns(
        editionCtx.edition_id,
        editionCtx.record_class,
        {
          campaignId,
          channelId: getQueryString(req, 'channel_id', 'channelId'),
          betId: getQueryString(req, 'bet_id', 'betId'),
          status: getQueryString(req, 'status'),
          ownerMemberId: getQueryString(req, 'owner_member_id', 'ownerMemberId'),
          search: getQueryString(req, 'search', 'q'),
        }
      );

      if (campaignId && campaigns.length === 0) {
        throw new AppApiError(404, 'NOT_FOUND', `Campaign "${campaignId}" was not found.`);
      }

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        ...(campaignId ? { campaign: campaigns[0] } : {}),
        campaigns,
      });
    })
  );

  router.get(
    '/campaigns/:id',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      const campaigns = await loadCampaigns(
        editionCtx.edition_id,
        editionCtx.record_class,
        { campaignId: req.params.id }
      );
      if (campaigns.length === 0) {
        throw new AppApiError(404, 'NOT_FOUND', `Campaign "${req.params.id}" was not found.`);
      }
      res.status(200).json({ campaign: campaigns[0] });
    })
  );

  // ---------------------------------------------------------------------------
  // 10. GET /api/opportunities & GET /api/opportunities/:id
  // ---------------------------------------------------------------------------
  async function loadOpportunitiesList(
    editionId: string,
    recordClass: string,
    actorMemberId: string,
    profile: ScopeAndRedactionProfile,
    filters: {
      opportunityId?: string | null;
      sponsorId?: string | null;
      stage?: string | null;
      ownerMemberId?: string | null;
      supportType?: string | null;
      betId?: string | null;
      originatingCampaignId?: string | null;
      categoryId?: string | null;
      isRenewal?: string | null;
      recoveredLead?: string | null;
      search?: string | null;
    }
  ) {
    const pool = ensurePool(dbState);
    const params: unknown[] = [editionId, recordClass];
    const where: string[] = [
      'o.edition_id = $1',
      'o.record_class = $2',
      'NOT o.is_deleted',
    ];

    if (profile.opportunitiesScope === 'own') {
      params.push(actorMemberId);
      where.push(`(
        sv.owner_member_id = $${params.length}
        OR o.created_by = $${params.length}
        OR EXISTS (
          SELECT 1 FROM public.ownership_assignment oa
           WHERE oa.subject_type IN ('sponsor', 'opportunity')
             AND oa.subject_id IN (o.opportunity_id, o.sponsor_id)
             AND oa.record_class = o.record_class
             AND oa.member_id = $${params.length}
             AND oa.valid_to IS NULL
             AND NOT oa.is_deleted
        )
      )`);
    }

    if (filters.opportunityId) {
      params.push(filters.opportunityId);
      where.push(`o.opportunity_id = $${params.length}`);
    }
    if (filters.sponsorId) {
      params.push(filters.sponsorId);
      where.push(`o.sponsor_id = $${params.length}`);
    }
    if (filters.stage && filters.stage !== 'all') {
      params.push(filters.stage);
      where.push(`sv.stage = $${params.length}`);
    }
    if (filters.ownerMemberId && filters.ownerMemberId !== 'all') {
      params.push(filters.ownerMemberId);
      where.push(`sv.owner_member_id = $${params.length}`);
    }
    if (filters.supportType && filters.supportType !== 'all') {
      params.push(filters.supportType);
      where.push(`o.support_type = $${params.length}`);
    }
    if (filters.betId && filters.betId !== 'all') {
      params.push(filters.betId);
      where.push(`o.bet_id = $${params.length}`);
    }
    if (filters.originatingCampaignId && filters.originatingCampaignId !== 'all') {
      params.push(filters.originatingCampaignId);
      where.push(`o.originating_campaign_id = $${params.length}`);
    }
    if (filters.categoryId && filters.categoryId !== 'all') {
      params.push(filters.categoryId);
      where.push(`s.category_id = $${params.length}`);
    }
    if (filters.isRenewal === 'true' || filters.isRenewal === 'false') {
      params.push(filters.isRenewal === 'true');
      where.push(`o.is_renewal = $${params.length}`);
    }
    if (filters.recoveredLead === 'true' || filters.recoveredLead === 'false') {
      params.push(filters.recoveredLead === 'true');
      where.push(`o.recovered_lead = $${params.length}`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      where.push(
        `(COALESCE(o.name, '') ILIKE $${params.length} OR s.display_name ILIKE $${params.length} OR COALESCE(cat.name, '') ILIKE $${params.length})`
      );
    }

    const qRes = await wrapDb(
      pool.query<Record<string, unknown>>(
        `SELECT o.opportunity_id, o.sponsor_id, s.display_name AS sponsor_name,
                s.category_id AS sponsor_category_id, cat.name AS sponsor_category_name,
                o.edition_id, o.primary_contact_id, pc.full_name AS primary_contact_name,
                o.originating_campaign_id, camp.name AS originating_campaign_name,
                o.bet_id, b.name AS bet_name, o.support_type, o.is_renewal,
                o.renewal_route, o.recovered_lead, o.name, o.record_class,
                o.source_ref, o.data_version, o.created_at, o.created_by,
                sv.history_id AS stage_history_id, sv.stage, sv.owner_member_id,
                tm.full_name AS owner_name, sv.proposed_value, sv.confirmed_value,
                sv.drop_reason, sv.loss_reason, sv.valid_from AS stage_valid_from,
                sv.valid_to AS stage_valid_to, sv.version_no AS stage_version_no
           FROM public.opportunity o
           JOIN public.sponsor s ON s.sponsor_id = o.sponsor_id
           LEFT JOIN public.category cat ON cat.category_id = s.category_id
           LEFT JOIN public.contact pc ON pc.contact_id = o.primary_contact_id
           LEFT JOIN public.campaign camp ON camp.campaign_id = o.originating_campaign_id
           LEFT JOIN public.bet b ON b.bet_id = o.bet_id
           LEFT JOIN LATERAL (
             SELECT * FROM public.opportunity_stage_version osv
              WHERE osv.opportunity_id = o.opportunity_id
                AND NOT osv.is_deleted
              ORDER BY osv.valid_from DESC, osv.history_id DESC
              LIMIT 1
           ) sv ON true
           LEFT JOIN public.team_member tm ON tm.member_id = sv.owner_member_id
          WHERE ${where.join(' AND ')}
          ORDER BY sv.valid_from DESC NULLS LAST, o.opportunity_id`,
        params
      )
    );

    return qRes.rows.map((row) => ({
      opportunity_id: row.opportunity_id,
      sponsor_id: row.sponsor_id,
      sponsor_name: row.sponsor_name,
      sponsor_category_id: row.sponsor_category_id,
      sponsor_category_name: row.sponsor_category_name,
      edition_id: row.edition_id,
      primary_contact_id: row.primary_contact_id,
      primary_contact_name: row.primary_contact_name,
      originating_campaign_id: row.originating_campaign_id,
      originating_campaign_name: row.originating_campaign_name,
      bet_id: row.bet_id,
      bet_name: row.bet_name,
      support_type: row.support_type,
      is_renewal: Boolean(row.is_renewal),
      renewal_route: row.renewal_route,
      recovered_lead: Boolean(row.recovered_lead),
      name: row.name,
      record_class: row.record_class,
      source_ref: row.source_ref,
      data_version: row.data_version,
      created_at: row.created_at,
      created_by: row.created_by,
      stage: row.stage ?? null,
      owner_member_id: row.owner_member_id ?? null,
      owner_name: row.owner_name ?? null,
      proposed_value: toNum(row.proposed_value),
      confirmed_value: toNum(row.confirmed_value),
      current_stage_version: row.stage_history_id
        ? {
            history_id: row.stage_history_id,
            opportunity_id: row.opportunity_id,
            stage: row.stage,
            owner_member_id: row.owner_member_id,
            owner_name: row.owner_name,
            proposed_value: toNum(row.proposed_value),
            confirmed_value: toNum(row.confirmed_value),
            drop_reason: row.drop_reason,
            loss_reason: row.loss_reason,
            valid_from: row.stage_valid_from,
            valid_to: row.stage_valid_to,
            version_no: toNum(row.stage_version_no) ?? 1,
          }
        : null,
    }));
  }

  router.get(
    '/opportunities',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('opportunities_stage'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      const { actorMemberId, profile } = getScopeProfile(req);

      const opportunityId = getQueryString(req, 'opportunity_id', 'opportunityId');
      const opportunities = await loadOpportunitiesList(
        editionCtx.edition_id,
        editionCtx.record_class,
        actorMemberId,
        profile,
        {
          opportunityId,
          sponsorId: getQueryString(req, 'sponsor_id', 'sponsorId'),
          stage: getQueryString(req, 'stage'),
          ownerMemberId: getQueryString(req, 'owner_member_id', 'ownerMemberId'),
          supportType: getQueryString(req, 'support_type', 'supportType'),
          betId: getQueryString(req, 'bet_id', 'betId'),
          originatingCampaignId: getQueryString(
            req,
            'originating_campaign_id',
            'originatingCampaignId'
          ),
          categoryId: getQueryString(req, 'category_id', 'categoryId'),
          isRenewal: getQueryString(req, 'is_renewal', 'isRenewal'),
          recoveredLead: getQueryString(req, 'recovered_lead', 'recoveredLead'),
          search: getQueryString(req, 'search', 'q'),
        }
      );

      if (opportunityId && opportunities.length === 0) {
        throw new AppApiError(404, 'NOT_FOUND', `Opportunity "${opportunityId}" was not found.`);
      }

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        ...(opportunityId ? { opportunity: opportunities[0] } : {}),
        opportunities,
      });
    })
  );

  router.get(
    '/opportunities/:id',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('opportunities_stage'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      const { actorMemberId, profile } = getScopeProfile(req);

      const rows = await loadOpportunitiesList(
        editionCtx.edition_id,
        editionCtx.record_class,
        actorMemberId,
        profile,
        { opportunityId: req.params.id }
      );
      const opportunity = rows[0];
      if (!opportunity) {
        throw new AppApiError(
          404,
          'NOT_FOUND',
          `Opportunity "${req.params.id}" was not found.`
        );
      }

      const pool = ensurePool(dbState);
      const [stageHistoryRes, proposalsRes, contractsRes] = await Promise.all([
        wrapDb(
          pool.query<Record<string, unknown>>(
            `SELECT osv.history_id, osv.opportunity_id, osv.stage,
                    osv.owner_member_id, tm.full_name AS owner_name,
                    osv.proposed_value, osv.confirmed_value, osv.drop_reason,
                    osv.loss_reason, osv.valid_from, osv.valid_to, osv.version_no,
                    osv.record_class, osv.created_by
               FROM public.opportunity_stage_version osv
               LEFT JOIN public.team_member tm ON tm.member_id = osv.owner_member_id
              WHERE osv.opportunity_id = $1 AND NOT osv.is_deleted
              ORDER BY osv.valid_from DESC, osv.history_id DESC`,
            [req.params.id]
          )
        ),
        editionCtx.record_class === 'historical_synthetic'
          ? Promise.resolve({ rows: [] as Array<Record<string, unknown>> })
          : wrapDb(
              pool.query<Record<string, unknown>>(
                `SELECT p.proposal_id, p.opportunity_id, p.package_id,
                        pkg.name AS package_name, p.proposed_value,
                        p.exclusivity_requested, p.sent_at, p.valid_until,
                        p.status, p.document_uri, p.valid_from, p.valid_to,
                        p.version_no, p.record_class
                   FROM public.proposal p
                   LEFT JOIN public.package pkg ON pkg.package_id = p.package_id
                  WHERE p.opportunity_id = $1 AND p.valid_to IS NULL AND NOT p.is_deleted
                  ORDER BY p.valid_from DESC, p.version_no DESC`,
                [req.params.id]
              )
            ),
        editionCtx.record_class === 'historical_synthetic'
          ? Promise.resolve({ rows: [] as Array<Record<string, unknown>> })
          : wrapDb(
              pool.query<Record<string, unknown>>(
                `SELECT c.contract_id, c.opportunity_id, c.signed_at,
                        c.signed_value_total, c.payment_terms,
                        c.signatory_contact_id, ct.full_name AS signatory_name,
                        c.document_uri, c.status, c.record_class
                   FROM public.contract c
                   LEFT JOIN public.contact ct ON ct.contact_id = c.signatory_contact_id
                  WHERE c.opportunity_id = $1 AND c.valid_to IS NULL AND NOT c.is_deleted
                  ORDER BY c.signed_at DESC`,
                [req.params.id]
              )
            ),
      ]);

      const contracts = await Promise.all(
        contractsRes.rows.map(async (c) => {
          const cid = String(c.contract_id);
          const linesRes = await wrapDb(
            pool.query<Record<string, unknown>>(
              `SELECT cl.contract_line_id, cl.contract_id, cl.asset_id,
                      ia.asset_type, cl.consideration_type, cl.value, cl.price_id,
                      cl.record_class
                 FROM public.contract_line cl
                 LEFT JOIN public.inventory_asset ia ON ia.asset_id = cl.asset_id
                WHERE cl.contract_id = $1 AND NOT cl.is_deleted
                ORDER BY cl.contract_line_id`,
              [cid]
            )
          );

          if (profile.redactFinancials) {
            return {
              ...c,
              signed_value_total: toNum(c.signed_value_total),
              lines: linesRes.rows.map((l) => ({ ...l, value: toNum(l.value) })),
              balance_view: null,
              payment_schedule: [],
              invoices: [],
              receipts: [],
              allocations: [],
              redacted_financials: true,
            };
          }

          const [schedRes, invRes, allocRes] = await Promise.all([
            wrapDb(
              pool.query<Record<string, unknown>>(
                `SELECT * FROM public.payment_schedule_item_status_view
                  WHERE contract_id = $1
                  ORDER BY due_date ASC`,
                [cid]
              )
            ),
            wrapDb(
              pool.query<Record<string, unknown>>(
                `SELECT * FROM public.invoice
                  WHERE contract_id = $1 AND NOT is_deleted
                  ORDER BY issued_at DESC`,
                [cid]
              )
            ),
            profile.receiptsScope === 'none'
              ? Promise.resolve({ rows: [] as Array<Record<string, unknown>> })
              : wrapDb(
                  pool.query<Record<string, unknown>>(
                    `SELECT ra.allocation_id, ra.receipt_id, ra.invoice_id,
                            ra.schedule_item_id, ra.amount, ra.record_class
                       FROM public.receipt_allocation ra
                       LEFT JOIN public.payment_schedule_item psi ON psi.schedule_item_id = ra.schedule_item_id
                       LEFT JOIN public.invoice inv ON inv.invoice_id = ra.invoice_id
                      WHERE NOT ra.is_deleted
                        AND (psi.contract_id = $1 OR inv.contract_id = $1)
                      ORDER BY ra.created_at DESC`,
                    [cid]
                  )
                ),
          ]);

          return {
            ...c,
            signed_value_total: toNum(c.signed_value_total),
            lines: linesRes.rows.map((l) => ({ ...l, value: toNum(l.value) })),
            payment_schedule: schedRes.rows.map((s) => ({
              ...s,
              amount_due: toNum(s.amount_due),
              allocated_amount: toNum(s.allocated_amount),
              remaining_amount: toNum(s.remaining_amount),
              due_date: toIsoDateOnly(s.due_date),
            })),
            invoices: invRes.rows.map((inv) => ({
              ...inv,
              amount: toNum(inv.amount),
              tax_amount: toNum(inv.tax_amount),
            })),
            allocations: allocRes.rows.map((al) => ({
              ...al,
              amount: toNum(al.amount),
            })),
            redacted_financials: false,
          };
        })
      );

      res.status(200).json({
        opportunity: {
          ...opportunity,
          stage_history: stageHistoryRes.rows.map((s) => ({
            ...s,
            proposed_value: toNum(s.proposed_value),
            confirmed_value: toNum(s.confirmed_value),
            version_no: toNum(s.version_no) ?? 1,
          })),
          proposals: proposalsRes.rows.map((p) => ({
            ...p,
            proposed_value: toNum(p.proposed_value),
            valid_until: toIsoDateOnly(p.valid_until),
            version_no: toNum(p.version_no) ?? 1,
          })),
          contracts,
        },
      });
    })
  );

  // ---------------------------------------------------------------------------
  // 11. Operational Read Routes (tasks, escalations, meetings, referrals, network-partners, outreach, interactions)
  // ---------------------------------------------------------------------------
  router.get(
    '/tasks',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('tasks'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      if (editionCtx.record_class === 'historical_synthetic') {
        res.status(200).json({
          edition_id: editionCtx.edition_id,
          record_class: editionCtx.record_class,
          tasks: [],
        });
        return;
      }

      const { actorMemberId, profile } = getScopeProfile(req);
      const pool = ensurePool(dbState);
      const taskId = getQueryString(req, 'task_id', 'taskId');
      const status = getQueryString(req, 'status');
      const taskType = getQueryString(req, 'task_type', 'taskType');
      const ownerMemberId = getQueryString(req, 'owner_member_id', 'ownerMemberId');
      const linkedType = getQueryString(req, 'linked_type', 'linkedType');
      const betId = getQueryString(req, 'bet_id', 'betId');
      const origin = getQueryString(req, 'origin');
      const search = getQueryString(req, 'search', 'q');
      const dueFrom = getQueryString(req, 'due_from', 'dueFrom');
      const dueTo = getQueryString(req, 'due_to', 'dueTo');

      const params: unknown[] = [editionCtx.record_class];
      const where = ['t.record_class = $1', 'NOT t.is_deleted'];

      if (profile.tasksScope === 'own') {
        params.push(actorMemberId);
        where.push(`t.owner_member_id = $${params.length}`);
      }
      if (taskId) {
        params.push(taskId);
        where.push(`t.task_id = $${params.length}`);
      }
      if (status && status !== 'all') {
        params.push(status);
        where.push(`t.status = $${params.length}`);
      }
      if (taskType && taskType !== 'all') {
        params.push(taskType);
        where.push(`t.task_type = $${params.length}`);
      }
      if (ownerMemberId && ownerMemberId !== 'all') {
        params.push(ownerMemberId);
        where.push(`t.owner_member_id = $${params.length}`);
      }
      if (linkedType && linkedType !== 'all') {
        params.push(linkedType);
        where.push(`t.linked_type = $${params.length}`);
      }
      if (betId && betId !== 'all') {
        params.push(betId);
        where.push(`t.bet_id = $${params.length}`);
      }
      if (origin && origin !== 'all') {
        params.push(origin);
        where.push(`t.origin = $${params.length}`);
      }
      if (dueFrom && isValidIsoDate(dueFrom)) {
        params.push(dueFrom);
        where.push(`t.due_at >= $${params.length}::date`);
      }
      if (dueTo && isValidIsoDate(dueTo)) {
        params.push(dueTo);
        where.push(`t.due_at < ($${params.length}::date + 1)`);
      }
      if (search) {
        params.push(`%${search}%`);
        where.push(`t.title ILIKE $${params.length}`);
      }

      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT t.task_id, t.title, t.task_type, t.owner_member_id,
                  tm.full_name AS owner_name, t.due_at, t.status, t.completed_at,
                  t.linked_type, t.linked_id, t.bet_id, b.name AS bet_name,
                  t.origin, t.record_class, t.ai_action_id, t.source_ref,
                  t.data_version, t.created_at, t.created_by
             FROM public.task t
             LEFT JOIN public.team_member tm ON tm.member_id = t.owner_member_id
             LEFT JOIN public.bet b ON b.bet_id = t.bet_id
            WHERE ${where.join(' AND ')}
            ORDER BY t.due_at ASC, t.task_id`,
          params
        )
      );

      if (taskId && qRes.rows.length === 0) {
        throw new AppApiError(404, 'NOT_FOUND', `Task "${taskId}" was not found.`);
      }

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        ...(taskId ? { task: qRes.rows[0] } : {}),
        tasks: qRes.rows,
      });
    })
  );

  router.get(
    '/escalations',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('escalations'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      if (editionCtx.record_class === 'historical_synthetic') {
        res.status(200).json({
          edition_id: editionCtx.edition_id,
          record_class: editionCtx.record_class,
          escalations: [],
        });
        return;
      }

      const { actorMemberId, profile } = getScopeProfile(req);
      const pool = ensurePool(dbState);
      const params: unknown[] = [editionCtx.record_class];
      const where = ['e.record_class = $1', 'NOT e.is_deleted'];

      if (profile.escalationsScope === 'own') {
        params.push(actorMemberId);
        where.push(`e.owner_member_id = $${params.length}`);
      }

      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT e.escalation_id, e.rule_id, tr.evaluate_at, tr.escalate_if,
                  tr.response, tr.kpi_id, kd.bet_id,
                  e.kpi_actual_id, e.raised_at, e.owner_member_id,
                  tm.full_name AS owner_name, e.status, e.action_taken,
                  e.closed_at, e.record_class, e.created_at
             FROM public.escalation e
             LEFT JOIN public.threshold_rule tr ON tr.rule_id = e.rule_id
             LEFT JOIN public.kpi_definition kd ON kd.kpi_id = tr.kpi_id
             LEFT JOIN public.team_member tm ON tm.member_id = e.owner_member_id
            WHERE ${where.join(' AND ')}
            ORDER BY e.raised_at DESC`,
          params
        )
      );

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        escalations: qRes.rows,
      });
    })
  );

  router.get(
    '/meetings',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('outreach_interactions_meetings_qualifications'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      const { actorMemberId, profile } = getScopeProfile(req);
      const pool = ensurePool(dbState);

      const opportunityId = getQueryString(req, 'opportunity_id', 'opportunityId');
      const sponsorId = getQueryString(req, 'sponsor_id', 'sponsorId');
      const params: unknown[] = [editionCtx.record_class];
      const where = ['m.record_class = $1', 'NOT m.is_deleted'];

      if (opportunityId) {
        params.push(opportunityId);
        where.push(`m.opportunity_id = $${params.length}`);
      }
      if (sponsorId) {
        params.push(sponsorId);
        where.push(`m.sponsor_id = $${params.length}`);
      }
      if (profile.sponsorsScope === 'own') {
        params.push(actorMemberId);
        const actorIdx = params.length;
        where.push(`(
          $${actorIdx} = ANY(COALESCE(m.attendee_member_ids, ARRAY[]::text[]))
          OR EXISTS (
            SELECT 1 FROM public.ownership_assignment oa
             WHERE oa.subject_type = 'sponsor'
               AND oa.subject_id = m.sponsor_id
               AND oa.record_class = m.record_class
               AND oa.member_id = $${actorIdx}
               AND oa.valid_to IS NULL
               AND NOT oa.is_deleted
          )
        )`);
      }

      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT m.meeting_id, m.attempt_id, m.opportunity_id, m.sponsor_id,
                  s.display_name AS sponsor_name, m.scheduled_at, m.status,
                  m.purpose, m.attendee_member_ids, m.outcome_note, m.record_class
             FROM public.meeting m
             JOIN public.sponsor s ON s.sponsor_id = m.sponsor_id
            WHERE ${where.join(' AND ')}
            ORDER BY m.scheduled_at DESC`,
          params
        )
      );

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        meetings: qRes.rows,
      });
    })
  );

  router.get(
    '/referrals',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('outreach_interactions_meetings_qualifications'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      if (editionCtx.record_class === 'historical_synthetic') {
        res.status(200).json({
          edition_id: editionCtx.edition_id,
          record_class: editionCtx.record_class,
          referrals: [],
        });
        return;
      }

      const { actorMemberId, profile } = getScopeProfile(req);
      const pool = ensurePool(dbState);
      const params: unknown[] = [editionCtx.record_class, editionCtx.edition_id];
      const where = [
        'rf.record_class = $1',
        'rf.valid_to IS NULL',
        'NOT rf.is_deleted',
        '(rf.campaign_id IS NULL OR camp.edition_id = $2)',
      ];

      if (profile.sponsorsScope === 'own') {
        params.push(actorMemberId);
        where.push(
          `(np.owner_member_id = $${params.length} OR rf.created_by = $${params.length})`
        );
      }

      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT rf.referral_id, rf.partner_id, np.name AS partner_name,
                  np.partner_type, rf.sponsor_id, s.display_name AS sponsor_name,
                  rf.contact_id, ct.full_name AS contact_name, rf.campaign_id,
                  camp.name AS campaign_name, rf.commitment_status,
                  rf.committed_at, rf.ask_sent_at, rf.record_class
             FROM public.referral rf
             JOIN public.network_partner np ON np.partner_id = rf.partner_id
             JOIN public.sponsor s ON s.sponsor_id = rf.sponsor_id
             LEFT JOIN public.contact ct ON ct.contact_id = rf.contact_id
             LEFT JOIN public.campaign camp ON camp.campaign_id = rf.campaign_id
            WHERE ${where.join(' AND ')}
            ORDER BY rf.committed_at DESC NULLS LAST, rf.referral_id`,
          params
        )
      );

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        referrals: qRes.rows,
      });
    })
  );

  router.get(
    '/network-partners',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('outreach_interactions_meetings_qualifications'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      if (editionCtx.record_class === 'historical_synthetic') {
        res.status(200).json({
          edition_id: editionCtx.edition_id,
          record_class: editionCtx.record_class,
          network_partners: [],
        });
        return;
      }

      const { actorMemberId, profile } = getScopeProfile(req);
      const pool = ensurePool(dbState);
      const params: unknown[] = [editionCtx.record_class];
      const where = ['np.record_class = $1', 'NOT np.is_deleted'];

      if (profile.sponsorsScope === 'own') {
        params.push(actorMemberId);
        where.push(`np.owner_member_id = $${params.length}`);
      }

      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT np.partner_id, np.partner_type, np.name, np.owner_member_id,
                  tm.full_name AS owner_name, np.recruited_at, np.status, np.record_class
             FROM public.network_partner np
             LEFT JOIN public.team_member tm ON tm.member_id = np.owner_member_id
            WHERE ${where.join(' AND ')}
            ORDER BY np.partner_type, np.name`,
          params
        )
      );

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        network_partners: qRes.rows.map((r) => ({
          ...r,
          recruited_at: toIsoDateOnly(r.recruited_at),
        })),
      });
    })
  );

  router.get(
    '/outreach',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('outreach_interactions_meetings_qualifications'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      const { actorMemberId, profile } = getScopeProfile(req);
      const pool = ensurePool(dbState);

      const sponsorId = getQueryString(req, 'sponsor_id', 'sponsorId');
      const campaignId = getQueryString(req, 'campaign_id', 'campaignId');
      const params: unknown[] = [editionCtx.record_class, editionCtx.edition_id];
      const where = [
        'oa.record_class = $1',
        'camp.edition_id = $2',
        'NOT oa.is_deleted',
      ];

      if (sponsorId) {
        params.push(sponsorId);
        where.push(`oa.sponsor_id = $${params.length}`);
      }
      if (campaignId) {
        params.push(campaignId);
        where.push(`oa.campaign_id = $${params.length}`);
      }
      if (profile.sponsorsScope === 'own') {
        params.push(actorMemberId);
        where.push(`(
          oa.owner_member_id = $${params.length}
          OR EXISTS (
            SELECT 1 FROM public.ownership_assignment ow
             WHERE ow.subject_type = 'sponsor'
               AND ow.subject_id = oa.sponsor_id
               AND ow.record_class = oa.record_class
               AND ow.member_id = $${params.length}
               AND ow.valid_to IS NULL
               AND NOT ow.is_deleted
          )
        )`);
      }

      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT oa.attempt_id, oa.campaign_id, camp.name AS campaign_name,
                  oa.sponsor_id, s.display_name AS sponsor_name, oa.contact_id,
                  oa.referral_id, oa.owner_member_id, tm.full_name AS owner_name,
                  oa.started_at, oa.root_event_type, oa.record_class
             FROM public.outreach_attempt oa
             JOIN public.campaign camp ON camp.campaign_id = oa.campaign_id
             JOIN public.sponsor s ON s.sponsor_id = oa.sponsor_id
             LEFT JOIN public.team_member tm ON tm.member_id = oa.owner_member_id
            WHERE ${where.join(' AND ')}
            ORDER BY oa.started_at DESC
            LIMIT 200`,
          params
        )
      );

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        outreach: qRes.rows,
      });
    })
  );

  router.get(
    '/interactions',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('outreach_interactions_meetings_qualifications'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      const { actorMemberId, profile } = getScopeProfile(req);
      const pool = ensurePool(dbState);

      const sponsorId = getQueryString(req, 'sponsor_id', 'sponsorId');
      const attemptId = getQueryString(req, 'attempt_id', 'attemptId');
      const params: unknown[] = [editionCtx.record_class, editionCtx.edition_id];
      const where = [
        'i.record_class = $1',
        'camp.edition_id = $2',
        'NOT i.is_deleted',
      ];

      if (sponsorId) {
        params.push(sponsorId);
        where.push(`oa.sponsor_id = $${params.length}`);
      }
      if (attemptId) {
        params.push(attemptId);
        where.push(`i.attempt_id = $${params.length}`);
      }
      if (profile.sponsorsScope === 'own') {
        params.push(actorMemberId);
        where.push(`(
          oa.owner_member_id = $${params.length}
          OR i.logged_by = $${params.length}
          OR EXISTS (
            SELECT 1 FROM public.ownership_assignment ow
             WHERE ow.subject_type = 'sponsor'
               AND ow.subject_id = oa.sponsor_id
               AND ow.record_class = oa.record_class
               AND ow.member_id = $${params.length}
               AND ow.valid_to IS NULL
               AND NOT ow.is_deleted
          )
        )`);
      }

      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT i.interaction_id, i.attempt_id, oa.sponsor_id,
                  s.display_name AS sponsor_name, oa.campaign_id,
                  i.event_type, i.outcome, i.occurred_at, i.summary,
                  i.logged_by, tm.full_name AS logged_by_name, i.record_class
             FROM public.interaction i
             JOIN public.outreach_attempt oa ON oa.attempt_id = i.attempt_id
             JOIN public.campaign camp ON camp.campaign_id = oa.campaign_id
             JOIN public.sponsor s ON s.sponsor_id = oa.sponsor_id
             LEFT JOIN public.team_member tm ON tm.member_id = i.logged_by
            WHERE ${where.join(' AND ')}
            ORDER BY i.occurred_at DESC
            LIMIT 250`,
          params
        )
      );

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        interactions: qRes.rows,
      });
    })
  );

  // ---------------------------------------------------------------------------
  // 12. GET /api/contracts & GET /api/collections/*
  // ---------------------------------------------------------------------------
  router.get(
    '/contracts',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('contracts_lines'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      if (editionCtx.record_class === 'historical_synthetic') {
        res.status(200).json({
          edition_id: editionCtx.edition_id,
          record_class: editionCtx.record_class,
          contracts: [],
        });
        return;
      }

      const { actorMemberId, profile } = getScopeProfile(req);
      const pool = ensurePool(dbState);
      const sponsorId = getQueryString(req, 'sponsor_id', 'sponsorId');
      const opportunityId = getQueryString(req, 'opportunity_id', 'opportunityId');
      const params: unknown[] = [editionCtx.edition_id, editionCtx.record_class];
      const where = [
        'o.edition_id = $1',
        'c.record_class = $2',
        'c.valid_to IS NULL',
        'NOT c.is_deleted',
      ];

      if (sponsorId) {
        params.push(sponsorId);
        where.push(`o.sponsor_id = $${params.length}`);
      }
      if (opportunityId) {
        params.push(opportunityId);
        where.push(`c.opportunity_id = $${params.length}`);
      }
      if (profile.contractsScope === 'own') {
        params.push(actorMemberId);
        where.push(`(
          sv.owner_member_id = $${params.length}
          OR EXISTS (
            SELECT 1 FROM public.ownership_assignment oa
             WHERE oa.subject_type = 'sponsor'
               AND oa.subject_id = o.sponsor_id
               AND oa.record_class = c.record_class
               AND oa.member_id = $${params.length}
               AND oa.valid_to IS NULL
               AND NOT oa.is_deleted
          )
        )`);
      }

      const contractsRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT c.contract_id, c.opportunity_id, o.name AS opportunity_name,
                  o.edition_id, o.sponsor_id, s.display_name AS sponsor_name,
                  sv.owner_member_id, tm.full_name AS owner_name,
                  c.signed_at, c.signed_value_total, c.payment_terms,
                  c.signatory_contact_id, ct.full_name AS signatory_name,
                  c.document_uri, c.status, c.record_class,
                  bv.cash_signed, bv.cash_received, bv.outstanding, bv.overdue_amount
             FROM public.contract c
             JOIN public.opportunity o ON o.opportunity_id = c.opportunity_id
             JOIN public.sponsor s ON s.sponsor_id = o.sponsor_id
             LEFT JOIN public.contact ct ON ct.contact_id = c.signatory_contact_id
             LEFT JOIN LATERAL (
               SELECT owner_member_id FROM public.opportunity_stage_version osv
                WHERE osv.opportunity_id = o.opportunity_id AND NOT osv.is_deleted
                ORDER BY osv.valid_from DESC, osv.history_id DESC
                LIMIT 1
             ) sv ON true
             LEFT JOIN public.team_member tm ON tm.member_id = sv.owner_member_id
             LEFT JOIN public.balance_view bv ON bv.contract_id = c.contract_id
            WHERE ${where.join(' AND ')}
            ORDER BY c.signed_at DESC`,
          params
        )
      );

      const contractIds = contractsRes.rows.map((r) => String(r.contract_id));
      if (contractIds.length === 0) {
        res.status(200).json({
          edition_id: editionCtx.edition_id,
          record_class: editionCtx.record_class,
          contracts: [],
        });
        return;
      }

      const linesRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT cl.contract_line_id, cl.contract_id, cl.asset_id,
                  ia.asset_type, cl.consideration_type, cl.value, cl.price_id,
                  cl.record_class
             FROM public.contract_line cl
             LEFT JOIN public.inventory_asset ia ON ia.asset_id = cl.asset_id
            WHERE cl.contract_id = ANY($1::text[]) AND NOT cl.is_deleted
            ORDER BY cl.contract_line_id`,
          [contractIds]
        )
      );

      const schedRows = profile.redactFinancials
        ? []
        : (
            await wrapDb(
              pool.query<Record<string, unknown>>(
                `SELECT * FROM public.payment_schedule_item_status_view
                  WHERE contract_id = ANY($1::text[])
                  ORDER BY due_date ASC`,
                [contractIds]
              )
            )
          ).rows;

      const invRows = profile.redactFinancials
        ? []
        : (
            await wrapDb(
              pool.query<Record<string, unknown>>(
                `SELECT * FROM public.invoice
                  WHERE contract_id = ANY($1::text[]) AND NOT is_deleted
                  ORDER BY issued_at DESC`,
                [contractIds]
              )
            )
          ).rows;

      const allowReceipts = !profile.redactFinancials && profile.receiptsScope !== 'none';
      const allocRows = allowReceipts
        ? (
            await wrapDb(
              pool.query<Record<string, unknown>>(
                `SELECT ra.allocation_id, ra.receipt_id, ra.invoice_id,
                        ra.schedule_item_id, ra.amount, ra.record_class,
                        COALESCE(psi.contract_id, inv.contract_id) AS contract_id
                   FROM public.receipt_allocation ra
                   LEFT JOIN public.payment_schedule_item psi ON psi.schedule_item_id = ra.schedule_item_id
                   LEFT JOIN public.invoice inv ON inv.invoice_id = ra.invoice_id
                  WHERE NOT ra.is_deleted
                    AND COALESCE(psi.contract_id, inv.contract_id) = ANY($1::text[])`,
                [contractIds]
              )
            )
          ).rows
        : [];

      const receiptIds = Array.from(new Set(allocRows.map((a) => String(a.receipt_id))));
      const receiptRows =
        allowReceipts && receiptIds.length > 0
          ? (
              await wrapDb(
                pool.query<Record<string, unknown>>(
                  `SELECT r.*, tm.full_name AS recorded_by_name
                     FROM public.receipt r
                     LEFT JOIN public.team_member tm ON tm.member_id = r.recorded_by
                    WHERE r.receipt_id = ANY($1::text[]) AND NOT r.is_deleted`,
                  [receiptIds]
                )
              )
            ).rows
          : [];

      const receiptById = new Map<string, Record<string, unknown>>();
      for (const r of receiptRows) {
        receiptById.set(String(r.receipt_id), r);
      }

      const contracts = contractsRes.rows.map((c) => {
        const cid = String(c.contract_id);
        const cAllocs = allocRows.filter((a) => a.contract_id === cid);
        const cReceiptIds = Array.from(new Set(cAllocs.map((a) => String(a.receipt_id))));
        const cReceipts = cReceiptIds
          .map((rid) => receiptById.get(rid))
          .filter((r): r is Record<string, unknown> => Boolean(r))
          .map((r) => ({
            receipt_id: r.receipt_id,
            sponsor_id: r.sponsor_id,
            received_at: r.received_at,
            amount: toNum(r.amount),
            method: r.method,
            bank_reference: profile.redactBankReference ? null : r.bank_reference ?? null,
            bank_reference_redacted: profile.redactBankReference,
            totals_only_redacted: profile.redactBankReference,
            reconciled: Boolean(r.reconciled),
            reconciled_at: r.reconciled_at,
            recorded_by: r.recorded_by,
            recorded_by_name: r.recorded_by_name,
            record_class: r.record_class,
          }));

        return {
          contract_id: cid,
          opportunity_id: c.opportunity_id,
          opportunity_name: c.opportunity_name,
          edition_id: c.edition_id,
          sponsor_id: c.sponsor_id,
          sponsor_name: c.sponsor_name,
          owner_member_id: c.owner_member_id,
          owner_name: c.owner_name,
          signed_at: c.signed_at,
          signed_value_total: toNum(c.signed_value_total),
          payment_terms: c.payment_terms,
          signatory_contact_id: c.signatory_contact_id,
          signatory_name: c.signatory_name,
          document_uri: c.document_uri,
          status: c.status,
          record_class: c.record_class,
          lines: linesRes.rows
            .filter((l) => l.contract_id === cid)
            .map((l) => ({ ...l, value: toNum(l.value) })),
          balance_view: profile.redactFinancials
            ? null
            : {
                contract_id: cid,
                cash_signed: toNum(c.cash_signed) ?? 0,
                cash_received: toNum(c.cash_received) ?? 0,
                outstanding: toNum(c.outstanding) ?? 0,
                overdue_amount: toNum(c.overdue_amount) ?? 0,
              },
          payment_schedule: schedRows
            .filter((s) => s.contract_id === cid)
            .map((s) => ({
              ...s,
              amount_due: toNum(s.amount_due),
              allocated_amount: toNum(s.allocated_amount),
              remaining_amount: toNum(s.remaining_amount),
              due_date: toIsoDateOnly(s.due_date),
            })),
          invoices: invRows
            .filter((i) => i.contract_id === cid)
            .map((i) => ({
              ...i,
              amount: toNum(i.amount),
              tax_amount: toNum(i.tax_amount),
            })),
          receipts: cReceipts,
          allocations: cAllocs.map((a) => ({
            ...a,
            amount: toNum(a.amount),
          })),
          redacted_financials: profile.redactFinancials,
        };
      });

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        contracts,
      });
    })
  );

  router.get(
    '/collections/schedule',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('payment_schedule_invoices'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      if (editionCtx.record_class === 'historical_synthetic') {
        res.status(200).json({
          edition_id: editionCtx.edition_id,
          record_class: editionCtx.record_class,
          schedule: [],
        });
        return;
      }

      const pool = ensurePool(dbState);
      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT ps.schedule_item_id, ps.contract_id, ps.kind, ps.amount_due,
                  ps.due_date, ps.record_class, ps.allocated_amount,
                  ps.remaining_amount, ps.derived_status,
                  o.opportunity_id, o.name AS opportunity_name,
                  o.sponsor_id, s.display_name AS sponsor_name
             FROM public.payment_schedule_item_status_view ps
             JOIN public.contract c ON c.contract_id = ps.contract_id
             JOIN public.opportunity o ON o.opportunity_id = c.opportunity_id
             JOIN public.sponsor s ON s.sponsor_id = o.sponsor_id
            WHERE o.edition_id = $1
              AND ps.record_class = $2
            ORDER BY ps.due_date ASC, ps.schedule_item_id`,
          [editionCtx.edition_id, editionCtx.record_class]
        )
      );

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        schedule: qRes.rows.map((r) => ({
          ...r,
          amount_due: toNum(r.amount_due),
          allocated_amount: toNum(r.allocated_amount),
          remaining_amount: toNum(r.remaining_amount),
          due_date: toIsoDateOnly(r.due_date),
        })),
      });
    })
  );

  router.get(
    '/collections/balances',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('payment_schedule_invoices'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      if (editionCtx.record_class === 'historical_synthetic') {
        res.status(200).json({
          edition_id: editionCtx.edition_id,
          record_class: editionCtx.record_class,
          balances: [],
        });
        return;
      }

      const pool = ensurePool(dbState);
      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT bv.contract_id, bv.opportunity_id, bv.record_class,
                  bv.cash_signed, bv.cash_received, bv.outstanding, bv.overdue_amount,
                  o.sponsor_id, s.display_name AS sponsor_name,
                  o.name AS opportunity_name, c.signed_at, c.payment_terms
             FROM public.balance_view bv
             JOIN public.contract c ON c.contract_id = bv.contract_id
             JOIN public.opportunity o ON o.opportunity_id = bv.opportunity_id
             JOIN public.sponsor s ON s.sponsor_id = o.sponsor_id
            WHERE o.edition_id = $1
              AND bv.record_class = $2
            ORDER BY bv.outstanding DESC, c.signed_at DESC`,
          [editionCtx.edition_id, editionCtx.record_class]
        )
      );

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        balances: qRes.rows.map((r) => ({
          ...r,
          cash_signed: toNum(r.cash_signed),
          cash_received: toNum(r.cash_received),
          outstanding: toNum(r.outstanding),
          overdue_amount: toNum(r.overdue_amount),
        })),
      });
    })
  );

  router.get(
    '/collections/receipts',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('receipts_allocations'),
    asyncHandler(async (req: Request, res: Response) => {
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      if (editionCtx.record_class === 'historical_synthetic') {
        res.status(200).json({
          edition_id: editionCtx.edition_id,
          record_class: editionCtx.record_class,
          receipts: [],
        });
        return;
      }

      const { actorMemberId, profile } = getScopeProfile(req);
      const pool = ensurePool(dbState);
      const params: unknown[] = [editionCtx.record_class];
      const where = ['r.record_class = $1', 'NOT r.is_deleted'];

      if (profile.receiptsScope === 'own') {
        params.push(actorMemberId);
        where.push(`EXISTS (
          SELECT 1 FROM public.ownership_assignment oa
           WHERE oa.subject_type = 'sponsor'
             AND oa.subject_id = r.sponsor_id
             AND oa.record_class = r.record_class
             AND oa.member_id = $${params.length}
             AND oa.valid_to IS NULL
             AND NOT oa.is_deleted
        )`);
      }

      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT r.receipt_id, r.sponsor_id, s.display_name AS sponsor_name,
                  r.received_at, r.amount, r.method, r.bank_reference,
                  r.reconciled, r.reconciled_at, r.recorded_by,
                  tm.full_name AS recorded_by_name, r.record_class
             FROM public.receipt r
             JOIN public.sponsor s ON s.sponsor_id = r.sponsor_id
             LEFT JOIN public.team_member tm ON tm.member_id = r.recorded_by
            WHERE ${where.join(' AND ')}
            ORDER BY r.received_at DESC`,
          params
        )
      );

      const receiptIds = qRes.rows.map((r) => String(r.receipt_id));
      const allocRes =
        receiptIds.length > 0
          ? await wrapDb(
              pool.query<Record<string, unknown>>(
                `SELECT ra.allocation_id, ra.receipt_id, ra.invoice_id,
                        ra.schedule_item_id, ra.amount, ra.created_at,
                        COALESCE(psi.contract_id, inv.contract_id) AS contract_id
                   FROM public.receipt_allocation ra
                   LEFT JOIN public.payment_schedule_item psi
                     ON psi.schedule_item_id = ra.schedule_item_id
                   LEFT JOIN public.invoice inv
                     ON inv.invoice_id = ra.invoice_id
                  WHERE ra.receipt_id = ANY($1::text[])
                    AND NOT ra.is_deleted
                  ORDER BY ra.created_at ASC, ra.allocation_id ASC`,
                [receiptIds]
              )
            )
          : { rows: [] as Array<Record<string, unknown>> };

      res.status(200).json({
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        receipts: buildEnrichedReceipts(
          qRes.rows,
          allocRes.rows,
          profile.redactBankReference
        ),
      });
    })
  );

  // ---------------------------------------------------------------------------
  // 13. GET /api/audit (coordination_lead or admin ONLY)
  // ---------------------------------------------------------------------------
  router.get(
    '/audit',
    authMiddleware,
    resolveReadRoles,
    asyncHandler(async (req: Request, res: Response) => {
      const { profile } = getScopeProfile(req);
      if (!profile.canViewAudit) {
        throw new AppApiError(
          403,
          'FORBIDDEN',
          'Audit logs require coordination_lead or admin role.'
        );
      }

      const pool = ensurePool(dbState);
      const entity = getQueryString(req, 'entity');
      const entityId = getQueryString(req, 'id', 'entity_id', 'entityId');

      const params: unknown[] = [];
      const where: string[] = ['NOT ae.is_deleted'];

      if (entity) {
        params.push(entity.toUpperCase());
        where.push(`UPPER(ae.entity) = $${params.length}`);
      }
      if (entityId) {
        params.push(entityId);
        where.push(`ae.entity_id = $${params.length}`);
      }

      const qRes = await wrapDb(
        pool.query<Record<string, unknown>>(
          `SELECT ae.audit_id, ae.actor_id, tm.full_name AS actor_name,
                  ae.ai_action_id, ae.channel, ae.entity, ae.entity_id,
                  ae.operation, ae.before_hash, ae.after, ae.data_version,
                  ae.at, ae.record_class, ae.source_ref
             FROM public.audit_event ae
             LEFT JOIN public.team_member tm ON tm.member_id = ae.actor_id
            WHERE ${where.join(' AND ')}
            ORDER BY ae.at DESC
            LIMIT 200`,
          params
        )
      );

      res.status(200).json({
        events: qRes.rows.map((r) => ({
          ...r,
          data_version: toNum(r.data_version),
        })),
      });
    })
  );

  // ---------------------------------------------------------------------------
  // 14. GET /api/search
  // ---------------------------------------------------------------------------
  router.get(
    '/search',
    authMiddleware,
    resolveReadRoles,
    requireReadDomain('targets_rules_scenarios_metrics'),
    asyncHandler(async (req: Request, res: Response) => {
      const q = getQueryString(req, 'q', 'search') ?? '';
      const { editionId, requestedRecordClass } = parseEditionAndClass(
        req,
        config.editionIdDefault
      );
      const editionCtx = await resolveEditionContext(
        dbState,
        editionId,
        requestedRecordClass
      );
      if (q.length < 1) {
        res.status(200).json({
          query: q,
          edition_id: editionCtx.edition_id,
          record_class: editionCtx.record_class,
          results: [],
        });
        return;
      }

      const { actorMemberId, profile } = getScopeProfile(req);
      const pool = ensurePool(dbState);
      const likeTerm = `%${q}%`;

      const sponsorOwnerFilter =
        profile.sponsorsScope === 'own'
          ? `AND (EXISTS (
               SELECT 1 FROM public.ownership_assignment oa
                WHERE oa.subject_type = 'sponsor' AND oa.subject_id = s.sponsor_id
                  AND oa.record_class = s.record_class AND oa.member_id = $3
                  AND oa.valid_to IS NULL AND NOT oa.is_deleted
             ) OR s.created_by = $3)`
          : '';

      const sponsorParams: unknown[] = [editionCtx.record_class, likeTerm];
      if (profile.sponsorsScope === 'own') sponsorParams.push(actorMemberId);

      const oppOwnerFilter =
        profile.opportunitiesScope === 'own'
          ? `AND (sv.owner_member_id = $4 OR o.created_by = $4)`
          : '';
      const oppParams: unknown[] = [
        editionCtx.edition_id,
        editionCtx.record_class,
        likeTerm,
      ];
      if (profile.opportunitiesScope === 'own') oppParams.push(actorMemberId);

      const taskOwnerFilter =
        profile.tasksScope === 'own' ? `AND t.owner_member_id = $3` : '';
      const taskParams: unknown[] = [editionCtx.record_class, likeTerm];
      if (profile.tasksScope === 'own') taskParams.push(actorMemberId);

      const [sponsorsRes, campaignsRes, oppsRes, tasksRes] = await Promise.all([
        wrapDb(
          pool.query<{ id: string; title: string; subtitle: string | null }>(
            `SELECT s.sponsor_id AS id, s.display_name AS title,
                    COALESCE(c.name, s.lifecycle_status) AS subtitle
               FROM public.sponsor s
               LEFT JOIN public.category c ON c.category_id = s.category_id
              WHERE s.record_class = $1 AND NOT s.is_deleted
                AND (s.display_name ILIKE $2 OR COALESCE(c.name, '') ILIKE $2)
                ${sponsorOwnerFilter}
              ORDER BY s.display_name ASC
              LIMIT 8`,
            sponsorParams
          )
        ),
        wrapDb(
          pool.query<{ id: string; title: string; subtitle: string | null }>(
            `SELECT camp.campaign_id AS id, camp.name AS title,
                    COALESCE(ch.name, camp.status) AS subtitle
               FROM public.campaign camp
               LEFT JOIN public.channel ch ON ch.channel_id = camp.channel_id
              WHERE camp.edition_id = $1 AND camp.record_class = $2 AND NOT camp.is_deleted
                AND (camp.name ILIKE $3 OR COALESCE(camp.objective, '') ILIKE $3)
              ORDER BY camp.name ASC
              LIMIT 6`,
            [editionCtx.edition_id, editionCtx.record_class, likeTerm]
          )
        ),
        wrapDb(
          pool.query<{ id: string; title: string; subtitle: string | null }>(
            `SELECT o.opportunity_id AS id,
                    COALESCE(o.name, s.display_name) AS title,
                    COALESCE(sv.stage, o.support_type) AS subtitle
               FROM public.opportunity o
               JOIN public.sponsor s ON s.sponsor_id = o.sponsor_id
               LEFT JOIN LATERAL (
                 SELECT stage, owner_member_id FROM public.opportunity_stage_version osv
                  WHERE osv.opportunity_id = o.opportunity_id AND NOT osv.is_deleted
                  ORDER BY osv.valid_from DESC, osv.history_id DESC
                  LIMIT 1
               ) sv ON true
              WHERE o.edition_id = $1 AND o.record_class = $2 AND NOT o.is_deleted
                AND (COALESCE(o.name, '') ILIKE $3 OR s.display_name ILIKE $3)
                ${oppOwnerFilter}
              ORDER BY o.opportunity_id ASC
              LIMIT 8`,
            oppParams
          )
        ),
        editionCtx.record_class === 'historical_synthetic'
          ? Promise.resolve({
              rows: [] as Array<{ id: string; title: string; subtitle: string | null }>,
            })
          : wrapDb(
              pool.query<{ id: string; title: string; subtitle: string | null }>(
                `SELECT t.task_id AS id, t.title, t.status AS subtitle
                   FROM public.task t
                  WHERE t.record_class = $1 AND NOT t.is_deleted
                    AND t.title ILIKE $2
                    ${taskOwnerFilter}
                  ORDER BY t.due_at ASC
                  LIMIT 6`,
                taskParams
              )
            ),
      ]);

      const results = [
        ...sponsorsRes.rows.map((r) => ({
          type: 'sponsor' as const,
          section: 'sponsors' as const,
          id: r.id,
          title: r.title,
          subtitle: r.subtitle,
          edition_id: editionCtx.edition_id,
          record_class: editionCtx.record_class,
        })),
        ...campaignsRes.rows.map((r) => ({
          type: 'campaign' as const,
          section: 'campaigns' as const,
          id: r.id,
          title: r.title,
          subtitle: r.subtitle,
          edition_id: editionCtx.edition_id,
          record_class: editionCtx.record_class,
        })),
        ...oppsRes.rows.map((r) => ({
          type: 'opportunity' as const,
          section: 'pipeline' as const,
          id: r.id,
          title: r.title,
          subtitle: r.subtitle,
          edition_id: editionCtx.edition_id,
          record_class: editionCtx.record_class,
        })),
        ...tasksRes.rows.map((r) => ({
          type: 'task' as const,
          section: 'tasks' as const,
          id: r.id,
          title: r.title,
          subtitle: r.subtitle,
          edition_id: editionCtx.edition_id,
          record_class: editionCtx.record_class,
        })),
      ];

      res.status(200).json({
        query: q,
        edition_id: editionCtx.edition_id,
        record_class: editionCtx.record_class,
        results,
      });
    })
  );

  // Explicit 405 for unknown non-GET on newly introduced read-only resource names
  router.all(
    ['/editions', '/gates', '/rules'],
    authMiddleware,
    (_req: Request, res: Response) => {
      sendJsonError(
        res,
        405,
        'METHOD_NOT_ALLOWED',
        'This endpoint is read-only (GET only).'
      );
    }
  );

  return router;
}
