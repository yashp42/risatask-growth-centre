import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSeason } from '../../contexts/SeasonContext';
import { isHistoricalReadOnlyEdition } from '../../lib/dateIst';
import {
  cancelInvoice,
  CollectionsApiError,
  fetchCollectionsWorkspaceData,
  getCollectionsPermissionProfile,
  reconcileReceipt,
  type CollectionsWorkspaceData,
} from '../../services/collectionsApi';
import {
  DEFAULT_UNVERIFIED_PERMISSIONS,
  fetchCurrentUserPermissions,
} from '../../services/sponsorsApi';
import type {
  CollectionsContractRow,
  CollectionsFilters,
  CollectionsSummaryState,
  ReceiptRecord,
} from '../../types/collections';
import type { ApiErrorInfo, DataLoadStatus } from '../../types/overview';
import type { UserPermissionContext } from '../../types/sponsors';
import type { PreviewStateMode } from '../overview/OverviewHeaderFilters';
import { AllocateReceiptDrawer } from './AllocateReceiptDrawer';
import { CollectionsWorkspacePage } from './CollectionsWorkspacePage';
import { InvoiceFormDrawer } from './InvoiceFormDrawer';
import { PaymentScheduleFormDrawer } from './PaymentScheduleFormDrawer';
import { PaymentTermsDrawer } from './PaymentTermsDrawer';
import { ReceiptFormDrawer } from './ReceiptFormDrawer';

interface CollectionsWorkspaceProps {
  showDevControls: boolean;
  onOpenSponsor?: (sponsorId: string) => void;
  onOpenOpportunity?: (opportunityId: string) => void;
}

const EMPTY_SUMMARY: CollectionsSummaryState = {
  metrics: {},
  dataVersion: null,
  asOf: null,
  cashGate: null,
  metricsUnavailable: false,
  gatesUnavailable: false,
};

const EMPTY_DATA: CollectionsWorkspaceData = {
  summary: EMPTY_SUMMARY,
  contracts: [],
  sponsors: [],
  paymentSchedules: [],
  invoices: [],
  receipts: [],
  allocations: [],
  historicalNoFinancialRecords: false,
  joinedSupport: {
    hasBalanceView: false,
    hasPaymentSchedules: false,
    hasInvoices: false,
    hasReceipts: false,
    hasAllocations: false,
  },
};

