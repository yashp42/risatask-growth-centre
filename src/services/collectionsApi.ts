import { apiFetch } from './authSession';
import { getTodayIstIso } from '../lib/dateIst';
import type { MetricQueryResult } from '../types/campaigns';
import type { FilterOption } from '../types/overview';
import type {
  CanonicalRole,
  SponsorContractLineRecord,
  SponsorEntity,
  UserPermissionContext,
} from '../types/sponsors';
import {
  ALL_PAYMENT_SCHEDULE_KINDS,
  ALL_RECEIPT_METHODS,
  type BalanceViewRecord,
  type CollectionsContractRow,
  type CollectionsFilters,
  type CollectionsMetricId,
  type CollectionsMetricMeta,
  type CollectionsPermissionProfile,
  type CollectionsRecordClass,
  type CollectionsSummaryState,
  type CreateInvoicePayload,
  type CreatePaymentSchedulePayload,
  type CreateReceiptPayload,
  type GateReferenceRecord,
  type InvoiceRecord,
  type InvoiceStatus,
  type PaymentScheduleItemRecord,
  type PaymentScheduleKind,
  type PaymentScheduleStatus,
  type ReceiptAllocationRecord,
  type ReceiptMethod,
  type ReceiptRecord,
  type UpdateContractPaymentTermsPayload,
} from '../types/collections';
import { CampaignApiError, queryMetrics } from './campaignsApi';
import { OVERVIEW_API_ENDPOINTS } from './overviewApi';

export class CollectionsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = 'API_ERROR') {
    super(message);
    this.name = 'CollectionsApiError';
    this.status = status;
    this.code = code;
  }
}

export const COLLECTIONS_RECORD_CLASS_OPTIONS: FilterOption[] = [
  { value: 'simulated', label: 'Simulated (2026 demo)' },
  { value: 'live', label: 'Live' },
  {
    value: 'historical_synthetic',
    label: 'Historical synthetic (2025, no financial records)',
  },
];

export const COLLECTIONS_EDITION_BY_CLASS: Record<
  CollectionsRecordClass,
  FilterOption[]
> = {
  simulated: [{ value: 'ED-2026-DEMO', label: 'ED-2026-DEMO' }],
  live: [{ value: 'ED-2026-LIVE', label: 'ED-2026-LIVE' }],
  historical_synthetic: [
    { value: 'ED-2025', label: 'ED-2025 (CampusFest 2025)' },
  ],
};

export function getDefaultCollectionsEditionForClass(
  recordClass: CollectionsRecordClass
): string {
  return COLLECTIONS_EDITION_BY_CLASS[recordClass][0].value;
}

/**
 * Exact metric definitions from 05_metric_dictionary.csv.
 * All metric values must originate from POST /api/metrics/query.
 */
export const COLLECTIONS_METRIC_DICTIONARY: Record<
  CollectionsMetricId,
  CollectionsMetricMeta
> = {
  'M-01': {
    metric_id: 'M-01',
    name: 'Cash collected before fest',
    kpi_id: 'K-G-02',
    formula: 'SUM(RECEIPT.amount) reconciled and allocated before fest',
    unit: '₹',
    inclusion_exclusion:
      'Cleared receipts only; excludes pledges, unpaid invoices, and in-kind value.',
    computable_2025: false,
  },
  'M-03': {
    metric_id: 'M-03',
    name: 'Signed cash-type value',
    kpi_id: 'K-G-01',
    formula: 'SUM(confirmed_value_inr) where support_type = cash',
    unit: '₹',
    inclusion_exclusion: 'Excludes in-kind deals.',
    computable_2025: true,
  },
  'M-06': {
    metric_id: 'M-06',
    name: 'Cash collection ratio',
    kpi_id: 'K-B2-01',
    formula: 'Cash collected ÷ signed cash-type value',
    unit: 'ratio',
    inclusion_exclusion:
      'Cash deals only; T−7 gate ≥ 0.85 per D010 / reference gates.',
    computable_2025: false,
  },
  'M-07': {
    metric_id: 'M-07',
    name: 'Outstanding cash from signed sponsors',
    kpi_id: 'K-B2-01',
    formula: 'Signed cash-type value − cash collected',
    unit: '₹',
    inclusion_exclusion: 'Excludes in-kind commitments.',
    computable_2025: false,
  },
  'M-02': {
    metric_id: 'M-02',
    name: 'Signed (confirmed) value',
    kpi_id: 'K-G-01',
    formula:
      'SUM(confirmed_value_inr) of latest version with stage = partner_confirmed',
    unit: '₹',
    inclusion_exclusion:
      'Includes in-kind; excludes withdrawn and lost; never call it cash collected.',
    computable_2025: true,
  },
  'M-04': {
    metric_id: 'M-04',
    name: 'In-kind value',
    kpi_id: null,
    formula: 'SUM(confirmed_value_inr) where support_type = in_kind',
    unit: '₹',
    inclusion_exclusion: 'Reported separately; never counted as cash.',
    computable_2025: true,
  },
};

export const PRIMARY_COLLECTIONS_METRIC_IDS: ReadonlyArray<CollectionsMetricId> = [
  'M-01',
  'M-03',
  'M-06',
  'M-07',
];

const RECEIPT_ALL_READ_ROLES: ReadonlyArray<CanonicalRole> = [
  'finance_collections',
  'coordination_lead',
];

