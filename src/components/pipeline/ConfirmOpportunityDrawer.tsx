import { AlertCircle, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { formatCurrencyInr } from '../../services/campaignsApi';
import {
  PipelineApiError,
  confirmOpportunity,
  fetchInventoryAssets,
  isOpportunityReadOnly,
} from '../../services/pipelineApi';
import { fetchSponsorContacts } from '../../services/sponsorsApi';
import type {
  ConfirmOpportunityLinePayload,
  InventoryAssetOption,
  OpportunityEntity,
  PaymentTermsCode,
} from '../../types/pipeline';
import type { ContactEntity } from '../../types/sponsors';
import { SlideOverDrawer } from '../ui/SlideOverDrawer';

interface ConfirmOpportunityDrawerProps {
  open: boolean;
  opportunity: OpportunityEntity | null;
  onClose: () => void;
  onConfirmed: () => void;
}

interface LineDraft {
  considerationType: 'cash' | 'in_kind';
  value: string;
  assetId: string;
}

export function ConfirmOpportunityDrawer({
  open,
  opportunity,
  onClose,
  onConfirmed,
}: ConfirmOpportunityDrawerProps) {
  const readOnly = opportunity ? isOpportunityReadOnly(opportunity) : false;

  const [signedAt, setSignedAt] = useState('');
  const [paymentTerms, setPaymentTerms] =
    useState<PaymentTermsCode>('standard_50_50');
  const [signatoryContactId, setSignatoryContactId] = useState('');
  const [signedValueTotal, setSignedValueTotal] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([
    { considerationType: 'cash', value: '', assetId: '' },
  ]);

  const [contacts, setContacts] = useState<ContactEntity[]>([]);
  const [assets, setAssets] = useState<InventoryAssetOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !opportunity) return;
    setFormError(null);
    const today = new Date().toISOString().slice(0, 10);
    setSignedAt(today);
    setPaymentTerms('standard_50_50');
    setSignatoryContactId(opportunity.primary_contact_id ?? '');
    const initialVal =
      opportunity.current_stage_version?.proposed_value != null &&
      opportunity.current_stage_version.proposed_value > 0
        ? String(opportunity.current_stage_version.proposed_value)
        : '';
    setSignedValueTotal(initialVal);
    setLines([
      {
        considerationType:
          opportunity.support_type === 'in_kind' ? 'in_kind' : 'cash',
        value: initialVal,
        assetId: '',
      },
    ]);

    const controller = new AbortController();
    fetchSponsorContacts(
      opportunity.sponsor_id,
      opportunity.record_class,
      controller.signal
    )
      .then((list) => setContacts(list))
      .catch(() => setContacts([]));
    fetchInventoryAssets(opportunity.edition_id, controller.signal)
      .then((list) => setAssets(list))
      .catch(() => setAssets([]));

    return () => controller.abort();
  }, [open, opportunity]);

  if (!opportunity) return null;

  const lineSum = lines.reduce((sum, line) => {
    const v = Number(line.value);
    return Number.isFinite(v) && v > 0 ? sum + v : sum;
  }, 0);

  const parsedTotal = Number(signedValueTotal);
  const totalMatchesLines =
    Number.isFinite(parsedTotal) &&
    parsedTotal > 0 &&
    Math.abs(parsedTotal - lineSum) <= 0.01;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || submitting) return;

    if (!signedAt.trim()) {
      setFormError('Signed date is required.');
      return;
    }

    const parsedLines: ConfirmOpportunityLinePayload[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const val = Number(l.value);
      if (!Number.isFinite(val) || val <= 0) {
        setFormError(`Line ${i + 1} value must be a positive number.`);
        return;
      }
      parsedLines.push({
        considerationType: l.considerationType,
        value: val,
        assetId: l.assetId.trim() || null,
      });
    }

    if (parsedLines.length === 0) {
      setFormError('At least one contract line is required.');
      return;
    }

    if (!Number.isFinite(parsedTotal) || parsedTotal <= 0) {
      setFormError('Signed value total must be greater than zero.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await confirmOpportunity(
        opportunity.opportunity_id,
        {
          signedAt: new Date(`${signedAt}T10:00:00+05:30`).toISOString(),
          paymentTerms,
          signatoryContactId: signatoryContactId.trim() || null,
          lines: parsedLines,
          signedValueTotal: parsedTotal,
        },
        opportunity
      );
      onConfirmed();
    } catch (err) {
      setFormError(
        err instanceof PipelineApiError
          ? err.message
          : 'Unable to confirm partnership and create contract.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlideOverDrawer
      open={open}
      onClose={onClose}
      meta="Confirm deal & sign contract"
      title={
        opportunity.name ||
        opportunity.sponsor_name ||
        opportunity.opportunity_id
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded border border-[#E8E6E0] bg-[#FAF9F6] px-3.5 py-2.5 text-[12px] text-[#525E58]">
          Creates the active contract, contract lines, and{' '}
          <span className="font-mono text-[#315F52]">partner_confirmed</span>{' '}
          stage version in a single transaction. Contract line values must equal
          signed total.
        </div>

        {formError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded border border-[#9B3B32]/30 bg-[#9B3B32]/5 px-3.5 py-2.5 text-[12px] text-[#9B3B32]"
          >
            <AlertCircle
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>{formError}</span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="confirm-signed-at"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Signed date
            </label>
            <input
              id="confirm-signed-at"
              type="date"
              required
              disabled={readOnly || submitting}
              value={signedAt}
              onChange={(e) => setSignedAt(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="confirm-payment-terms"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Payment terms
            </label>
            <select
              id="confirm-payment-terms"
              disabled={readOnly || submitting}
              value={paymentTerms}
              onChange={(e) =>
                setPaymentTerms(e.target.value as PaymentTermsCode)
              }
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
            >
              <option value="standard_50_50">Standard 50 / 50</option>
              <option value="100_upfront">100% upfront</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="confirm-signatory"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Signatory contact
            </label>
            <select
              id="confirm-signatory"
              disabled={readOnly || submitting}
              value={signatoryContactId}
              onChange={(e) => setSignatoryContactId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none"
            >
              <option value="">None / optional</option>
              {contacts.map((c) => (
                <option key={c.contact_id} value={c.contact_id}>
                  {c.full_name}
                  {c.job_title ? ` (${c.job_title})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="confirm-signed-total"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Signed value total (₹)
            </label>
            <input
              id="confirm-signed-total"
              type="number"
              min={1}
              step="1"
              required
              disabled={readOnly || submitting}
              value={signedValueTotal}
              onChange={(e) => setSignedValueTotal(e.target.value)}
              placeholder="e.g. 110000"
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] tabular-nums focus:border-[#315F52] focus:outline-none"
            />
          </div>
        </div>

        <div className="border-t border-[#E8E6E0] pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-[#202824]">
              Contract lines
            </span>
            <button
              type="button"
              disabled={readOnly || submitting}
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  { considerationType: 'cash', value: '', assetId: '' },
                ])
              }
              className="inline-flex h-7 items-center gap-1 rounded border border-[#D9D7D0] bg-white px-2.5 text-[12px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
            >
              <Plus className="h-3.5 w-3.5 text-[#315F52]" aria-hidden="true" />
              Add line
            </button>
          </div>

          <div className="space-y-2.5">
            {lines.map((line, index) => (
              <div
                key={index}
                className="grid grid-cols-1 gap-2 rounded border border-[#E8E6E0] bg-[#FAF9F6] p-3 sm:grid-cols-12 sm:items-end"
              >
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-medium text-[#525E58]">
                    Type
                  </label>
                  <select
                    disabled={readOnly || submitting}
                    value={line.considerationType}
                    onChange={(e) => {
                      const nextVal = e.target.value as 'cash' | 'in_kind';
                      setLines((prev) =>
                        prev.map((item, idx) =>
                          idx === index
                            ? { ...item, considerationType: nextVal }
                            : item
                        )
                      );
                    }}
                    className="mt-1 h-8 w-full rounded border border-[#D9D7D0] bg-white px-2 text-[12px] text-[#202824]"
                  >
                    <option value="cash">Cash</option>
                    <option value="in_kind">In-kind</option>
                  </select>
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-medium text-[#525E58]">
                    Value (₹)
                  </label>
                  <input
                    type="number"
                    min={1}
                    step="1"
                    required
                    disabled={readOnly || submitting}
                    value={line.value}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLines((prev) =>
                        prev.map((item, idx) =>
                          idx === index ? { ...item, value: v } : item
                        )
                      );
                    }}
                    className="mt-1 h-8 w-full rounded border border-[#D9D7D0] bg-white px-2 font-mono text-[12px] text-[#202824] tabular-nums"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-medium text-[#525E58]">
                    Asset (optional)
                  </label>
                  <select
                    disabled={readOnly || submitting}
                    value={line.assetId}
                    onChange={(e) => {
                      const aid = e.target.value;
                      setLines((prev) =>
                        prev.map((item, idx) =>
                          idx === index ? { ...item, assetId: aid } : item
                        )
                      );
                    }}
                    className="mt-1 h-8 w-full rounded border border-[#D9D7D0] bg-white px-2 text-[12px] text-[#202824]"
                  >
                    <option value="">General sponsorship</option>
                    {assets.map((a) => (
                      <option key={a.asset_id} value={a.asset_id}>
                        {a.asset_type} ({a.asset_id})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-1 flex justify-end">
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`Remove line ${index + 1}`}
                      onClick={() =>
                        setLines((prev) =>
                          prev.filter((_, idx) => idx !== index)
                        )
                      }
                      className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#D9D7D0] bg-white text-[#9B3B32] hover:bg-[#FAF9F6]"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between rounded border border-[#E8E6E0] bg-white px-3 py-2 text-[12px]">
            <span className="text-[#525E58]">
              Sum of lines:{' '}
              <span className="font-mono font-semibold text-[#202824] tabular-nums">
                {formatCurrencyInr(lineSum)}
              </span>
            </span>
            <span
              className={`font-mono text-[11px] ${
                totalMatchesLines ? 'text-[#315F52]' : 'text-[#9B3B32]'
              }`}
            >
              {totalMatchesLines
                ? 'Matches signed total'
                : 'Must equal signed total'}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#E8E6E0] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3.5 text-[13px] font-medium text-[#202824] hover:bg-[#FAF9F6]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={readOnly || submitting}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#315F52] px-4 text-[13px] font-medium text-white hover:bg-[#264B40] disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {submitting ? 'Confirming...' : 'Confirm deal & sign'}
          </button>
        </div>
      </form>
    </SlideOverDrawer>
  );
}
