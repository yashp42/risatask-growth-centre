import type { MetricQueryResult } from './campaigns';
import type { SponsorContractRecord } from './sponsors';

/**
 * Financial entities exist only in `simulated` and `live` record classes.
 * `historical_synthetic` (ED-2025) has no payment, invoice, or receipt records.
 */
export type CollectionsRecordClass =
  | 'simulated'
  | 'live'
  | 'historical_synthetic';

export type CollectionsTab =
  | 'receivables'
  | 'payment_schedules'
  | 'invoices'
  | 'receipts';

/**
 * Canonical PAYMENT_SCHEDULE_ITEM enums (01_conceptual_data_model.md §4D)
 */
export type PaymentScheduleKind = 'advance' | 'balance' | 'other';
export type PaymentScheduleStatus = 'due' | 'paid' | 'overdue' | 'partly_paid';

export const ALL_PAYMENT_SCHEDULE_KINDS: ReadonlyArray<PaymentScheduleKind> = [
  'advance',
  'balance',
  'other',
];

export const PAYMENT_TERMS_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: 'standard 50/50', label: 'Standard 50/50' },
  { value: '100% upfront', label: '100% upfront' },
  { value: 'custom', label: 'Custom' },
];

export interface PaymentScheduleItemRecord {
  schedule_item_id: string;
  contract_id: string;
  kind: PaymentScheduleKind;
  amount_due: number;
  due_date: string;
  /**
   * Derived server-side from RECEIPT_ALLOCATION coverage and due_date; never edited manually.
   */
  status: PaymentScheduleStatus;
  derived_status?: PaymentScheduleStatus;
  allocated_amount?: number | null;
  remaining_amount?: number | null;
  record_class: 'simulated' | 'live';
  source_ref?: string | null;
  data_version?: string | number | null;
  // Optional server-joined labels
  sponsor_id?: string | null;
  sponsor_name?: string | null;
  opportunity_id?: string | null;
  opportunity_name?: string | null;
}

/**
 * Canonical INVOICE entity (01_conceptual_data_model.md §4D)
 * Immutable once issued.
 */
export type InvoiceStatus = 'issued' | 'cancelled' | 'settled';

export interface InvoiceRecord {
  invoice_id: string;
  invoice_no: string;
  contract_id: string;
  schedule_item_id?: string | null;
  issued_at: string;
  amount: number;
  tax_amount?: number | null;
  status: InvoiceStatus;
  document_uri?: string | null;
  record_class: 'simulated' | 'live';
  source_ref?: string | null;
  data_version?: string | number | null;
  // Optional server-joined labels
  sponsor_id?: string | null;
  sponsor_name?: string | null;
  schedule_item_kind?: PaymentScheduleKind | null;
}

/**
 * Canonical RECEIPT entity (01_conceptual_data_model.md §4D)
 * Immutable; record_class ∈ {live, simulated} only.
 */
export type ReceiptMethod = 'bank transfer' | 'UPI' | 'cheque';

export const ALL_RECEIPT_METHODS: ReadonlyArray<ReceiptMethod> = [
  'bank transfer',
  'UPI',
  'cheque',
];

export interface ReceiptRecord {
  receipt_id: string;
  sponsor_id: string;
  received_at: string;
  amount: number;
  method?: ReceiptMethod | null;
  bank_reference?: string | null;
  bank_reference_redacted?: boolean;
  reconciled: boolean;
  unreconciled?: boolean;
  reconciled_at?: string | null;
  recorded_by?: string | null;
  record_class: 'simulated' | 'live';
  source_ref?: string | null;
  data_version?: string | number | null;
  // Optional server-joined display/allocation state
  sponsor_name?: string | null;
  contract_id?: string | null;
  allocated_amount?: number | null;
  unallocated_amount?: number | null;
  allocations?: ReceiptAllocationRecord[];
  counted_as_collected?: boolean | null;
  totals_only_redacted?: boolean;
}

/**
 * Canonical RECEIPT_ALLOCATION entity (01_conceptual_data_model.md §4D)
 * Append-only; ties receipts to invoices and schedule items.
 */