const RECEIPT_OWN_TOTALS_ROLES: ReadonlyArray<CanonicalRole> = [
  'partnerships',
  'community',
  'network',
  'premium_sales',
];

const SCHEDULE_INVOICE_READ_ROLES: ReadonlyArray<CanonicalRole> = [
  'finance_collections',
  'coordination_lead',
  'pipeline_ops',
  ...RECEIPT_OWN_TOTALS_ROLES,
];

const CONTRACT_READ_ROLES: ReadonlyArray<CanonicalRole> = [
  ...SCHEDULE_INVOICE_READ_ROLES,
  'viewer',
];

/**
 * Role-based UI capability mapping aligned to 02_architecture_requirements.md §4:
 * - finance_collections: Contracts RU (payment terms); Payment schedules & invoices CRUA; Receipts & allocations CRUA
 * - coordination_lead: Contracts CRUA; Payment schedules & invoices R; Receipts & allocations R
 * - pipeline_ops: Contracts R; Payment schedules & invoices R; Receipts & allocations — (none)
 * - partnerships / community / network / premium_sales: Contracts CR (own); Schedules & invoices R; Receipts R (own deals, totals only)
 * - viewer: Contracts R; Payment schedules, invoices, receipts — (none)
 * - admin: separate from business roles (no implicit collections access)
 */
export function getCollectionsPermissionProfile(
  permissions: UserPermissionContext
): CollectionsPermissionProfile {
  if (!permissions.verified_by_server) {
    return {
      canViewSummaryMetrics: true,
      canReadContracts: true,
      canEditPaymentTerms: true,
      canReadPaymentSchedulesAndInvoices: true,
      canWritePaymentSchedule: true,
      canWriteInvoices: true,
      canReadReceiptsScope: 'all',
      canViewBankReference: false, // fail closed when server identity is unverified
      canWriteReceipts: true,
      verifiedByServer: false,
      currentMemberId: permissions.member_id,
    };
  }

  const roles = permissions.roles;
  const hasAny = (list: ReadonlyArray<CanonicalRole>) =>
    list.some((r) => roles.includes(r));

  const isFinance = roles.includes('finance_collections');
  const isCoordLead = roles.includes('coordination_lead');
  const canReadSchedulesInvoices = hasAny(SCHEDULE_INVOICE_READ_ROLES);
  const canReadContracts = hasAny(CONTRACT_READ_ROLES);

  let canReadReceiptsScope: CollectionsPermissionProfile['canReadReceiptsScope'] =
    'none';
  if (hasAny(RECEIPT_ALL_READ_ROLES)) {
    canReadReceiptsScope = 'all';
  } else if (hasAny(RECEIPT_OWN_TOTALS_ROLES)) {
    canReadReceiptsScope = 'own_totals_only';
  }

  return {
    canViewSummaryMetrics: canReadSchedulesInvoices,
    canReadContracts,
    canEditPaymentTerms: isFinance,
    canReadPaymentSchedulesAndInvoices: canReadSchedulesInvoices,
    canWritePaymentSchedule: isFinance,
    canWriteInvoices: isFinance,
    canReadReceiptsScope,
    canViewBankReference: isFinance || isCoordLead,
    canWriteReceipts: isFinance,
    verifiedByServer: true,
    currentMemberId: permissions.member_id,
  };
}

export function formatCollectionsCurrency(
  value: number | null | undefined
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  if (Math.abs(value) >= 100000) {
    return `₹${(value / 100000).toFixed(2)}L`;
  }
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function formatCollectionsMetricValue(
  result: MetricQueryResult | null | undefined,
  unitOverride?: '₹' | 'ratio'
): string {
  if (!result) return '—';
  if (!result.computable || result.value === null || result.value === undefined) {
    return 'Not computable';
  }
  const unit = unitOverride ?? result.unit;
  if (unit === 'ratio') {
    return `${(result.value * 100).toFixed(1)}%`;
  }
  if (unit === '₹') {
    return formatCollectionsCurrency(result.value);
  }
  return Number.isInteger(result.value)
    ? result.value.toLocaleString('en-IN')
    : result.value.toFixed(1);
}

export function formatScheduleKind(kind: PaymentScheduleKind | string): string {
  switch (kind) {
    case 'advance':
      return 'Advance';
    case 'balance':
      return 'Balance';
    case 'other':
      return 'Other';
    default:
      return String(kind).replace(/_/g, ' ');
  }
}

export function formatScheduleStatus(
  status: PaymentScheduleStatus | string
): string {
  switch (status) {
    case 'due':
      return 'Due';
    case 'paid':
      return 'Paid';
    case 'overdue':
      return 'Overdue';
    case 'partly_paid':
      return 'Partly paid';
    default:
      return String(status).replace(/_/g, ' ');
  }
}

export function formatInvoiceStatus(status: InvoiceStatus | string): string {
  switch (status) {
    case 'issued':
      return 'Issued';
    case 'settled':
      return 'Settled';
    case 'cancelled':
      return 'Cancelled';
    default:
      return String(status).replace(/_/g, ' ');
  }
}

export function formatReceiptMethod(
  method?: ReceiptMethod | string | null
): string {
  if (!method) return '—';
  switch (method) {
    case 'bank transfer':
      return 'Bank transfer';
    case 'UPI':
      return 'UPI';
    case 'cheque':
      return 'Cheque';
    default:
      return String(method);
  }
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
    let message = 'Unable to complete collections request.';
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
        // Ignore parse failure
      }
    } else if (response.status === 403) {
      message = 'Finance permissions are required for this action.';
    } else if (response.status === 404) {
      message = 'Collections data is currently unavailable.';
    }

    throw new CollectionsApiError(message, response.status, code);
  }

  if (!isJson) {
    throw new CollectionsApiError(
      'Collections service is currently unavailable.',
      503,
      'SERVICE_UNAVAILABLE'
    );
  }

  return (await response.json()) as T;
}

