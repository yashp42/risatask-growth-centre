import {
  AlertCircle,
  ArrowUpRight,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  READ_ONLY_2025_MESSAGE,
  formatRecordClassDisplay,
  isHistoricalReadOnlyEdition,
} from '../../lib/dateIst';
import {
  COLLECTIONS_EDITION_BY_CLASS,
  COLLECTIONS_RECORD_CLASS_OPTIONS,
  formatCollectionsCurrency,
  formatInvoiceStatus,
  formatReceiptMethod,
  formatScheduleKind,
  formatScheduleStatus,
  getDefaultCollectionsEditionForClass,
} from '../../services/collectionsApi';
import type {
  CollectionsContractRow,
  CollectionsFilters,
  CollectionsPermissionProfile,
  CollectionsRecordClass,
  CollectionsSummaryState,
  CollectionsTab,
  InvoiceRecord,
  PaymentScheduleItemRecord,
  ReceiptAllocationRecord,
  ReceiptRecord,
} from '../../types/collections';
import type { ApiErrorInfo, DataLoadStatus } from '../../types/overview';
import type { PreviewStateMode } from '../overview/OverviewHeaderFilters';
import { DataStateWrapper, EmptyStateNotice } from '../ui/DataStateWrapper';
import { SelectControl } from '../ui/SelectControl';
import { CollectionsOverviewSection } from './CollectionsOverviewSection';

interface CollectionsWorkspacePageProps {
  filters: CollectionsFilters;
  onChangeFilters: (next: CollectionsFilters) => void;
  summary: CollectionsSummaryState;
  contracts: CollectionsContractRow[];
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
  permissionProfile: CollectionsPermissionProfile;
  status: DataLoadStatus;
  error: ApiErrorInfo | null;
  onRetry: () => void;
  onRefresh: () => void;
  onOpenScheduleDrawer: (contractId?: string | null) => void;
  onOpenInvoiceDrawer: (contractId?: string | null) => void;
  onOpenReceiptDrawer: (sponsorId?: string | null) => void;
  onOpenPaymentTermsDrawer: (contract: CollectionsContractRow) => void;
  onOpenSponsor?: (sponsorId: string) => void;
  onOpenOpportunity?: (opportunityId: string) => void;
  showDevControls: boolean;
  previewMode: PreviewStateMode;
  onChangePreviewMode: (mode: PreviewStateMode) => void;
}

const SECTION_TABS: ReadonlyArray<{ id: CollectionsTab; label: string }> = [
  { id: 'receivables', label: 'Receivables' },
  { id: 'payment_schedules', label: 'Payment schedules' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'receipts', label: 'Receipts' },
];

