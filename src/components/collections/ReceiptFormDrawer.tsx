import { AlertCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CollectionsApiError,
  createReceipt,
  formatReceiptMethod,
} from '../../services/collectionsApi';
import {
  ALL_RECEIPT_METHODS,
  type CollectionsContractRow,
  type CollectionsPermissionProfile,
  type ReceiptMethod,
  type ReceiptRecord,
} from '../../types/collections';
import type { SponsorEntity } from '../../types/sponsors';
import { SlideOverDrawer } from '../ui/SlideOverDrawer';

interface ReceiptFormDrawerProps {
  open: boolean;
  sponsors: SponsorEntity[];
  contracts: CollectionsContractRow[];
  activeRecordClass: 'simulated' | 'live';
  permissionProfile: CollectionsPermissionProfile;
  defaultSponsorId?: string | null;
  onClose: () => void;
  onCreated: (receipt: ReceiptRecord) => void;
}

export function ReceiptFormDrawer({
  open,
  sponsors,
  contracts,
  activeRecordClass,
  permissionProfile,
  defaultSponsorId = null,
  onClose,
  onCreated,
}: ReceiptFormDrawerProps) {
  const sponsorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sponsors) {
      map.set(s.sponsor_id, s.display_name);
    }
    for (const c of contracts) {
      if (c.sponsor_id && !map.has(c.sponsor_id)) {
        map.set(c.sponsor_id, c.sponsor_name || c.sponsor_id);
      }
    }
    return Array.from(map.entries())
      .map(([sponsor_id, display_name]) => ({ sponsor_id, display_name }))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [sponsors, contracts]);

  const [sponsorId, setSponsorId] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<ReceiptMethod>('bank_transfer');
  const [bankReference, setBankReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const initialSponsor =
      sponsorOptions.find((s) => s.sponsor_id === defaultSponsorId) ??
      sponsorOptions[0];
    setSponsorId(initialSponsor?.sponsor_id ?? '');
    setReceivedAt(new Date().toISOString().slice(0, 10));
    setAmount('');
    setMethod('bank_transfer');
    setBankReference('');
    setErrorMsg(null);
    setSubmitting(false);
  }, [open, defaultSponsorId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!sponsorId.trim()) {
      setErrorMsg('Sponsor is required.');
      return;
    }
    if (!receivedAt) {
      setErrorMsg('Receipt date is required.');
      return;
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setErrorMsg('Receipt amount must be greater than zero.');
      return;
    }
    if (!bankReference.trim()) {
      setErrorMsg('Unique bank reference is required.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createReceipt(
        {
          sponsor_id: sponsorId.trim(),
          received_at: receivedAt,
          amount: numericAmount,
          method,
          bank_reference: bankReference.trim(),
          reconciled: false,
          record_class: activeRecordClass,
        },
        permissionProfile
      );
      onCreated(created);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof CollectionsApiError
          ? err.message
          : 'Unable to record receipt.'
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
      title="Record receipt"
      subtitle="Receipts are immutable once logged. Only reconciled and allocated cash counts toward collected totals."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {!permissionProfile.verifiedByServer ? (
          <div className="rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-3.5 py-2.5 text-[12px] text-[#525E58]">
            Unverified session preview: Finance &amp; Collections role is
            required on the server to log receipts.
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
            htmlFor="receipt-sponsor"
            className="block text-[12px] font-medium text-[#202824]"
          >
            Sponsor
          </label>
          {sponsorOptions.length > 0 ? (
            <select
              id="receipt-sponsor"
              value={sponsorId}
              onChange={(e) => setSponsorId(e.target.value)}
              className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
              required
            >
              {sponsorOptions.map((s) => (
                <option key={s.sponsor_id} value={s.sponsor_id}>
                  {s.display_name} ({s.sponsor_id})
                </option>
              ))}
            </select>
          ) : (
            <input
              id="receipt-sponsor"
              type="text"
              value={sponsorId}
              onChange={(e) => setSponsorId(e.target.value)}
              placeholder="Enter sponsor_id"
              className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
              required
            />
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="receipt-date"
              className="block text-[12px] font-medium text-[#202824]"
            >
              Received date
            </label>
            <input
              id="receipt-date"
              type="date"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
              required
            />
          </div>

          <div>
            <label
              htmlFor="receipt-method"
              className="block text-[12px] font-medium text-[#202824]"
            >
              Payment method
            </label>
            <select
              id="receipt-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as ReceiptMethod)}
              className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
            >
              {ALL_RECEIPT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {formatReceiptMethod(m)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="receipt-amount"
              className="block text-[12px] font-medium text-[#202824]"
            >
              Amount received (INR)
            </label>
            <input
              id="receipt-amount"
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
              htmlFor="receipt-bank-ref"
              className="block text-[12px] font-medium text-[#202824]"
            >
              Bank reference (unique)
            </label>
            <input
              id="receipt-bank-ref"
              type="text"
              value={bankReference}
              onChange={(e) => setBankReference(e.target.value)}
              placeholder="e.g. UTR402918374"
              className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
              required
            />
          </div>
        </div>

        <div className="rounded-md border border-[#D9D7D0] bg-[#FAF9F6] p-3 text-[12px] text-[#202824]">
          <span className="font-medium">
            Step 1 of 2 — Logged as unreconciled
          </span>
          <span className="mt-0.5 block text-[#525E58]">
            New receipts always start unreconciled (received, not yet counted
            toward collected cash). After saving, allocate the receipt to an
            invoice or schedule item and mark it reconciled on the Receipts tab.
          </span>
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
            {submitting ? 'Recording...' : 'Save receipt'}
          </button>
        </div>
      </form>
    </SlideOverDrawer>
  );
}