function normalizeScheduleItem(
  raw: Record<string, unknown>,
  fallbackContract?: Partial<CollectionsContractRow>
): PaymentScheduleItemRecord {
  const rawKind = String(raw.kind ?? 'advance') as PaymentScheduleKind;
  const kind = ALL_PAYMENT_SCHEDULE_KINDS.includes(rawKind)
    ? rawKind
    : 'other';
  const resolvedStatus =
    ((raw.status ?? raw.derived_status) as PaymentScheduleStatus | undefined) ??
    'due';

  return {
    schedule_item_id: String(raw.schedule_item_id ?? raw.id ?? ''),
    contract_id: String(raw.contract_id ?? fallbackContract?.contract_id ?? ''),
    kind,
    amount_due: Number(raw.amount_due ?? 0),
    due_date: String(raw.due_date ?? ''),
    status: resolvedStatus,
    derived_status:
      (raw.derived_status as PaymentScheduleStatus | undefined) ?? resolvedStatus,
    allocated_amount:
      raw.allocated_amount !== undefined && raw.allocated_amount !== null
        ? Number(raw.allocated_amount)
        : null,
    remaining_amount:
      raw.remaining_amount !== undefined && raw.remaining_amount !== null
        ? Number(raw.remaining_amount)
        : null,
    record_class:
      (raw.record_class as 'simulated' | 'live') ??
      fallbackContract?.record_class ??
      'simulated',
    source_ref: (raw.source_ref as string | null | undefined) ?? null,
    data_version:
      (raw.data_version as string | number | null | undefined) ?? null,
    sponsor_id:
      (raw.sponsor_id as string | null | undefined) ??
      fallbackContract?.sponsor_id ??
      null,
    sponsor_name:
      (raw.sponsor_name as string | null | undefined) ??
      fallbackContract?.sponsor_name ??
      null,
    opportunity_id:
      (raw.opportunity_id as string | null | undefined) ??
      fallbackContract?.opportunity_id ??
      null,
    opportunity_name:
      (raw.opportunity_name as string | null | undefined) ??
      fallbackContract?.opportunity_name ??
      null,
  };
}

function normalizeInvoice(
  raw: Record<string, unknown>,
  fallbackContract?: Partial<CollectionsContractRow>
): InvoiceRecord {
  return {
    invoice_id: String(raw.invoice_id ?? raw.id ?? ''),
    invoice_no: String(raw.invoice_no ?? ''),
    contract_id: String(raw.contract_id ?? fallbackContract?.contract_id ?? ''),
    schedule_item_id:
      (raw.schedule_item_id as string | null | undefined) ?? null,
    issued_at: String(raw.issued_at ?? ''),
    amount: Number(raw.amount ?? 0),
    tax_amount:
      raw.tax_amount !== undefined && raw.tax_amount !== null
        ? Number(raw.tax_amount)
        : null,
    status: (raw.status as InvoiceStatus) ?? 'issued',
    document_uri: (raw.document_uri as string | null | undefined) ?? null,
    record_class:
      (raw.record_class as 'simulated' | 'live') ??
      fallbackContract?.record_class ??
      'simulated',
    source_ref: (raw.source_ref as string | null | undefined) ?? null,
    data_version:
      (raw.data_version as string | number | null | undefined) ?? null,
    sponsor_id:
      (raw.sponsor_id as string | null | undefined) ??
      fallbackContract?.sponsor_id ??
      null,
    sponsor_name:
      (raw.sponsor_name as string | null | undefined) ??
      fallbackContract?.sponsor_name ??
      null,
    schedule_item_kind:
      (raw.schedule_item_kind as PaymentScheduleKind | null | undefined) ?? null,
  };
}

function normalizeAllocation(
  raw: Record<string, unknown>
): ReceiptAllocationRecord {
  return {
    allocation_id: String(raw.allocation_id ?? raw.id ?? ''),
    receipt_id: String(raw.receipt_id ?? ''),
    invoice_id: (raw.invoice_id as string | null | undefined) ?? null,
    schedule_item_id:
      (raw.schedule_item_id as string | null | undefined) ?? null,
    amount: Number(raw.amount ?? 0),
    record_class:
      (raw.record_class as 'simulated' | 'live' | undefined) ?? undefined,
    created_at: (raw.created_at as string | null | undefined) ?? null,
    invoice_no: (raw.invoice_no as string | null | undefined) ?? null,
    schedule_item_kind:
      (raw.schedule_item_kind as PaymentScheduleKind | null | undefined) ?? null,
  };
}