export function CollectionsWorkspacePage({
  filters,
  onChangeFilters,
  summary,
  contracts,
  paymentSchedules,
  invoices,
  receipts,
  allocations,
  historicalNoFinancialRecords,
  joinedSupport,
  permissionProfile,
  status,
  error,
  onRetry,
  onRefresh,
  onOpenScheduleDrawer,
  onOpenInvoiceDrawer,
  onOpenReceiptDrawer,
  onOpenPaymentTermsDrawer,
  onOpenSponsor,
  onOpenOpportunity,
  showDevControls,
  previewMode,
  onChangePreviewMode,
}: CollectionsWorkspacePageProps) {
  const [activeTab, setActiveTab] = useState<CollectionsTab>('receivables');

  const isHistorical = isHistoricalReadOnlyEdition(
    filters.edition_id,
    filters.record_class
  );
  const editionOptions = COLLECTIONS_EDITION_BY_CLASS[filters.record_class];
  const searchQuery = filters.search.trim().toLowerCase();

  const filteredContracts = useMemo(() => {
    if (!searchQuery) return contracts;
    return contracts.filter((c) => {
      const hay = [
        c.contract_id,
        c.opportunity_id,
        c.opportunity_name,
        c.sponsor_id,
        c.sponsor_name,
        c.payment_terms,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(searchQuery);
    });
  }, [contracts, searchQuery]);

  const filteredSchedules = useMemo(() => {
    if (!searchQuery) return paymentSchedules;
    return paymentSchedules.filter((item) => {
      const hay = [
        item.schedule_item_id,
        item.contract_id,
        item.sponsor_name,
        item.opportunity_name,
        item.kind,
        item.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(searchQuery);
    });
  }, [paymentSchedules, searchQuery]);

  const filteredInvoices = useMemo(() => {
    if (!searchQuery) return invoices;
    return invoices.filter((inv) => {
      const hay = [
        inv.invoice_no,
        inv.invoice_id,
        inv.contract_id,
        inv.schedule_item_id,
        inv.sponsor_name,
        inv.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(searchQuery);
    });
  }, [invoices, searchQuery]);

  const ownedContractIds = useMemo(() => {
    if (!permissionProfile.currentMemberId) return new Set<string>();
    return new Set(
      contracts
        .filter((c) => c.owner_member_id === permissionProfile.currentMemberId)
        .map((c) => c.contract_id)
    );
  }, [contracts, permissionProfile.currentMemberId]);

  const ownedSponsorIds = useMemo(() => {
    if (!permissionProfile.currentMemberId) return new Set<string>();
    return new Set(
      contracts
        .filter(
          (c) =>
            c.owner_member_id === permissionProfile.currentMemberId &&
            c.sponsor_id
        )
        .map((c) => c.sponsor_id as string)
    );
  }, [contracts, permissionProfile.currentMemberId]);

  const visibleReceipts = useMemo(() => {
    let base = receipts;
    if (
      permissionProfile.verifiedByServer &&
      permissionProfile.canReadReceiptsScope === 'own_totals_only'
    ) {
      base = base.filter(
        (r) =>
          (r.contract_id && ownedContractIds.has(r.contract_id)) ||
          ownedSponsorIds.has(r.sponsor_id)
      );
    }
    if (!searchQuery) return base;
    return base.filter((r) => {
      const hay = [
        r.receipt_id,
        r.sponsor_id,
        r.sponsor_name,
        r.contract_id,
        permissionProfile.canViewBankReference ? r.bank_reference : null,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(searchQuery);
    });
  }, [
    receipts,
    permissionProfile,
    ownedContractIds,
    ownedSponsorIds,
    searchQuery,
  ]);

  const allocationsByReceipt = useMemo(() => {
    const map = new Map<string, ReceiptAllocationRecord[]>();
    for (const alloc of allocations) {
      const list = map.get(alloc.receipt_id) ?? [];
      list.push(alloc);
      map.set(alloc.receipt_id, list);
    }
    return map;
  }, [allocations]);

  const handleRecordClassChange = (nextClass: CollectionsRecordClass) => {
    onChangeFilters({
      ...filters,
      record_class: nextClass,
      edition_id: getDefaultCollectionsEditionForClass(nextClass),
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-[#D9D7D0] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#202824]">
            Collections
          </h1>
          <p className="mt-1 text-[13px] text-[#525E58]">
            Signed cash obligations, payment schedules, issued invoices, and
            reconciled cash receipts.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11px] text-[#788C83]">
            <span>{formatRecordClassDisplay(filters.record_class)}</span>
            <span aria-hidden="true">·</span>
            <span>{filters.edition_id}</span>
            <span aria-hidden="true">·</span>
            <span>As of {filters.as_of}</span>
            {isHistorical ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-[#525E58]">
                  {READ_ONLY_2025_MESSAGE}
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {showDevControls ? (
            <div className="mr-2 flex items-center gap-1 rounded-md border border-[#D9D7D0] bg-white p-0.5 text-[11px]">
              {(['default', 'loading', 'error'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onChangePreviewMode(mode)}
                  className={`rounded px-2 py-1 capitalize transition-colors ${
                    previewMode === mode
                      ? 'bg-[#315F52] text-white'
                      : 'text-[#525E58] hover:text-[#202824]'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] font-medium text-[#202824] transition-colors hover:bg-[#FAF9F6]"
          >
            <RefreshCw className="h-3.5 w-3.5 text-[#525E58]" />
            Refresh
          </button>

          {permissionProfile.canWritePaymentSchedule ? (
            <button
              type="button"
              disabled={isHistorical}
              title={isHistorical ? READ_ONLY_2025_MESSAGE : undefined}
              onClick={() => onOpenScheduleDrawer(null)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] font-medium text-[#202824] transition-colors hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5 text-[#315F52]" />
              Add schedule item
            </button>
          ) : null}

          {permissionProfile.canWriteInvoices ? (
            <button
              type="button"
              disabled={isHistorical}
              title={isHistorical ? READ_ONLY_2025_MESSAGE : undefined}
              onClick={() => onOpenInvoiceDrawer(null)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] font-medium text-[#202824] transition-colors hover:bg-[#FAF9F6] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5 text-[#315F52]" />
              Record invoice
            </button>
          ) : null}

          {permissionProfile.canWriteReceipts ? (
            <button
              type="button"
              disabled={isHistorical}
              title={isHistorical ? READ_ONLY_2025_MESSAGE : undefined}
              onClick={() => onOpenReceiptDrawer(null)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#315F52] px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[#274D42] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Record receipt
            </button>
          ) : null}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="relative flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#788C83]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={filters.search}
            onChange={(e) =>
              onChangeFilters({ ...filters, search: e.target.value })
            }
            placeholder="Search sponsor, contract, or invoice..."
            aria-label="Search collections"
            className="h-9 w-full rounded-md border border-[#D9D7D0] bg-white pl-9 pr-3 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-end gap-2.5">
          <div className="w-60">
            <SelectControl
              id="collections-record-class"
              label="Record class"
              value={filters.record_class}
              options={COLLECTIONS_RECORD_CLASS_OPTIONS}
              onChange={(val) =>
                handleRecordClassChange(val as CollectionsRecordClass)
              }
            />
          </div>
          <div className="w-48">
            <SelectControl
              id="collections-edition"
              label="Festival edition"
              value={filters.edition_id}
              options={editionOptions}
              onChange={(val) =>
                onChangeFilters({ ...filters, edition_id: val })
              }
            />
          </div>
        </div>
      </div>

      {/* Overview KPI Strip (M-01, M-03, M-06, M-07) */}
      <CollectionsOverviewSection
        summary={summary}
        recordClass={filters.record_class}
        editionId={filters.edition_id}
        permissionProfile={permissionProfile}
        loading={status === 'loading'}
      />

      {/* Section Tabs */}
      <div className="border-b border-[#D9D7D0]">
        <nav
          aria-label="Collections sections"
          className="-mb-px flex flex-wrap gap-6"
        >
          {SECTION_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const count =
              tab.id === 'receivables' && !isHistorical
                ? filteredContracts.length
                : tab.id === 'payment_schedules' &&
                    joinedSupport.hasPaymentSchedules
                  ? filteredSchedules.length
                  : tab.id === 'invoices' && joinedSupport.hasInvoices
                    ? filteredInvoices.length
                    : tab.id === 'receipts' && joinedSupport.hasReceipts
                      ? visibleReceipts.length
                      : undefined;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 border-b-2 pb-3 text-[13px] font-medium transition-colors ${
                  isActive
                    ? 'border-[#315F52] text-[#202824]'
                    : 'border-transparent text-[#525E58] hover:text-[#202824]'
                }`}
              >
                <span>{tab.label}</span>
                {count !== undefined ? (
                  <span className="font-mono text-[11px] text-[#788C83]">
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main Content */}
      <DataStateWrapper
        status={status}
        error={error}
        onRetry={onRetry}
        loadingSkeleton={
          <div className="rounded-md border border-[#D9D7D0] bg-white p-6">
            <div className="space-y-3">
              <div className="h-5 w-48 animate-pulse rounded bg-[#F3F1EB]" />
              <div className="h-28 animate-pulse rounded bg-[#FAF9F6]" />
            </div>
          </div>
        }
      >
        {historicalNoFinancialRecords ? (
          <EmptyStateNotice
            title="No payment, invoice, or receipt records exist in 2025 historical synthetic data"
            description="ED-2025 includes historical campaign and opportunity records only. Switch to Simulated (ED-2026-DEMO) or Live (ED-2026-LIVE) to inspect contracts, payment schedules, invoices, and cash receipts."
          />
        ) : null}

        {/* 1. RECEIVABLES TAB */}
        {!historicalNoFinancialRecords && activeTab === 'receivables' ? (
          permissionProfile.verifiedByServer &&
          !permissionProfile.canReadContracts ? (
            <EmptyStateNotice
              title="Contract and receivable visibility is restricted for your role"
              description="Assign a business role in Team & Settings to view contract receivables."
            />
          ) : filteredContracts.length === 0 ? (
            <EmptyStateNotice
              title={
                contracts.length === 0
                  ? 'No signed contracts found for this edition'
                  : 'No contracts match your search'
              }
              description="Contracts are created from confirmed sponsorship opportunities in Pipeline."
            />
          ) : (
            <div className="space-y-3">
              {!joinedSupport.hasBalanceView ? (
                <div className="flex items-start gap-2 rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-4 py-3 text-[12px] text-[#525E58]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#788C83]" />
                  <span>
                    Per-contract cash balance figures (signed cash, cash
                    received, outstanding, and overdue) are not yet available
                    from the data service.
                  </span>
                </div>
              ) : null}

              <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6] text-[12px] font-medium text-[#525E58]">
                        <th className="px-4 py-3">Sponsor &amp; Contract</th>
                        <th className="px-4 py-3">Payment terms</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Signed cash</th>
                        <th className="px-4 py-3 text-right">Cash received</th>
                        <th className="px-4 py-3 text-right">Outstanding</th>
                        <th className="px-4 py-3 text-right">Overdue</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8E6E0] text-[13px]">
                      {filteredContracts.map((contract) => {
                        const bal = contract.balance_view;
                        return (
                          <tr
                            key={contract.contract_id}
                            className="hover:bg-[#FAF9F6]"
                          >
                            <td className="px-4 py-3">
                              <div className="flex flex-col gap-0.5">
                                {contract.sponsor_id && onOpenSponsor ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onOpenSponsor(contract.sponsor_id!)
                                    }
                                    className="inline-flex w-fit items-center gap-1 text-left font-medium text-[#202824] hover:text-[#315F52]"
                                  >
                                    <span>
                                      {contract.sponsor_name ||
                                        contract.sponsor_id}
                                    </span>
                                    <ArrowUpRight className="h-3.5 w-3.5 text-[#788C83]" />
                                  </button>
                                ) : (
                                  <span className="font-medium text-[#202824]">
                                    {contract.sponsor_name ||
                                      contract.opportunity_name ||
                                      contract.contract_id}
                                  </span>
                                )}

                                <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#788C83]">
                                  <span className="font-mono">
                                    {contract.contract_id}
                                  </span>
                                  <span>·</span>
                                  {contract.opportunity_id &&
                                  onOpenOpportunity ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onOpenOpportunity(
                                          contract.opportunity_id
                                        )
                                      }
                                      className="inline-flex items-center gap-0.5 text-[#525E58] hover:text-[#315F52]"
                                    >
                                      <span>
                                        {contract.opportunity_name ||
                                          contract.opportunity_id}
                                      </span>
                                      <ArrowUpRight className="h-3 w-3" />
                                    </button>
                                  ) : (
                                    <span>
                                      {contract.opportunity_name ||
                                        contract.opportunity_id}
                                    </span>
                                  )}
                                </div>

                                {contract.lines && contract.lines.length > 0 ? (
                                  <span className="mt-0.5 text-[11px] text-[#788C83]">
                                    Lines:{' '}
                                    {contract.lines
                                      .map(
                                        (l) =>
                                          `${l.consideration_type === 'in_kind' ? 'In-kind' : 'Cash'} ${formatCollectionsCurrency(l.value)}`
                                      )
                                      .join(' · ')}
                                  </span>
                                ) : null}
                              </div>
                            </td>

                            <td className="px-4 py-3 text-[#525E58]">
                              <div className="flex items-center gap-2">
                                <span>{contract.payment_terms || '—'}</span>
                                {permissionProfile.canEditPaymentTerms &&
                                contract.status !== 'terminated' ? (
                                  <button
                                    type="button"
                                    disabled={isHistorical}
                                    title={
                                      isHistorical
                                        ? READ_ONLY_2025_MESSAGE
                                        : undefined
                                    }
                                    onClick={() =>
                                      onOpenPaymentTermsDrawer(contract)
                                    }
                                    className="text-[11px] font-medium text-[#315F52] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Edit
                                  </button>
                                ) : null}
                              </div>
                            </td>

                            <td className="px-4 py-3 capitalize text-[#202824]">
                              {contract.status}
                            </td>

                            <td className="px-4 py-3 text-right font-mono tabular-nums text-[#202824]">
                              {bal
                                ? formatCollectionsCurrency(bal.cash_signed)
                                : 'Unavailable'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-[#315F52]">
                              {bal
                                ? formatCollectionsCurrency(bal.cash_received)
                                : 'Unavailable'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums text-[#202824]">
                              {bal
                                ? formatCollectionsCurrency(bal.outstanding)
                                : 'Unavailable'}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-mono tabular-nums ${
                                bal && bal.overdue_amount > 0
                                  ? 'font-medium text-[#9B3B32]'
                                  : 'text-[#525E58]'
                              }`}
                            >
                              {bal
                                ? formatCollectionsCurrency(bal.overdue_amount)
                                : 'Unavailable'}
                            </td>

                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-2">
                                {permissionProfile.canWritePaymentSchedule &&
                                contract.status !== 'terminated' ? (
                                  <button
                                    type="button"
                                    disabled={isHistorical}
                                    title={
                                      isHistorical
                                        ? READ_ONLY_2025_MESSAGE
                                        : undefined
                                    }
                                    onClick={() =>
                                      onOpenScheduleDrawer(contract.contract_id)
                                    }
                                    className="text-[12px] font-medium text-[#315F52] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Schedule
                                  </button>
                                ) : null}
                                {permissionProfile.canWriteInvoices &&
                                contract.status !== 'terminated' ? (
                                  <button
                                    type="button"
                                    disabled={isHistorical}
                                    title={
                                      isHistorical
                                        ? READ_ONLY_2025_MESSAGE
                                        : undefined
                                    }
                                    onClick={() =>
                                      onOpenInvoiceDrawer(contract.contract_id)
                                    }
                                    className="text-[12px] font-medium text-[#315F52] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Invoice
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )
        ) : null}

        {/* 2. PAYMENT SCHEDULES TAB */}
        {!historicalNoFinancialRecords && activeTab === 'payment_schedules' ? (
          permissionProfile.verifiedByServer &&
          !permissionProfile.canReadPaymentSchedulesAndInvoices ? (
            <EmptyStateNotice
              title="Payment schedules are restricted for your role"
              description="Viewer and admin-only accounts do not have access to payment schedules or invoices."
            />
          ) : !joinedSupport.hasPaymentSchedules ? (
            <EmptyStateNotice
              title="Payment schedule items are currently unavailable"
              description="Schedule read records are not yet returned by the data service. Finance can still record new payment schedule items."
              action={
                permissionProfile.canWritePaymentSchedule ? (
                  <button
                    type="button"
                    disabled={isHistorical}
                    title={isHistorical ? READ_ONLY_2025_MESSAGE : undefined}
                    onClick={() => onOpenScheduleDrawer(null)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white hover:bg-[#274D42] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add schedule item
                  </button>
                ) : undefined
              }
            />
          ) : filteredSchedules.length === 0 ? (
            <EmptyStateNotice
              title="No payment schedule items match your search"
              action={
                permissionProfile.canWritePaymentSchedule ? (
                  <button
                    type="button"
                    disabled={isHistorical}
                    title={isHistorical ? READ_ONLY_2025_MESSAGE : undefined}
                    onClick={() => onOpenScheduleDrawer(null)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white hover:bg-[#274D42] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add schedule item
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6] text-[12px] font-medium text-[#525E58]">
                      <th className="px-4 py-3">Schedule ID</th>
                      <th className="px-4 py-3">Sponsor / Contract</th>
                      <th className="px-4 py-3">Kind</th>
                      <th className="px-4 py-3">Due date</th>
                      <th className="px-4 py-3 text-right">Amount due</th>
                      <th className="px-4 py-3">Derived status</th>
                      {permissionProfile.canWriteInvoices ? (
                        <th className="px-4 py-3 text-right">Actions</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8E6E0] text-[13px]">
                    {filteredSchedules.map((item) => (
                      <tr
                        key={item.schedule_item_id}
                        className="hover:bg-[#FAF9F6]"
                      >
                        <td className="px-4 py-3 font-mono text-[12px] font-medium text-[#202824]">
                          {item.schedule_item_id}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-medium text-[#202824]">
                              {item.sponsor_name || item.contract_id}
                            </span>
                            <span className="font-mono text-[11px] text-[#788C83]">
                              {item.contract_id}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[#202824]">
                          {formatScheduleKind(item.kind)}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-[#525E58]">
                          {item.due_date ? item.due_date.slice(0, 10) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-[#202824]">
                          {formatCollectionsCurrency(item.amount_due)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-[12px] font-medium ${
                              item.status === 'overdue'
                                ? 'text-[#9B3B32]'
                                : item.status === 'paid'
                                  ? 'text-[#315F52]'
                                  : 'text-[#525E58]'
                            }`}
                          >
                            {formatScheduleStatus(item.status)}
                          </span>
                        </td>
                        {permissionProfile.canWriteInvoices ? (
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              disabled={isHistorical}
                              title={
                                isHistorical
                                  ? READ_ONLY_2025_MESSAGE
                                  : undefined
                              }
                              onClick={() =>
                                onOpenInvoiceDrawer(item.contract_id)
                              }
                              className="text-[12px] font-medium text-[#315F52] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Issue invoice
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : null}

        {/* 3. INVOICES TAB */}
        {!historicalNoFinancialRecords && activeTab === 'invoices' ? (
          permissionProfile.verifiedByServer &&
          !permissionProfile.canReadPaymentSchedulesAndInvoices ? (
            <EmptyStateNotice
              title="Invoices are restricted for your role"
              description="Viewer and admin-only accounts do not have access to issued invoices."
            />
          ) : !joinedSupport.hasInvoices ? (
            <EmptyStateNotice
              title="Issued invoices are currently unavailable"
              description="Invoice read records are not yet returned by the data service. Finance can still record issued invoices."
              action={
                permissionProfile.canWriteInvoices ? (
                  <button
                    type="button"
                    disabled={isHistorical}
                    title={isHistorical ? READ_ONLY_2025_MESSAGE : undefined}
                    onClick={() => onOpenInvoiceDrawer(null)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white hover:bg-[#274D42] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Record invoice
                  </button>
                ) : undefined
              }
            />
          ) : filteredInvoices.length === 0 ? (
            <EmptyStateNotice
              title="No invoices match your search"
              action={
                permissionProfile.canWriteInvoices ? (
                  <button
                    type="button"
                    disabled={isHistorical}
                    title={isHistorical ? READ_ONLY_2025_MESSAGE : undefined}
                    onClick={() => onOpenInvoiceDrawer(null)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white hover:bg-[#274D42] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Record invoice
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-3">
              <p className="text-[12px] text-[#525E58]">
                Invoices are immutable once issued and do not represent cash
                collected until matched to reconciled receipts.
              </p>
              <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6] text-[12px] font-medium text-[#525E58]">
                        <th className="px-4 py-3">Invoice no.</th>
                        <th className="px-4 py-3">Sponsor / Contract</th>
                        <th className="px-4 py-3">Schedule item</th>
                        <th className="px-4 py-3">Issued at</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                        <th className="px-4 py-3 text-right">Tax</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Document</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8E6E0] text-[13px]">
                      {filteredInvoices.map((inv) => (
                        <tr
                          key={inv.invoice_id}
                          className="hover:bg-[#FAF9F6]"
                        >
                          <td className="px-4 py-3 font-mono font-medium text-[#202824]">
                            {inv.invoice_no}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col">
                              <span className="font-medium text-[#202824]">
                                {inv.sponsor_name || inv.contract_id}
                              </span>
                              <span className="font-mono text-[11px] text-[#788C83]">
                                {inv.contract_id}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-[12px] text-[#525E58]">
                            {inv.schedule_item_id || '—'}
                          </td>
                          <td className="px-4 py-3 font-mono text-[12px] text-[#525E58]">
                            {inv.issued_at ? inv.issued_at.slice(0, 10) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-[#202824]">
                            {formatCollectionsCurrency(inv.amount)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-[#525E58]">
                            {inv.tax_amount !== null &&
                            inv.tax_amount !== undefined
                              ? formatCollectionsCurrency(inv.tax_amount)
                              : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`text-[12px] font-medium ${
                                inv.status === 'settled'
                                  ? 'text-[#315F52]'
                                  : inv.status === 'cancelled'
                                    ? 'text-[#9B3B32]'
                                    : 'text-[#202824]'
                              }`}
                            >
                              {formatInvoiceStatus(inv.status)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {inv.document_uri ? (
                              <a
                                href={inv.document_uri}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[12px] font-medium text-[#315F52] hover:underline"
                              >
                                <span>View</span>
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-[12px] text-[#788C83]">
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )
        ) : null}

        {/* 4. RECEIPTS & ALLOCATIONS TAB */}
        {!historicalNoFinancialRecords && activeTab === 'receipts' ? (
          permissionProfile.verifiedByServer &&
          permissionProfile.canReadReceiptsScope === 'none' ? (
            <EmptyStateNotice
              title="Receipts and allocations are restricted for your role"
              description="Receipts are visible only to Finance & Collections, Coordination Lead, and deal owners (totals only)."
            />
          ) : !joinedSupport.hasReceipts ? (
            <EmptyStateNotice
              title="Receipt and allocation records are currently unavailable"
              description="Receipt and allocation read records are not yet returned by the data service. Finance can still log new receipts."
              action={
                permissionProfile.canWriteReceipts ? (
                  <button
                    type="button"
                    disabled={isHistorical}
                    title={isHistorical ? READ_ONLY_2025_MESSAGE : undefined}
                    onClick={() => onOpenReceiptDrawer(null)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white hover:bg-[#274D42] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Record receipt
                  </button>
                ) : undefined
              }
            />
          ) : visibleReceipts.length === 0 ? (
            <EmptyStateNotice
              title="No receipts visible for the current scope"
              action={
                permissionProfile.canWriteReceipts ? (
                  <button
                    type="button"
                    disabled={isHistorical}
                    title={isHistorical ? READ_ONLY_2025_MESSAGE : undefined}
                    onClick={() => onOpenReceiptDrawer(null)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#315F52] px-3 text-[12px] font-medium text-white hover:bg-[#274D42] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Record receipt
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col gap-1 rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-4 py-3 text-[12px] text-[#525E58]">
                <span>
                  Receipts are immutable once saved. Only receipts that are both{' '}
                  <strong className="font-medium text-[#202824]">
                    reconciled
                  </strong>{' '}
                  and{' '}
                  <strong className="font-medium text-[#202824]">
                    allocated
                  </strong>{' '}
                  to an invoice or schedule item count as collected cash.
                </span>
                {permissionProfile.canReadReceiptsScope === 'own_totals_only' ? (
                  <span>
                    Showing your own deals (totals only); bank references and
                    line-level payment details are masked.
                  </span>
                ) : null}
              </div>

              <div className="overflow-hidden rounded-md border border-[#D9D7D0] bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[#D9D7D0] bg-[#FAF9F6] text-[12px] font-medium text-[#525E58]">
                        <th className="px-4 py-3">Receipt</th>
                        <th className="px-4 py-3">Sponsor</th>
                        <th className="px-4 py-3">Received at</th>
                        {permissionProfile.canReadReceiptsScope !==
                        'own_totals_only' ? (
                          <th className="px-4 py-3">Method &amp; Bank ref</th>
                        ) : null}
                        <th className="px-4 py-3 text-right">Amount</th>
                        <th className="px-4 py-3">Reconciliation</th>
                        <th className="px-4 py-3">Allocation &amp; Collection</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E8E6E0] text-[13px]">
                      {visibleReceipts.map((rec) => {
                        const recAllocs =
                          rec.allocations ??
                          allocationsByReceipt.get(rec.receipt_id) ??
                          [];
                        const isAllocated =
                          (rec.allocated_amount !== null &&
                            rec.allocated_amount !== undefined &&
                            rec.allocated_amount > 0) ||
                          recAllocs.length > 0;
                        const isCountedAsCollected =
                          typeof rec.counted_as_collected === 'boolean'
                            ? rec.counted_as_collected
                            : rec.reconciled && isAllocated;

                        return (
                          <tr
                            key={rec.receipt_id}
                            className="align-top hover:bg-[#FAF9F6]"
                          >
                            <td className="px-4 py-3 font-mono text-[12px] font-medium text-[#202824]">
                              {rec.receipt_id}
                            </td>
                            <td className="px-4 py-3">
                              {rec.sponsor_id && onOpenSponsor ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenSponsor(rec.sponsor_id)}
                                  className="inline-flex items-center gap-1 font-medium text-[#202824] hover:text-[#315F52]"
                                >
                                  <span>
                                    {rec.sponsor_name || rec.sponsor_id}
                                  </span>
                                  <ArrowUpRight className="h-3.5 w-3.5 text-[#788C83]" />
                                </button>
                              ) : (
                                <span className="font-medium text-[#202824]">
                                  {rec.sponsor_name || rec.sponsor_id}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono text-[12px] text-[#525E58]">
                              {rec.received_at
                                ? rec.received_at.slice(0, 10)
                                : '—'}
                            </td>

                            {permissionProfile.canReadReceiptsScope !==
                            'own_totals_only' ? (
                              <td className="px-4 py-3 text-[12px] text-[#525E58]">
                                <div>{formatReceiptMethod(rec.method)}</div>
                                <div className="font-mono text-[11px] text-[#788C83]">
                                  {permissionProfile.canViewBankReference &&
                                  !rec.bank_reference_redacted
                                    ? rec.bank_reference || '—'
                                    : 'Bank reference restricted'}
                                </div>
                              </td>
                            ) : null}

                            <td className="px-4 py-3 text-right font-mono font-medium tabular-nums text-[#202824]">
                              {formatCollectionsCurrency(rec.amount)}
                            </td>

                            <td className="px-4 py-3 text-[12px]">
                              <span
                                className={`font-medium ${
                                  rec.reconciled
                                    ? 'text-[#315F52]'
                                    : 'text-[#9B6B2E]'
                                }`}
                              >
                                {rec.reconciled ? 'Reconciled' : 'Unreconciled'}
                              </span>
                            </td>

                            <td className="px-4 py-3 text-[12px]">
                              <div className="space-y-1">
                                <div
                                  className={`font-medium ${
                                    isCountedAsCollected
                                      ? 'text-[#315F52]'
                                      : 'text-[#525E58]'
                                  }`}
                                >
                                  {isCountedAsCollected
                                    ? 'Counted as collected'
                                    : rec.reconciled
                                      ? 'Reconciled, not yet allocated'
                                      : 'Unreconciled — not counted'}
                                </div>

                                {permissionProfile.canReadReceiptsScope !==
                                  'own_totals_only' && recAllocs.length > 0 ? (
                                  <div className="space-y-0.5 text-[11px] text-[#788C83]">
                                    {recAllocs.map((alloc) => (
                                      <div
                                        key={alloc.allocation_id}
                                        className="font-mono"
                                      >
                                        {formatCollectionsCurrency(alloc.amount)}
                                        {alloc.invoice_no
                                          ? ` → ${alloc.invoice_no}`
                                          : alloc.invoice_id
                                            ? ` → ${alloc.invoice_id}`
                                            : ''}
                                        {alloc.schedule_item_id
                                          ? ` (${alloc.schedule_item_id})`
                                          : ''}
                                      </div>
                                    ))}
                                  </div>
                                ) : !joinedSupport.hasAllocations &&
                                  rec.allocated_amount === null ? (
                                  <div className="text-[11px] text-[#788C83]">
                                    Allocation linkage unavailable
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )
        ) : null}
      </DataStateWrapper>
    </div>
  );
}
