import { AlertCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  CollectionsApiError,
  createPaymentScheduleItem,
  formatCollectionsCurrency,
  formatScheduleKind,
} from '../../services/collectionsApi';
import {
  ALL_PAYMENT_SCHEDULE_KINDS,
  type CollectionsContractRow,
  type CollectionsPermissionProfile,
  type PaymentScheduleItemRecord,
  type PaymentScheduleKind,
} from '../../types/collections';
import { SlideOverDrawer } from '../ui/SlideOverDrawer';

interface PaymentScheduleFormDrawerProps {
  open: boolean;
  contracts: CollectionsContractRow[];
  activeRecordClass: 'simulated' | 'live';
  permissionProfile: CollectionsPermissionProfile;
  defaultContractId?: string | null;
  onClose: () => void;
  onCreated: (item: PaymentScheduleItemRecord) => void;
}

function addDaysIso(dateStr: string, days: number): string {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function PaymentScheduleFormDrawer({
  open,
  contracts,
  activeRecordClass,
  permissionProfile,
  defaultContractId = null,
  onClose,
  onCreated,
}: PaymentScheduleFormDrawerProps) {
  const cashEligibleContracts = contracts.filter((c) => {
    if (c.status === 'terminated') return false;
    if (!c.lines || c.lines.length === 0) return true;
    return c.lines.some((line) => line.consideration_type === 'cash');
  });

  const [contractId, setContractId] = useState('');
  const [kind, setKind] = useState<PaymentScheduleKind>('advance');
  const [amountDue, setAmountDue] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const initialContract =
      cashEligibleContracts.find((c) => c.contract_id === defaultContractId) ??
      cashEligibleContracts[0];
    setContractId(initialContract?.contract_id ?? '');
    setKind('advance');
    setAmountDue('');
    setDueDate(
      initialContract?.signed_at
        ? addDaysIso(initialContract.signed_at, 7)
        : ''
    );
    setErrorMsg(null);
    setSubmitting(false);
  }, [open, defaultContractId]);

  const selectedContract = cashEligibleContracts.find(
    (c) => c.contract_id === contractId
  );

  const handleKindChange = (nextKind: PaymentScheduleKind) => {
    setKind(nextKind);
    if (nextKind === 'advance' && selectedContract?.signed_at && !dueDate) {
      setDueDate(addDaysIso(selectedContract.signed_at, 7));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!contractId) {
      setErrorMsg('Select a cash contract first.');
      return;
    }
    const numericAmount = Number(amountDue);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setErrorMsg('Enter an amount due greater than zero.');
      return;
    }
    if (!dueDate) {
      setErrorMsg('Due date is required.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createPaymentScheduleItem(
        {
          contract_id: contractId,
          kind,
          amount_due: numericAmount,
          due_date: dueDate,
          record_class: activeRecordClass,
        },
        permissionProfile
      );
      onCreated(created);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof CollectionsApiError
          ? err.message
          : 'Unable to record payment schedule item.'
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
      title="Record payment schedule item"
      subtitle="Cash commitments only. Schedule status is derived by the server from receipt allocations."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {!permissionProfile.verifiedByServer ? (
          <div className="rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-3.5 py-2.5 text-[12px] text-[#525E58]">
            Unverified session preview: Finance &amp; Collections role is
            required on the server to save schedule items.
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
            htmlFor="schedule-contract"
            className="block text-[12px] font-medium text-[#202824]"
          >
            Contract (cash lines)
          </label>
          <select
            id="schedule-contract"
            value={contractId}
            onChange={(e) => {
              const nextId = e.target.value;
              setContractId(nextId);
              const nextContract = cashEligibleContracts.find(
                (c) => c.contract_id === nextId
              );
              if (kind === 'advance' && nextContract?.signed_at) {
                setDueDate(addDaysIso(nextContract.signed_at, 7));
              }
            }}
            className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
            required
          >
            {cashEligibleContracts.length === 0 ? (
              <option value="">No cash-eligible contracts available</option>
            ) : (
              cashEligibleContracts.map((c) => (
                <option key={c.contract_id} value={c.contract_id}>
                  {c.contract_id} · {c.sponsor_name || c.opportunity_name || c.opportunity_id} (
                  {formatCollectionsCurrency(c.signed_value_total)})
                </option>
              ))
            )}
          </select>
          <p className="mt-1 text-[11px] text-[#788C83]">
            Total schedule items must match the sum of cash contract lines.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="schedule-kind"
              className="block text-[12px] font-medium text-[#202824]"
            >
              Instalment kind
            </label>
            <select
              id="schedule-kind"
              value={kind}
              onChange={(e) =>
                handleKindChange(e.target.value as PaymentScheduleKind)
              }
              className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
            >
              {ALL_PAYMENT_SCHEDULE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {formatScheduleKind(k)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="schedule-due-date"
              className="block text-[12px] font-medium text-[#202824]"
            >
              Due date
            </label>
            <input
              id="schedule-due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1.5 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
              required
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="schedule-amount"
            className="block text-[12px] font-medium text-[#202824]"
          >
            Amount due (INR)
          </label>
          <input
            id="schedule-amount"
            type="number"
            min="1"
            step="any"
            value={amountDue}
            onChange={(e) => setAmountDue(e.target.value)}
            placeholder="e.g. 125000"
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
            disabled={submitting || cashEligibleContracts.length === 0}
            className="h-9 rounded-md bg-[#315F52] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#274D42] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Save schedule item'}
          </button>
        </div>
      </form>
    </SlideOverDrawer>
  );
}