function normalizeReceipt(
  raw: Record<string, unknown>,
  fallbackContract?: Partial<CollectionsContractRow>
): ReceiptRecord {
  const rawMethod = raw.method ? String(raw.method) : null;
  const method =
    rawMethod && ALL_RECEIPT_METHODS.includes(rawMethod as ReceiptMethod)
      ? (rawMethod as ReceiptMethod)
      : null;

  const allocationsRaw = Array.isArray(raw.allocations)
    ? (raw.allocations as Array<Record<string, unknown>>)
    : undefined;

  return {
    receipt_id: String(raw.receipt_id ?? raw.id ?? ''),
    sponsor_id: String(raw.sponsor_id ?? fallbackContract?.sponsor_id ?? ''),
    received_at: String(raw.received_at ?? ''),
    amount: Number(raw.amount ?? 0),
    method,
    bank_reference: (raw.bank_reference as string | null | undefined) ?? null,
    bank_reference_redacted: Boolean(raw.bank_reference_redacted),
    reconciled: Boolean(raw.reconciled),
    unreconciled:
      typeof raw.unreconciled === 'boolean'
        ? raw.unreconciled
        : !Boolean(raw.reconciled),
    reconciled_at: (raw.reconciled_at as string | null | undefined) ?? null,
    recorded_by: (raw.recorded_by as string | null | undefined) ?? null,
    record_class:
      (raw.record_class as 'simulated' | 'live') ??
      fallbackContract?.record_class ??
      'simulated',
    source_ref: (raw.source_ref as string | null | undefined) ?? null,
    data_version:
      (raw.data_version as string | number | null | undefined) ?? null,
    sponsor_name:
      (raw.sponsor_name as string | null | undefined) ??
      fallbackContract?.sponsor_name ??
      null,
    contract_id:
      (raw.contract_id as string | null | undefined) ??
      fallbackContract?.contract_id ??
      null,
    allocated_amount:
      raw.allocated_amount !== undefined && raw.allocated_amount !== null
        ? Number(raw.allocated_amount)
        : null,
    unallocated_amount:
      raw.unallocated_amount !== undefined && raw.unallocated_amount !== null
        ? Number(raw.unallocated_amount)
        : null,
    allocations: allocationsRaw?.map(normalizeAllocation),
    counted_as_collected:
      typeof raw.counted_as_collected === 'boolean'
        ? raw.counted_as_collected
        : null,
    totals_only_redacted: Boolean(raw.totals_only_redacted),
  };
}

function normalizeBalanceView(
  raw: Record<string, unknown> | null | undefined,
  contractId: string
): BalanceViewRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  if (
    raw.cash_signed === undefined &&
    raw.cash_received === undefined &&
    raw.outstanding === undefined
  ) {
    return null;
  }
  return {
    contract_id: String(raw.contract_id ?? contractId),
    cash_signed: Number(raw.cash_signed ?? 0),
    cash_received: Number(raw.cash_received ?? 0),
    outstanding: Number(raw.outstanding ?? 0),
    overdue_amount: Number(raw.overdue_amount ?? 0),
  };
}

function normalizeContractRow(
  raw: Record<string, unknown>
): CollectionsContractRow {
  const contractId = String(raw.contract_id ?? raw.id ?? '');
  const recordClass = (raw.record_class as 'simulated' | 'live') ?? 'simulated';
  const base: CollectionsContractRow = {
    contract_id: contractId,
    opportunity_id: String(raw.opportunity_id ?? ''),
    signed_at: String(raw.signed_at ?? ''),
    signed_value_total: Number(raw.signed_value_total ?? 0),
    payment_terms: (raw.payment_terms as string | null | undefined) ?? null,
    signatory_contact_id:
      (raw.signatory_contact_id as string | null | undefined) ?? null,
    document_uri: (raw.document_uri as string | null | undefined) ?? null,
    status: (raw.status as CollectionsContractRow['status']) ?? 'active',
    record_class: recordClass,
    edition_id: (raw.edition_id as string | null | undefined) ?? null,
    opportunity_name:
      (raw.opportunity_name as string | null | undefined) ?? null,
    signatory_name: (raw.signatory_name as string | null | undefined) ?? null,
    sponsor_id: (raw.sponsor_id as string | null | undefined) ?? null,
    sponsor_name: (raw.sponsor_name as string | null | undefined) ?? null,
    owner_member_id:
      (raw.owner_member_id as string | null | undefined) ?? null,
    owner_name: (raw.owner_name as string | null | undefined) ?? null,
    lines: Array.isArray(raw.lines)
      ? (raw.lines as SponsorContractLineRecord[])
      : undefined,
  };

  const rawBalance =
    (raw.balance_view as Record<string, unknown> | undefined) ??
    (raw.balance as Record<string, unknown> | undefined);
  base.balance_view = normalizeBalanceView(rawBalance, contractId);

  if (Array.isArray(raw.payment_schedule)) {
    base.payment_schedule = (
      raw.payment_schedule as Array<Record<string, unknown>>
    ).map((item) => normalizeScheduleItem(item, base));
  }
  if (Array.isArray(raw.invoices)) {
    base.invoices = (raw.invoices as Array<Record<string, unknown>>).map(
      (inv) => normalizeInvoice(inv, base)
    );
  }
  if (Array.isArray(raw.receipts)) {
    base.receipts = (raw.receipts as Array<Record<string, unknown>>).map(
      (rec) => normalizeReceipt(rec, base)
    );
  }
  if (Array.isArray(raw.allocations)) {
    base.allocations = (
      raw.allocations as Array<Record<string, unknown>>
    ).map(normalizeAllocation);
  }

  return base;
}

