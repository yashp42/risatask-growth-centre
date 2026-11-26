import { AlertCircle } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  CONTACT_CONSENT_BASIS_SUGGESTIONS,
  CONTACT_DECISION_ROLE_OPTIONS,
  SponsorApiError,
  createContact,
  isContactReadOnly,
  updateContact,
} from '../../services/sponsorsApi';
import type {
  ContactDecisionRole,
  ContactEntity,
  ContactWritePayload,
  SponsorEntity,
  UserPermissionContext,
} from '../../types/sponsors';
import { InfoHint } from '../ui/InfoHint';
import { SlideOverDrawer } from '../ui/SlideOverDrawer';

interface ContactFormDrawerProps {
  open: boolean;
  sponsor: SponsorEntity;
  editingContact: ContactEntity | null;
  permissions: UserPermissionContext;
  onClose: () => void;
  onSaved: (contact: ContactEntity) => void;
}

export function ContactFormDrawer({
  open,
  sponsor,
  editingContact,
  permissions,
  onClose,
  onSaved,
}: ContactFormDrawerProps) {
  const isEditing = Boolean(editingContact);
  const readOnly = editingContact
    ? isContactReadOnly(editingContact, sponsor)
    : sponsor.record_class === 'historical_synthetic' ||
      sponsor.record_class === 'external_research';

  const consentListId = useId();

  const [fullName, setFullName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [decisionRole, setDecisionRole] =
    useState<ContactDecisionRole>('unknown');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [consentBasis, setConsentBasis] = useState('');
  const [sourceRef, setSourceRef] = useState('');
  const [optedOut, setOptedOut] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (editingContact) {
      setFullName(editingContact.full_name ?? '');
      setJobTitle(editingContact.job_title ?? '');
      setDecisionRole(editingContact.decision_role ?? 'unknown');
      setEmail(editingContact.email ?? '');
      setPhone(editingContact.phone ?? '');
      setConsentBasis(editingContact.consent_basis ?? '');
      setSourceRef(editingContact.source_ref ?? '');
      setOptedOut(Boolean(editingContact.opted_out_at));
    } else {
      setFullName('');
      setJobTitle('');
      setDecisionRole('unknown');
      setEmail('');
      setPhone('');
      setConsentBasis('');
      setSourceRef('');
      setOptedOut(false);
    }
  }, [open, editingContact]);

  const canAccessPii =
    permissions.verified_by_server &&
    permissions.can_view_contact_pii &&
    !editingContact?.pii_redacted;

  const piiRestrictionLabel = editingContact?.pii_redacted
    ? 'Redacted by server'
    : !permissions.verified_by_server
      ? 'Server verification required'
      : 'Restricted by role';

  const targetRecordClass: 'simulated' | 'live' =
    sponsor.record_class === 'live' ? 'live' : 'simulated';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || submitting) return;

    const trimmedName = fullName.trim();
    const trimmedSourceRef = sourceRef.trim();
    if (!trimmedName) {
      setFormError('Full name is required.');
      return;
    }
    if (!trimmedSourceRef) {
      setFormError('Provenance source reference is required for contact records.');
      return;
    }

    const nextOptedOutAt = optedOut
      ? editingContact?.opted_out_at ?? new Date().toISOString()
      : null;

    const payload: ContactWritePayload = {
      sponsor_id: sponsor.sponsor_id,
      full_name: trimmedName,
      job_title: jobTitle.trim() || null,
      decision_role: decisionRole,
      ...(canAccessPii
        ? {
            email: email.trim() || null,
            phone: phone.trim() || null,
          }
        : {}),
      consent_basis: consentBasis.trim() || null,
      opted_out_at: nextOptedOutAt,
      source_ref: trimmedSourceRef,
      record_class: targetRecordClass,
    };

    setSubmitting(true);
    setFormError(null);

    try {
      const res = editingContact
        ? await updateContact(
            editingContact.contact_id,
            payload,
            editingContact,
            sponsor
          )
        : await createContact(payload, sponsor);
      onSaved(res.contact);
    } catch (err) {
      if (err instanceof SponsorApiError) {
        setFormError(err.message);
      } else {
        setFormError('Could not save contact. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlideOverDrawer
      open={open}
      onClose={onClose}
      meta={isEditing ? 'Edit contact' : 'New contact'}
      title={isEditing ? editingContact?.full_name ?? 'Edit contact' : 'Add contact'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded border border-[#E8E6E0] bg-[#FAF9F6] px-3.5 py-2.5">
          <p className="text-[11px] font-medium text-[#788C83]">Sponsor</p>
          <p className="mt-0.5 text-[13px] font-medium text-[#202824]">
            {sponsor.display_name}
          </p>
        </div>

        {readOnly ? (
          <div className="rounded border border-[#D9D7D0] bg-[#FAF9F6] px-3.5 py-2.5 text-[12px] text-[#525E58]">
            This contact belongs to a read-only record and cannot be modified.
          </div>
        ) : null}

        {formError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded border border-[#9B3B32]/30 bg-[#9B3B32]/5 px-3.5 py-2.5 text-[12px] text-[#9B3B32]"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        ) : null}

        <div>
          <label
            htmlFor="contact-full-name"
            className="block text-[12px] font-medium text-[#525E58]"
          >
            Full name
          </label>
          <input
            id="contact-full-name"
            type="text"
            required
            disabled={readOnly || submitting}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Ananya Sharma"
            className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="contact-job-title"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Job title
            </label>
            <input
              id="contact-job-title"
              type="text"
              disabled={readOnly || submitting}
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Head of Brand Marketing"
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            />
          </div>

          <div>
            <div className="flex items-center gap-1">
              <label
                htmlFor="contact-decision-role"
                className="block text-[12px] font-medium text-[#525E58]"
              >
                Decision role
              </label>
              <InfoHint
                label="Decision role rule"
                content="Defaults to unknown and is never inferred from job title. Confirm role directly from sponsor conversations."
              />
            </div>
            <select
              id="contact-decision-role"
              disabled={readOnly || submitting}
              value={decisionRole}
              onChange={(e) =>
                setDecisionRole(e.target.value as ContactDecisionRole)
              }
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              {CONTACT_DECISION_ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="flex items-center gap-1">
              <label
                htmlFor="contact-email"
                className="block text-[12px] font-medium text-[#525E58]"
              >
                Email
              </label>
              <InfoHint
                label="Personal data visibility"
                content="Frontend hides personal contact details unless verified by the server; actual PII access control is enforced server-side."
              />
            </div>
            {canAccessPii ? (
              <input
                id="contact-email"
                type="email"
                disabled={readOnly || submitting}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
              />
            ) : (
              <div className="mt-1 flex h-9 items-center rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-3 text-[12px] text-[#788C83]">
                {piiRestrictionLabel}
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="contact-phone"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Phone
            </label>
            {canAccessPii ? (
              <input
                id="contact-phone"
                type="tel"
                disabled={readOnly || submitting}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 ..."
                className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] placeholder:font-sans placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
              />
            ) : (
              <div className="mt-1 flex h-9 items-center rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-3 text-[12px] text-[#788C83]">
                {piiRestrictionLabel}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="contact-consent-basis"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Consent basis
            </label>
            <input
              id="contact-consent-basis"
              type="text"
              list={consentListId}
              disabled={readOnly || submitting}
              value={consentBasis}
              onChange={(e) => setConsentBasis(e.target.value)}
              placeholder="e.g. warm_introduction"
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            />
            <datalist id={consentListId}>
              {CONTACT_CONSENT_BASIS_SUGGESTIONS.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>

          <div>
            <label
              htmlFor="contact-source-ref"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Source reference (provenance)
            </label>
            <input
              id="contact-source-ref"
              type="text"
              required
              disabled={readOnly || submitting}
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
              placeholder="e.g. Referral RF-003 or Inbound form"
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            />
          </div>
        </div>

        <div className="rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-3.5 py-3">
          <label className="flex items-start gap-2.5 text-[13px] text-[#202824]">
            <input
              type="checkbox"
              disabled={readOnly || submitting}
              checked={optedOut}
              onChange={(e) => setOptedOut(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#D9D7D0] text-[#315F52] focus:ring-[#315F52]"
            />
            <span>
              <span className="font-medium">Opted out of outreach</span>
              {editingContact?.opted_out_at ? (
                <span className="mt-0.5 block font-mono text-[11px] text-[#9B3B32]">
                  Opted out at {editingContact.opted_out_at}
                </span>
              ) : (
                <span className="mt-0.5 block text-[12px] text-[#788C83]">
                  Blocks all outreach attempts for this contact.
                </span>
              )}
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#E8E6E0] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-[#D9D7D0] bg-white px-3.5 text-[13px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6]"
          >
            Cancel
          </button>
          {!readOnly ? (
            <button
              type="submit"
              disabled={submitting}
              className="h-9 rounded-md bg-[#315F52] px-4 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#264B40] disabled:opacity-60"
            >
              {submitting
                ? 'Saving...'
                : isEditing
                  ? 'Save changes'
                  : 'Add contact'}
            </button>
          ) : null}
        </div>
      </form>
    </SlideOverDrawer>
  );
}
