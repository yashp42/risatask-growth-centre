import { AlertCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  allocateReceipt,
  CollectionsApiError,
  formatCollectionsCurrency,
  formatScheduleKind,
} from '../../services/collectionsApi';
import type {
  CollectionsContractRow,
  CollectionsPermissionProfile,
  InvoiceRecord,
  PaymentScheduleItemRecord,
  ReceiptAllocationRecord,
  ReceiptRecord,
} from '../../types/collections';
import { SlideOverDrawer } from '../ui/SlideOverDrawer';

interface AllocateReceiptDrawerProps {
  open: boolean;
  receipt: ReceiptRecord | null;
  contracts: CollectionsContractRow[];
  paymentSchedules: PaymentScheduleItemRecord[];
  invoices: InvoiceRecord[];
  existingAllocations: ReceiptAllocationRecord[];
  activeEditionId: string;
  activeRecordClass: 'simulated' | 'live';
  permissionProfile: CollectionsPermissionProfile;
  onClose: () => void;
  onAllocated: (allocation: ReceiptAllocationRecord) => void;
}

export function AllocateReceiptDrawer({
  open,
  receipt,
  contracts,
  paymentSchedules,
  invoices,
  existingAllocations,
  activeEditionId,
  activeRecordClass,
  permissionProfile,
  onClose,
  onAllocated,
}: AllocateReceiptDrawerProps) {
  const [scheduleItemId, setScheduleItemId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const sponsorContractIds = useMemo(() => {
    if (!receipt) return new Set<string>();
    return new Set(
      contracts
        .filter((c) => c.sponsor_id === receipt.sponsor_id)
        .map((c) => c.contract_id)
    );
  }, [contracts, receipt]);

  const sponsorSchedules = useMemo(
    () =>
      paymentSchedules.filter(
        (s) =>
          (receipt?.sponsor_id && s.sponsor_id === receipt.sponsor_id) ||
          sponsorContractIds.has(s.contract_id)
      ),
    [paymentSchedules, receipt, sponsorContractIds]
  );

  const sponsorInvoices = useMemo(
    () =>
      invoices.filter(
        (inv) =>
          inv.status === 'issued' &&
          ((receipt?.sponsor_id && inv.sponsor_id === receipt.sponsor_id) ||
            sponsorContractIds.has(inv.contract_id))
      ),
    [invoices, receipt, sponsorContractIds]
  );

  const allocatedSoFar = useMemo(() => {
    if (!receipt) return 0;
    if (
      typeof receipt.allocated_amount === 'number' &&
      Number.isFinite(receipt.allocated_amount)
    ) {
      return receipt.allocated_amount;
    }
    return existingAllocations
      .filter((a) => a.receipt_id === receipt.receipt_id)
      .reduce((acc, a) => acc + Number(a.amount || 0), 0);
  }, [receipt, existingAllocations]);

  const remainingReceiptAmount = useMemo(() => {
    if (!receipt) return 0;
    if (
      typeof receipt.unallocated_amount === 'number' &&
      Number.isFinite(receipt.unallocated_amount)
    ) {
      return Math.max(0, receipt.unallocated_amount);
    }
    return Math.max(0, Number(receipt.amount) - allocatedSoFar);
  }, [receipt, allocatedSoFar]);

  useEffect(() => {
    if (!open || !receipt) return;
    const defaultSched =
      sponsorSchedules.find((s) => (s.remaining_amount ?? s.amount_due) > 0) ??
      sponsorSchedules[0];
    const defaultInv = sponsorInvoices[0];
    setScheduleItemId(defaultSched?.schedule_item_id ?? '');
    setInvoiceId(defaultInv?.invoice_id ?? '');
    const suggested =
      remainingReceiptAmount > 0
        ? remainingReceiptAmount
        : Number(receipt.amount || 0);
    setAmount(suggested > 0 ? String(suggested) : '');
    setErrorMsg(null);
    setSubmitting(false);
  }, [open, receipt?.receipt_id]);

  if (!receipt) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!scheduleItemId.trim() && !invoiceId.trim()) {
      setErrorMsg(
        'Select at least one payment schedule item or issued invoice.'
      );
      return;
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setErrorMsg('Allocation amount must be greater than zero.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await allocateReceipt(
        {
          receipt_id: receipt.receipt_id,
          schedule_item_id: scheduleItemId.trim() || null,
          invoice_id: invoiceId.trim() || null,
          amount: numericAmount,
          record_class: activeRecordClass,
          edition_id: activeEditionId,
        },
        permissionProfile
      );
      onAllocated(created);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof CollectionsApiError
          ? err.message
          : 'Unable to allocate receipt.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlideOverDrawer
      open={open}
      onClose={onClose}
      meta={`Receipt · ${receipt.receipt_id}`}
      title="Allocate receipt"
      subtitle="Link this receipt to an issued invoice or payment schedule item for the same sponsor. Reconciling and allocating together updates collected cash."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-[#9B3B32]/30 bg-[#9B3B32]/5 px-3.5 py-2.5 text-[12px] text-[#9B3B32]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        ) : null}

        <div className="rounded-md border border-[#D9D7D0] bg-[#FAF9F6] p-3.5 text-[12px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#525E58]">Sponsor</span>
            <span className="font-medium text-[#202824]">
              {receipt.sponsor_name || receipt.sponsor_id}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[#525E58]">Receipt amount</span>
            <span className="font-mono font-medium text-[#202824] tabular-nums">
              {formatCollectionsCurrency(receipt.amount)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[#525E58]">Remaining unallocated</span>
            <span className="font-mono font-medium text-[#315F52] tabular-nums">
              {formatCollectionsCurrency(remainingReceiptAmount)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[#525E58]">Reconciliation state</span>
            <span className="font-medium text-[#202824]">
              {receipt.reconciled
                ? 'Reconciled'
                : 'Unreconciled (reconcile to count in M-01)'}
            </span>
          </div>
        </div>

        <div>
          <label
            htmlFor="alloc-schedule"
            className="block text-[12px] font-medium text-[#202824]"
          >
            Payment schedule item
          </label>
          <select
            id="alloc-schedule"
            value={scheduleItemId}
            onChange={(e) => setScheduleItemId(e.target.value)}
            className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
          >
            <option value="">— None —</option>
            {sponsorSchedules.map((s) => (
              <option key={s.schedule_item_id} value={s.schedule_item_id}>
                {formatScheduleKind(s.kind)} · {formatCollectionsCurrency(s.amount_due)} (due {s.due_date.slice(0, 10)}) · {s.schedule_item_id}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="alloc-invoice"
            className="block text-[12px] font-medium text-[#202824]"
          >
            Issued invoice (optional if schedule selected)
          </label>
          <select
            id="alloc-invoice"
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
            className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
          >
            <option value="">— None —</option>
            {sponsorInvoices.map((inv) => (
              <option key={inv.invoice_id} value={inv.invoice_id}>
                {inv.invoice_no} · {formatCollectionsCurrency(inv.amount)} · {inv.contract_id}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="alloc-amount"
            className="block text-[12px] font-medium text-[#202824]"
          >
            Allocation amount (INR)
          </label>
          <input
            id="alloc-amount"
            type="number"
            min="1"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
            required
          />
        </div>

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
            disabled={submitting}
            className="h-9 rounded-md bg-[#315F52] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#274D42] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Allocating...' : 'Save allocation'}
          </button>
        </div>
      </form>
    </SlideOverDrawer>
  );
}