function normalizeGateRecord(
  raw: Record<string, unknown>
): GateReferenceRecord {
  return {
    gate_id: String(raw.gate_id ?? raw.id ?? ''),
    name: (raw.name as string | null | undefined) ?? null,
    metric_id: (raw.metric_id as string | null | undefined) ?? null,
    threshold:
      raw.threshold !== undefined && raw.threshold !== null
        ? Number(raw.threshold)
        : null,
    threshold_label:
      (raw.threshold_label as string | null | undefined) ?? null,
    checkpoint_label:
      (raw.checkpoint_label as string | null | undefined) ?? null,
    status: (raw.status as string | null | undefined) ?? null,
    pass: typeof raw.pass === 'boolean' ? raw.pass : null,
    description: (raw.description as string | null | undefined) ?? null,
  };
}

export interface CollectionsWorkspaceData {
  summary: CollectionsSummaryState;
  contracts: CollectionsContractRow[];
  sponsors: SponsorEntity[];
  paymentSchedules: PaymentScheduleItemRecord[];
  invoices: InvoiceRecord[];
  receipts: ReceiptRecord[];
  allocations: ReceiptAllocationRecord[];
  historicalNoFinancialRecords: boolean;
  joinedSupport: {
    hasBalanceView: boolean;
    hasPaymentSchedules: boolean;
    hasInvoices: boolean;
    hasReceipts: boolean;
    hasAllocations: boolean;
  };
}

function buildRestrictedMetrics(
  recordClass: CollectionsRecordClass,
  reason: string
): MetricQueryResult[] {
  return (['M-01', 'M-06', 'M-07'] as const).map((metricId) => ({
    metric_id: metricId,
    value: null,
    unit: metricId === 'M-06' ? 'ratio' : '₹',
    numerator: null,
    denominator: null,
    computable: false,
    reason,
    record_class: recordClass,
  }));
}

/**
 * Loads Collections workspace data strictly using documented backend contracts:
 * - POST /api/metrics/query for M-01, M-03, M-06, M-07 (+ M-02/M-04 context)
 * - GET /api/gates for T−7 cash collection gate definition/status
 * - GET /api/contracts, /api/collections/schedule, /api/collections/balances, /api/collections/receipts
 */