export interface ReceiptAllocationRecord {
  allocation_id: string;
  receipt_id: string;
  invoice_id?: string | null;
  schedule_item_id?: string | null;
  amount: number;
  record_class?: 'simulated' | 'live';
  created_at?: string | null;
  // Optional server-joined labels
  invoice_no?: string | null;
  schedule_item_kind?: PaymentScheduleKind | null;
}

/**
 * Canonical BALANCE_VIEW derived read projection (01_conceptual_data_model.md §4D)
 * Computed exclusively by the backend; never computed or edited in React.
 */
export interface BalanceViewRecord {
  contract_id: string;
  cash_signed: number;
  cash_received: number;
  outstanding: number;
  overdue_amount: number;
}

/**
 * Extended contract row returned by GET /api/contracts (with optional server joins).
 */
export interface CollectionsContractRow extends SponsorContractRecord {
  sponsor_id?: string | null;
  sponsor_name?: string | null;
  owner_member_id?: string | null;
  owner_name?: string | null;
  balance_view?: BalanceViewRecord | null;
  payment_schedule?: PaymentScheduleItemRecord[];
  invoices?: InvoiceRecord[];
  receipts?: ReceiptRecord[];
  allocations?: ReceiptAllocationRecord[];
}

/**
 * Gate reference from GET /api/reference/gates
 */
export interface GateReferenceRecord {
  gate_id: string;
  name?: string | null;
  metric_id?: string | null;
  threshold?: number | null;
  threshold_label?: string | null;
  checkpoint_label?: string | null;
  status?: string | null;
  pass?: boolean | null;
  description?: string | null;
}

/**
 * Canonical metric IDs for Collections (05_metric_dictionary.csv)
 * M-01, M-03, M-06, M-07 are primary Collections KPIs; M-02 & M-04 are queried only for
 * explicit separation when needed and never mixed into cash collected.
 */
export type CollectionsMetricId = 'M-01' | 'M-03' | 'M-06' | 'M-07' | 'M-02' | 'M-04';

export interface CollectionsMetricMeta {
  metric_id: CollectionsMetricId;
  name: string;
  kpi_id: string | null;
  formula: string;
  unit: '₹' | 'ratio';
  inclusion_exclusion: string;
  computable_2025: boolean;
}

export interface CollectionsSummaryState {
  metrics: Partial<Record<CollectionsMetricId, MetricQueryResult>>;
  dataVersion: string | number | null;
  asOf: string | null;
  cashGate: GateReferenceRecord | null;
  metricsUnavailable: boolean;
  gatesUnavailable: boolean;
}

export interface CollectionsFilters {
  record_class: CollectionsRecordClass;
  edition_id: string;
  search: string;
  as_of: string;
}

/**
 * Role-based UI capability profile aligned to 02_architecture_requirements.md §4.
 * Client flags only shape UI visibility; actual authorization is server-side.
 */
export interface CollectionsPermissionProfile {
  canViewSummaryMetrics: boolean;
  canReadContracts: boolean;
  canEditPaymentTerms: boolean;
  canReadPaymentSchedulesAndInvoices: boolean;
  canWritePaymentSchedule: boolean;
  canWriteInvoices: boolean;
  canReadReceiptsScope: 'all' | 'own_totals_only' | 'none';
  canViewBankReference: boolean;
  canWriteReceipts: boolean;
  verifiedByServer: boolean;
  currentMemberId: string | null;
}

/**
 * Finance-only write payloads (10_technical_architecture_handoff.md §2.3)
 */
export interface CreatePaymentSchedulePayload {
  contract_id: string;
  kind: PaymentScheduleKind;
  amount_due: number;
  due_date: string;
  record_class: 'simulated' | 'live';
}

export interface CreateInvoicePayload {
  contract_id: string;
  schedule_item_id?: string | null;
  invoice_no: string;
  issued_at: string;
  amount: number;
  tax_amount?: number | null;
  document_uri?: string | null;
  record_class: 'simulated' | 'live';
}

export interface CreateReceiptPayload {
  sponsor_id: string;
  received_at: string;
  amount: number;
  method: ReceiptMethod;
  bank_reference: string;
  reconciled: boolean;
  record_class: 'simulated' | 'live';
}

export interface UpdateContractPaymentTermsPayload {
  payment_terms: string;
}
