import { AlertCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  CollectionsApiError,
  createInvoice,
  formatCollectionsCurrency,
  formatScheduleKind,
} from '../../services/collectionsApi';
import type {
  CollectionsContractRow,
  CollectionsPermissionProfile,
  InvoiceRecord,
  PaymentScheduleItemRecord,
} from '../../types/collections';
import { SlideOverDrawer } from '../ui/SlideOverDrawer';

interface InvoiceFormDrawerProps {
  open: boolean;
  contracts: CollectionsContractRow[];
  paymentSchedules: PaymentScheduleItemRecord[];
  activeRecordClass: 'simulated' | 'live';
  permissionProfile: CollectionsPermissionProfile;
  defaultContractId?: string | null;
  onClose: () => void;
  onCreated: (invoice: InvoiceRecord) => void;
}

export function InvoiceFormDrawer({
  open,
  contracts,
  paymentSchedules,
  activeRecordClass,
  permissionProfile,
  defaultContractId = null,
  onClose,
  onCreated,
}: InvoiceFormDrawerProps) {
  const activeContracts = contracts.filter((c) => c.status !== 'terminated');

  const [contractId, setContractId] = useState('');
  const [scheduleItemId, setScheduleItemId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [amount, setAmount] = useState('');
  const [taxAmount, setTaxAmount] = useState('');
  const [documentUri, setDocumentUri] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const initialContract =
      activeContracts.find((c) => c.contract_id === defaultContractId) ??
      activeContracts[0];
    setContractId(initialContract?.contract_id ?? '');
    setScheduleItemId('');
    setInvoiceNo('');
    setIssuedAt(
      initialContract?.signed_at
        ? initialContract.signed_at.slice(0, 10)
        : new Date().toISOString().slice(0, 10)
    );
    setAmount('');
    setTaxAmount('');
    setDocumentUri('');
    setErrorMsg(null);
    setSubmitting(false);
  }, [open, defaultContractId]);

  const contractSchedules = paymentSchedules.filter(
    (s) => s.contract_id === contractId
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!contractId) {
      setErrorMsg('Contract selection is required.');
      return;
    }
    if (!invoiceNo.trim()) {
      setErrorMsg('Sequential invoice number is required.');
      return;
    }
    if (!issuedAt) {
      setErrorMsg('Issue date is required.');
      return;
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setErrorMsg('Invoice amount must be greater than zero.');
      return;
    }
    const numericTax =
      taxAmount.trim() !== '' ? Number(taxAmount) : null;
    if (numericTax !== null && (!Number.isFinite(numericTax) || numericTax < 0)) {
      setErrorMsg('Tax amount must be zero or positive.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createInvoice(
        {
          contract_id: contractId,
          schedule_item_id: scheduleItemId.trim() || null,
          invoice_no: invoiceNo.trim(),
          issued_at: issuedAt,
          amount: numericAmount,
          tax_amount: numericTax,
          document_uri: documentUri.trim() || null,
          record_class: activeRecordClass,
        },
        permissionProfile
      );
      onCreated(created);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof CollectionsApiError
          ? err.message
          : 'Unable to issue invoice.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlideOverDrawer
      open={open}
      onClose={onClose}
      meta={`Finance · ${activeRecordClass}`}
      title="Record invoice"
      subtitle="Issued invoices are immutable records and do not count as cash collected until matched to a reconciled receipt."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {!permissionProfile.verifiedByServer ? (
          <div className="rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-3.5 py-2.5 text-[12px] text-[#525E58]">
            Unverified session preview: Finance &amp; Collections role is
            required on the server to issue invoices.
          </div>
        ) : null}

        {errorMsg ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-[#9B3B32]/30 bg-[#9B3B32]/5 px-3.5 py-2.5 text-[12px] text-[#9B3B32]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        ) : null}

        <div>
          <label
            htmlFor="invoice-contract"
            className="block text-[12px] font-medium text-[#202824]"
          >
            Contract
          </label>
          <select
            id="invoice-contract"
            value={contractId}
            onChange={(e) => {
              const nextId = e.target.value;
              setContractId(nextId);
              setScheduleItemId('');
              const nextContract = activeContracts.find(
                (c) => c.contract_id === nextId
              );
              if (nextContract?.signed_at) {
                setIssuedAt(nextContract.signed_at.slice(0, 10));
              }
            }}
            className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
            required
          >
            {activeContracts.length === 0 ? (
              <option value="">No active contracts available</option>
            ) : (
              activeContracts.map((c) => (
                <option key={c.contract_id} value={c.contract_id}>
                  {c.contract_id} · {c.sponsor_name || c.opportunity_name || c.opportunity_id} (
                  {formatCollectionsCurrency(c.signed_value_total)})
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <label
            htmlFor="invoice-schedule-item"
            className="block text-[12px] font-medium text-[#202824]"
          >
            Payment schedule item (optional)
          </label>
          {contractSchedules.length > 0 ? (
            <select
              id="invoice-schedule-item"
              value={scheduleItemId}
              onChange={(e) => {
                const sid = e.target.value;
                setScheduleItemId(sid);
                const item = contractSchedules.find(
                  (s) => s.schedule_item_id === sid
                );
                if (item && !amount) {
                  setAmount(String(item.amount_due));
                }
              }}
              className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
            >
              <option value="">Unlinked / select schedule item</option>
              {contractSchedules.map((item) => (
                <option
                  key={item.schedule_item_id}
                  value={item.schedule_item_id}
                >
                  {item.schedule_item_id} · {formatScheduleKind(item.kind)} (
                  {formatCollectionsCurrency(item.amount_due)} due{' '}
                  {item.due_date.slice(0, 10)})
                </option>
              ))}
            </select>
          ) : (
            <input
              id="invoice-schedule-item"
              type="text"
              value={scheduleItemId}
              onChange={(e) => setScheduleItemId(e.target.value)}
              placeholder="Optional schedule item ID"
              className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
            />
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="invoice-no"
              className="block text-[12px] font-medium text-[#202824]"
            >
              Invoice number
            </label>
            <input
              id="invoice-no"
              type="text"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              placeholder="e.g. INV-2026-001"
              className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
              required
            />
          </div>

          <div>
            <label
              htmlFor="invoice-issued-at"
              className="block text-[12px] font-medium text-[#202824]"
            >
              Issued date
            </label>
            <input
              id="invoice-issued-at"
              type="date"
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
              className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="invoice-amount"
              className="block text-[12px] font-medium text-[#202824]"
            >
              Invoice amount (INR)
            </label>
            <input
              id="invoice-amount"
              type="number"
              min="1"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 125000"
              className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
              required
            />
          </div>

          <div>
            <label
              htmlFor="invoice-tax"
              className="block text-[12px] font-medium text-[#202824]"
            >
              GST / Tax amount (optional)
            </label>
            <input
              id="invoice-tax"
              type="number"
              min="0"
              step="any"
              value={taxAmount}
              onChange={(e) => setTaxAmount(e.target.value)}
              placeholder="e.g. 22500"
              className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="invoice-doc-uri"
            className="block text-[12px] font-medium text-[#202824]"
          >
            Document link (optional)
          </label>
          <input
            id="invoice-doc-uri"
            type="url"
            value={documentUri}
            onChange={(e) => setDocumentUri(e.target.value)}
            placeholder="https://..."
            className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
          />
        </div>

        <p className="rounded-md border border-[#E8E6E0] bg-[#FAF9F6] px-3 py-2 text-[12px] text-[#525E58]">
          Once issued, invoices are locked and cannot be edited or cancelled in
          this workspace.
        </p>

        <div className="flex items-center justify-end gap-2.5 border-t border-[#E8E6E0] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-[#D9D7D0] bg-white px-4 text-[13px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || activeContracts.length === 0}
            className="h-9 rounded-md bg-[#315F52] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#274D42] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Issuing...' : 'Issue invoice'}
          </button>
        </div>
      </form>
    </SlideOverDrawer>
  );
}