export async function fetchCollectionsWorkspaceData(
  filters: CollectionsFilters,
  permissionProfile: CollectionsPermissionProfile,
  signal?: AbortSignal
): Promise<CollectionsWorkspaceData> {
  const isHistorical = filters.record_class === 'historical_synthetic';
  const asOf = filters.as_of || getTodayIstIso();

  // 1. Server-computed metrics (split public signed/in-kind vs cash collection metrics for role safety)
  const publicMetricsPromise = queryMetrics(
    {
      metric_ids: ['M-02', 'M-03', 'M-04'],
      record_class: filters.record_class,
      edition_id: filters.edition_id,
      as_of: asOf,
    },
    signal
  )
    .then((results) => ({ results, unavailable: false }))
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      return { results: [] as MetricQueryResult[], unavailable: true };
    });

  const cashMetricsPromise = permissionProfile.canViewSummaryMetrics
    ? queryMetrics(
        {
          metric_ids: ['M-01', 'M-06', 'M-07'],
          record_class: filters.record_class,
          edition_id: filters.edition_id,
          as_of: asOf,
        },
        signal
      )
        .then((results) => ({ results, unavailable: false }))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw err;
          }
          if (err instanceof CampaignApiError && err.status === 403) {
            return {
              results: buildRestrictedMetrics(
                filters.record_class,
                'Restricted for current role'
              ),
              unavailable: false,
            };
          }
          return { results: [] as MetricQueryResult[], unavailable: true };
        })
    : Promise.resolve({
        results: buildRestrictedMetrics(
          filters.record_class,
          'Restricted (viewer role)'
        ),
        unavailable: false,
      });

  const metricsPromise = Promise.all([
    publicMetricsPromise,
    cashMetricsPromise,
  ]).then(([pub, cash]) => ({
    results: [...pub.results, ...cash.results],
    unavailable: pub.unavailable && cash.unavailable,
  }));

  const gatesPromise = requestJson<
    | Array<Record<string, unknown>>
    | {
        cash_gate?: {
          kpi_id?: string;
          metric_id?: string;
          threshold?: number | null;
          actual_value?: number | null;
          computable?: boolean;
          reason?: string | null;
          status?: string | null;
        };
        gates?: Array<Record<string, unknown>>;
        items?: Array<Record<string, unknown>>;
      }
  >(
    `${OVERVIEW_API_ENDPOINTS.gates}?${new URLSearchParams({
      editionId: filters.edition_id,
      recordClass: filters.record_class,
      asOf,
    }).toString()}`,
    { signal }
  )
    .then((res) => {
      const list = Array.isArray(res) ? res : res.gates ?? res.items ?? [];
      const gates = list.map(normalizeGateRecord);
      const matchedGate =
        gates.find(
          (g) =>
            g.metric_id === 'M-06' ||
            g.gate_id.toUpperCase().includes('T-7') ||
            g.gate_id.toUpperCase().includes('CASH') ||
            (g.name ?? '').toLowerCase().includes('cash')
        ) ?? null;

      const serverCashGate = !Array.isArray(res) ? res.cash_gate : undefined;
      const cashGate: GateReferenceRecord | null = serverCashGate
        ? {
            gate_id: matchedGate?.gate_id ?? serverCashGate.kpi_id ?? 'K-G-02',
            name: matchedGate?.name ?? 'T−7 cash collection gate',
            metric_id: serverCashGate.metric_id ?? 'M-06',
            threshold:
              serverCashGate.threshold ?? matchedGate?.threshold ?? 0.85,
            threshold_label:
              matchedGate?.threshold_label ??
              (serverCashGate.threshold !== null &&
              serverCashGate.threshold !== undefined
                ? `≥ ${(serverCashGate.threshold * 100).toFixed(0)}%`
                : '≥ 85%'),
            checkpoint_label: matchedGate?.checkpoint_label ?? 'T−7',
            status:
              serverCashGate.status && serverCashGate.status !== 'unavailable'
                ? serverCashGate.status
                : serverCashGate.reason ||
                  matchedGate?.status ||
                  serverCashGate.status ||
                  null,
            pass: matchedGate?.pass ?? null,
            description: matchedGate?.description ?? serverCashGate.reason ?? null,
          }
        : matchedGate ?? gates[0] ?? null;

      return { cashGate, unavailable: false };
    })
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      return { cashGate: null as GateReferenceRecord | null, unavailable: true };
    });

  // 2. Historical synthetic class has no payment/invoice/receipt records
  if (isHistorical) {
    const [metricOutcome, gateOutcome] = await Promise.all([
      metricsPromise,
      gatesPromise,
    ]);

    const metricMap: Partial<Record<CollectionsMetricId, MetricQueryResult>> = {};
    let dataVersion: string | number | null = null;
    for (const item of metricOutcome.results) {
      metricMap[item.metric_id as CollectionsMetricId] = item;
      if (item.data_version !== undefined && item.data_version !== null) {
        dataVersion = item.data_version;
      }
    }

    return {
      summary: {
        metrics: metricMap,
        dataVersion,
        asOf,
        cashGate: gateOutcome.cashGate,
        metricsUnavailable: metricOutcome.unavailable,
        gatesUnavailable: gateOutcome.unavailable,
      },
      contracts: [],
      sponsors: [],
      paymentSchedules: [],
      invoices: [],
      receipts: [],
      allocations: [],
      historicalNoFinancialRecords: true,
      joinedSupport: {
        hasBalanceView: false,
        hasPaymentSchedules: false,
        hasInvoices: false,
        hasReceipts: false,
        hasAllocations: false,
      },
    };
  }

  // 3. Simulated / Live contracts + collections projections + sponsors
  const sharedQuery = new URLSearchParams({
    record_class: filters.record_class,
    edition_id: filters.edition_id,
  });

  const contractsPromise = permissionProfile.canReadContracts
    ? requestJson<
        | Array<Record<string, unknown>>
        | {
            contracts?: Array<Record<string, unknown>>;
            items?: Array<Record<string, unknown>>;
          }
      >(`${OVERVIEW_API_ENDPOINTS.contracts}?${sharedQuery.toString()}`, {
        signal,
      })
    : Promise.resolve([]);

  const scheduleEndpointPromise =
    permissionProfile.canReadPaymentSchedulesAndInvoices
      ? requestJson<{ schedule?: Array<Record<string, unknown>> }>(
          `${OVERVIEW_API_ENDPOINTS.collectionsSchedule}?${sharedQuery.toString()}`,
          { signal }
        )
          .then((res) => ({
            ok: true,
            items: (res.schedule ?? []).map((item) => normalizeScheduleItem(item)),
          }))
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === 'AbortError') {
              throw err;
            }
            return { ok: false, items: [] as PaymentScheduleItemRecord[] };
          })
      : Promise.resolve({ ok: false, items: [] as PaymentScheduleItemRecord[] });

  const balancesEndpointPromise =
    permissionProfile.canReadPaymentSchedulesAndInvoices
      ? requestJson<{ balances?: Array<Record<string, unknown>> }>(
          `${OVERVIEW_API_ENDPOINTS.collectionsBalances}?${sharedQuery.toString()}`,
          { signal }
        )
          .then((res) => ({
            ok: true,
            items: (res.balances ?? [])
              .map((item) =>
                normalizeBalanceView(item, String(item.contract_id ?? ''))
              )
              .filter((b): b is BalanceViewRecord => b !== null),
          }))
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === 'AbortError') {
              throw err;
            }
            return { ok: false, items: [] as BalanceViewRecord[] };
          })
      : Promise.resolve({ ok: false, items: [] as BalanceViewRecord[] });

  const receiptsEndpointPromise =
    permissionProfile.canReadReceiptsScope !== 'none'
      ? requestJson<{ receipts?: Array<Record<string, unknown>> }>(
          `${OVERVIEW_API_ENDPOINTS.collectionsReceipts}?${sharedQuery.toString()}`,
          { signal }
        )
          .then((res) => ({
            ok: true,
            items: (res.receipts ?? []).map((item) => normalizeReceipt(item)),
          }))
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === 'AbortError') {
              throw err;
            }
            return { ok: false, items: [] as ReceiptRecord[] };
          })
      : Promise.resolve({ ok: false, items: [] as ReceiptRecord[] });

  const sponsorsPromise = requestJson<
    SponsorEntity[] | { sponsors?: SponsorEntity[]; items?: SponsorEntity[] }
  >(`${OVERVIEW_API_ENDPOINTS.sponsors}?${sharedQuery.toString()}`, { signal })
    .then((res) => (Array.isArray(res) ? res : res.sponsors ?? res.items ?? []))
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      return [] as SponsorEntity[];
    });

  const [
    metricOutcome,
    gateOutcome,
    rawContractsRes,
    scheduleOutcome,
    balancesOutcome,
    receiptsOutcome,
    sponsors,
  ] = await Promise.all([
    metricsPromise,
    gatesPromise,
    contractsPromise,
    scheduleEndpointPromise,
    balancesEndpointPromise,
    receiptsEndpointPromise,
    sponsorsPromise,
  ]);

  const metricMap: Partial<Record<CollectionsMetricId, MetricQueryResult>> = {};
  let dataVersion: string | number | null = null;
  for (const item of metricOutcome.results) {
    metricMap[item.metric_id as CollectionsMetricId] = item;
    if (item.data_version !== undefined && item.data_version !== null) {
      dataVersion = item.data_version;
    }
  }

  const rawContractsList = Array.isArray(rawContractsRes)
    ? rawContractsRes
    : rawContractsRes.contracts ?? rawContractsRes.items ?? [];

  const sponsorMap = new Map<string, SponsorEntity>();
  for (const s of sponsors) {
    sponsorMap.set(s.sponsor_id, s);
  }

  const balanceByContractId = new Map<string, BalanceViewRecord>();
  for (const bal of balancesOutcome.items) {
    balanceByContractId.set(bal.contract_id, bal);
  }

  const contracts = rawContractsList.map((raw) => {
    const normalized = normalizeContractRow(raw);
    if (!normalized.sponsor_name && normalized.sponsor_id) {
      const sp = sponsorMap.get(normalized.sponsor_id);
      if (sp) normalized.sponsor_name = sp.display_name;
    }
    const dedicatedBalance = balanceByContractId.get(normalized.contract_id);
    if (dedicatedBalance) {
      normalized.balance_view = dedicatedBalance;
    }
    return normalized;
  });

  // Merge schedules, invoices, receipts, and allocations from /api/contracts + /api/collections/*
  const scheduleMap = new Map<string, PaymentScheduleItemRecord>();
  const invoices: InvoiceRecord[] = [];
  const receiptsMap = new Map<string, ReceiptRecord>();
  const allocationsMap = new Map<string, ReceiptAllocationRecord>();

  let hasBalanceView = balancesOutcome.ok && balancesOutcome.items.length > 0;
  let hasPaymentSchedules = scheduleOutcome.ok;
  let hasInvoices = false;
  let hasReceipts = receiptsOutcome.ok;
  let hasAllocations = false;

  for (const item of scheduleOutcome.items) {
    if (item.schedule_item_id) {
      scheduleMap.set(item.schedule_item_id, item);
    }
  }

  for (const rec of receiptsOutcome.items) {
    if (rec.receipt_id) {
      receiptsMap.set(rec.receipt_id, rec);
    }
    if (rec.allocations) {
      for (const alloc of rec.allocations) {
        if (alloc.allocation_id) {
          hasAllocations = true;
          allocationsMap.set(alloc.allocation_id, alloc);
        }
      }
    }
  }

  for (const contract of contracts) {
    if (contract.balance_view) hasBalanceView = true;
    if (contract.payment_schedule) {
      hasPaymentSchedules = true;
      for (const item of contract.payment_schedule) {
        if (!scheduleMap.has(item.schedule_item_id)) {
          scheduleMap.set(item.schedule_item_id, item);
        }
      }
    }
    if (contract.invoices) {
      hasInvoices = true;
      invoices.push(...contract.invoices);
    }
    if (contract.receipts) {
      hasReceipts = true;
      for (const rec of contract.receipts) {
        const existing = receiptsMap.get(rec.receipt_id);
        if (!existing) {
          receiptsMap.set(rec.receipt_id, rec);
        } else if (!existing.contract_id && rec.contract_id) {
          receiptsMap.set(rec.receipt_id, {
            ...existing,
            contract_id: rec.contract_id,
          });
        }
        if (rec.allocations) {
          hasAllocations = true;
          for (const alloc of rec.allocations) {
            if (!allocationsMap.has(alloc.allocation_id)) {
              allocationsMap.set(alloc.allocation_id, alloc);
            }
          }
        }
      }
    }
    if (contract.allocations) {
      hasAllocations = true;
      for (const alloc of contract.allocations) {
        if (!allocationsMap.has(alloc.allocation_id)) {
          allocationsMap.set(alloc.allocation_id, alloc);
        }
      }
    }
  }

  return {
    summary: {
      metrics: metricMap,
      dataVersion,
      asOf,
      cashGate: gateOutcome.cashGate,
      metricsUnavailable: metricOutcome.unavailable,
      gatesUnavailable: gateOutcome.unavailable,
    },
    contracts,
    sponsors,
    paymentSchedules: Array.from(scheduleMap.values()),
    invoices,
    receipts: Array.from(receiptsMap.values()),
    allocations: Array.from(allocationsMap.values()),
    historicalNoFinancialRecords: false,
    joinedSupport: {
      hasBalanceView,
      hasPaymentSchedules,
      hasInvoices,
      hasReceipts,
      hasAllocations,
    },
  };
}