export function CollectionsWorkspace({
  showDevControls,
  onOpenSponsor,
  onOpenOpportunity,
}: CollectionsWorkspaceProps) {
  const queryClient = useQueryClient();
  const { editionId, recordClass, asOf, setEditionAndClass, setAsOf } =
    useSeason();

  const [filters, setFilters] = useState<CollectionsFilters>(() => ({
    record_class: recordClass,
    edition_id: editionId,
    search: '',
    as_of: asOf,
  }));

  const [previewMode, setPreviewMode] = useState<PreviewStateMode>('default');
  const [reloadNonce, setReloadNonce] = useState(0);

  const [permissions, setPermissions] = useState<UserPermissionContext>(
    DEFAULT_UNVERIFIED_PERMISSIONS
  );
  const permissionProfile = useMemo(
    () => getCollectionsPermissionProfile(permissions),
    [permissions]
  );

  const [status, setStatus] = useState<DataLoadStatus>('loading');
  const [data, setData] = useState<CollectionsWorkspaceData>(EMPTY_DATA);
  const [error, setError] = useState<ApiErrorInfo | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reconcilingReceiptId, setReconcilingReceiptId] = useState<string | null>(
    null
  );

  const [scheduleDrawerOpen, setScheduleDrawerOpen] = useState(false);
  const [scheduleDefaultContractId, setScheduleDefaultContractId] = useState<
    string | null
  >(null);

  const [invoiceDrawerOpen, setInvoiceDrawerOpen] = useState(false);
  const [invoiceDefaultContractId, setInvoiceDefaultContractId] = useState<
    string | null
  >(null);

  const [receiptDrawerOpen, setReceiptDrawerOpen] = useState(false);
  const [receiptDefaultSponsorId, setReceiptDefaultSponsorId] = useState<
    string | null
  >(null);

  const [allocateDrawerReceipt, setAllocateDrawerReceipt] =
    useState<ReceiptRecord | null>(null);

  const [termsDrawerContract, setTermsDrawerContract] =
    useState<CollectionsContractRow | null>(null);

  useEffect(() => {
    setFilters((prev) =>
      prev.edition_id === editionId &&
      prev.record_class === recordClass &&
      prev.as_of === asOf
        ? prev
        : {
            ...prev,
            edition_id: editionId,
            record_class: recordClass,
            as_of: asOf,
          }
    );
  }, [editionId, recordClass, asOf]);

  const handleChangeFilters = useCallback(
    (
      updater:
        | CollectionsFilters
        | ((prev: CollectionsFilters) => CollectionsFilters)
    ) => {
      setFilters((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (
          next.edition_id !== prev.edition_id ||
          next.record_class !== prev.record_class
        ) {
          setEditionAndClass(next.edition_id, next.record_class);
        }
        if (next.as_of !== prev.as_of) {
          setAsOf(next.as_of);
        }
        return next;
      });
    },
    [setEditionAndClass, setAsOf]
  );

  useEffect(() => {
    if (!showDevControls && previewMode !== 'default') {
      setPreviewMode('default');
    }
  }, [showDevControls, previewMode]);

  useEffect(() => {
    const controller = new AbortController();
    fetchCurrentUserPermissions(controller.signal).then((ctx) => {
      setPermissions(ctx);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    if (showDevControls && previewMode === 'loading') {
      setStatus('loading');
      setError(null);
      return () => controller.abort();
    }

    if (showDevControls && previewMode === 'error') {
      setStatus('error');
      setError({
        code: 'UNAVAILABLE',
        message: 'Collections data could not be retrieved right now.',
        endpoint: '',
      });
      return () => controller.abort();
    }

    setStatus('loading');
    setError(null);

    fetchCollectionsWorkspaceData(filters, permissionProfile, controller.signal)
      .then((res) => {
        setData(res);
        setStatus(
          res.contracts.length > 0 || res.historicalNoFinancialRecords
            ? 'ready'
            : 'empty'
        );
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setData(EMPTY_DATA);
        setStatus('error');
        setError({
          code: err instanceof CollectionsApiError ? err.code : 'ERROR',
          message:
            err instanceof CollectionsApiError
              ? err.message
              : 'Unable to load collections data.',
          endpoint: '',
        });
      });

    return () => controller.abort();
  }, [filters, permissionProfile, previewMode, showDevControls, reloadNonce]);

  const invalidateAll = useCallback(() => {
    setPreviewMode('default');
    setActionError(null);
    setReloadNonce((n) => n + 1);
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const writableRecordClass: 'simulated' | 'live' =
    filters.record_class === 'live' ? 'live' : 'simulated';
  const isHistoricalReadOnly = isHistoricalReadOnlyEdition(
    filters.edition_id,
    filters.record_class
  );

  const handleReconcileReceipt = useCallback(
    async (receiptId: string) => {
      if (isHistoricalReadOnly) return;
      setActionError(null);
      setReconcilingReceiptId(receiptId);
      try {
        await reconcileReceipt(
          filters.edition_id,
          receiptId,
          permissionProfile
        );
        invalidateAll();
      } catch (err: unknown) {
        setActionError(
          err instanceof CollectionsApiError
            ? err.message
            : 'Unable to reconcile receipt.'
        );
      } finally {
        setReconcilingReceiptId(null);
      }
    },
    [filters.edition_id, invalidateAll, isHistoricalReadOnly, permissionProfile]
  );

  const handleCancelInvoice = useCallback(
    async (invoiceId: string, reason: string) => {
      if (isHistoricalReadOnly) return;
      setActionError(null);
      await cancelInvoice(
        filters.edition_id,
        invoiceId,
        reason,
        permissionProfile
      );
      invalidateAll();
    },
    [filters.edition_id, invalidateAll, isHistoricalReadOnly, permissionProfile]
  );

  return (
    <>
      <CollectionsWorkspacePage
        filters={filters}
        onChangeFilters={handleChangeFilters}
        summary={data.summary}
        contracts={data.contracts}
        paymentSchedules={data.paymentSchedules}
        invoices={data.invoices}
        receipts={data.receipts}
        allocations={data.allocations}
        historicalNoFinancialRecords={data.historicalNoFinancialRecords}
        joinedSupport={data.joinedSupport}
        permissionProfile={permissionProfile}
        status={status}
        error={error}
        actionError={actionError}
        onDismissActionError={() => setActionError(null)}
        reconcilingReceiptId={reconcilingReceiptId}
        onRetry={invalidateAll}
        onRefresh={invalidateAll}
        onOpenScheduleDrawer={(contractId) => {
          if (isHistoricalReadOnly) return;
          setScheduleDefaultContractId(contractId ?? null);
          setScheduleDrawerOpen(true);
        }}
        onOpenInvoiceDrawer={(contractId) => {
          if (isHistoricalReadOnly) return;
          setInvoiceDefaultContractId(contractId ?? null);
          setInvoiceDrawerOpen(true);
        }}
        onOpenReceiptDrawer={(sponsorId) => {
          if (isHistoricalReadOnly) return;
          setReceiptDefaultSponsorId(sponsorId ?? null);
          setReceiptDrawerOpen(true);
        }}
        onOpenAllocateDrawer={(receipt) => {
          if (isHistoricalReadOnly) return;
          setAllocateDrawerReceipt(receipt);
        }}
        onReconcileReceipt={(receiptId) => {
          void handleReconcileReceipt(receiptId);
        }}
        onCancelInvoice={handleCancelInvoice}
        onOpenPaymentTermsDrawer={(contract) => {
          if (isHistoricalReadOnly) return;
          setTermsDrawerContract(contract);
        }}
        onOpenSponsor={onOpenSponsor}
        onOpenOpportunity={onOpenOpportunity}
        showDevControls={showDevControls}
        previewMode={previewMode}
        onChangePreviewMode={setPreviewMode}
      />

      <PaymentScheduleFormDrawer
        open={scheduleDrawerOpen}
        contracts={data.contracts}
        activeRecordClass={writableRecordClass}
        permissionProfile={permissionProfile}
        defaultContractId={scheduleDefaultContractId}
        onClose={() => {
          setScheduleDrawerOpen(false);
          setScheduleDefaultContractId(null);
        }}
        onCreated={() => {
          setScheduleDrawerOpen(false);
          setScheduleDefaultContractId(null);
          invalidateAll();
        }}
      />

      <InvoiceFormDrawer
        open={invoiceDrawerOpen}
        contracts={data.contracts}
        paymentSchedules={data.paymentSchedules}
        activeRecordClass={writableRecordClass}
        permissionProfile={permissionProfile}
        defaultContractId={invoiceDefaultContractId}
        onClose={() => {
          setInvoiceDrawerOpen(false);
          setInvoiceDefaultContractId(null);
        }}
        onCreated={() => {
          setInvoiceDrawerOpen(false);
          setInvoiceDefaultContractId(null);
          invalidateAll();
        }}
      />

      <ReceiptFormDrawer
        open={receiptDrawerOpen}
        sponsors={data.sponsors}
        contracts={data.contracts}
        activeRecordClass={writableRecordClass}
        permissionProfile={permissionProfile}
        defaultSponsorId={receiptDefaultSponsorId}
        onClose={() => {
          setReceiptDrawerOpen(false);
          setReceiptDefaultSponsorId(null);
        }}
        onCreated={() => {
          setReceiptDrawerOpen(false);
          setReceiptDefaultSponsorId(null);
          invalidateAll();
        }}
      />

      <PaymentTermsDrawer
        open={Boolean(termsDrawerContract)}
        contract={termsDrawerContract}
        permissionProfile={permissionProfile}
        onClose={() => setTermsDrawerContract(null)}
        onUpdated={() => {
          setTermsDrawerContract(null);
          invalidateAll();
        }}
      />

      <AllocateReceiptDrawer
        open={Boolean(allocateDrawerReceipt)}
        receipt={allocateDrawerReceipt}
        contracts={data.contracts}
        paymentSchedules={data.paymentSchedules}
        invoices={data.invoices}
        existingAllocations={data.allocations}
        activeEditionId={filters.edition_id}
        activeRecordClass={writableRecordClass}
        permissionProfile={permissionProfile}
        onClose={() => setAllocateDrawerReceipt(null)}
        onAllocated={() => {
          setAllocateDrawerReceipt(null);
          invalidateAll();
        }}
      />
    </>
  );
}