/**
 * Finance-only write: POST /api/payment-schedule -> DB record_payment_schedule_item()
 */
export async function createPaymentScheduleItem(
  payload: CreatePaymentSchedulePayload,
  permissionProfile: CollectionsPermissionProfile
): Promise<PaymentScheduleItemRecord> {
  if (!permissionProfile.canWritePaymentSchedule) {
    throw new CollectionsApiError(
      'Only Finance & Collections can record payment schedule items.',
      403,
      'FORBIDDEN'
    );
  }
  if ((payload.record_class as string) === 'historical_synthetic') {
    throw new CollectionsApiError(
      'Historical synthetic records cannot be modified.',
      403,
      'READ_ONLY_RECORD'
    );
  }
  if (!Number.isFinite(payload.amount_due) || payload.amount_due <= 0) {
    throw new CollectionsApiError(
      'Amount due must be greater than zero.',
      400,
      'INVALID_AMOUNT'
    );
  }
  const res = await requestJson<
    Record<string, unknown> & { schedule_item?: Record<string, unknown> }
  >(OVERVIEW_API_ENDPOINTS.paymentSchedule, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return normalizeScheduleItem(res.schedule_item ?? res);
}

/**
 * Finance-only write: POST /api/invoices -> DB record_invoice()
 * Issued invoices are immutable.
 */
export async function createInvoice(
  payload: CreateInvoicePayload,
  permissionProfile: CollectionsPermissionProfile
): Promise<InvoiceRecord> {
  if (!permissionProfile.canWriteInvoices) {
    throw new CollectionsApiError(
      'Only Finance & Collections can issue invoices.',
      403,
      'FORBIDDEN'
    );
  }
  if ((payload.record_class as string) === 'historical_synthetic') {
    throw new CollectionsApiError(
      'Historical synthetic records cannot be modified.',
      403,
      'READ_ONLY_RECORD'
    );
  }
  if (!payload.invoice_no.trim()) {
    throw new CollectionsApiError(
      'Sequential invoice number is required.',
      400,
      'INVALID_INVOICE_NO'
    );
  }
  if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
    throw new CollectionsApiError(
      'Invoice amount must be greater than zero.',
      400,
      'INVALID_AMOUNT'
    );
  }
  const res = await requestJson<
    Record<string, unknown> & { invoice?: Record<string, unknown> }
  >(OVERVIEW_API_ENDPOINTS.invoices, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return normalizeInvoice(res.invoice ?? res);
}

/**
 * Finance-only write: POST /api/receipts -> DB record_receipt()
 * Receipts are immutable once recorded; record_class ∈ {simulated, live}.
 */
export async function createReceipt(
  payload: CreateReceiptPayload,
  permissionProfile: CollectionsPermissionProfile
): Promise<ReceiptRecord> {
  if (!permissionProfile.canWriteReceipts) {
    throw new CollectionsApiError(
      'Only Finance & Collections can record receipts.',
      403,
      'FORBIDDEN'
    );
  }
  if ((payload.record_class as string) === 'historical_synthetic') {
    throw new CollectionsApiError(
      'Receipts cannot be recorded under historical synthetic records.',
      403,
      'READ_ONLY_RECORD'
    );
  }
  if (!payload.sponsor_id.trim()) {
    throw new CollectionsApiError(
      'Sponsor selection is required.',
      400,
      'INVALID_SPONSOR'
    );
  }
  if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
    throw new CollectionsApiError(
      'Receipt amount must be greater than zero.',
      400,
      'INVALID_AMOUNT'
    );
  }
  if (!payload.bank_reference.trim()) {
    throw new CollectionsApiError(
      'Unique bank reference is required.',
      400,
      'INVALID_BANK_REFERENCE'
    );
  }
  const res = await requestJson<
    Record<string, unknown> & { receipt?: Record<string, unknown> }
  >(OVERVIEW_API_ENDPOINTS.receipts, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return normalizeReceipt(res.receipt ?? res);
}

/**
 * Finance-only contract update: PATCH /api/contracts/:id restricted strictly to payment_terms.
 * signed_value_total and contract lines remain immutable after signing.
 */
export async function updateContractPaymentTerms(
  contractId: string,
  payload: UpdateContractPaymentTermsPayload,
  permissionProfile: CollectionsPermissionProfile
): Promise<CollectionsContractRow> {
  if (!permissionProfile.canEditPaymentTerms) {
    throw new CollectionsApiError(
      'Only Finance & Collections can update contract payment terms.',
      403,
      'FORBIDDEN'
    );
  }
  const res = await requestJson<
    Record<string, unknown> & { contract?: Record<string, unknown> }
  >(`${OVERVIEW_API_ENDPOINTS.contracts}/${encodeURIComponent(contractId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ payment_terms: payload.payment_terms }),
  });
  return normalizeContractRow(res.contract ?? res);
}
