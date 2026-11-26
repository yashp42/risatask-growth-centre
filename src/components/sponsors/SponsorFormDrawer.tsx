import { AlertCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  SPONSOR_EDITION_BY_CLASS,
  SPONSOR_FIRST_SOURCE_OPTIONS,
  SPONSOR_LIFECYCLE_OPTIONS,
  SponsorApiError,
  createSponsor,
  getDefaultSponsorEditionForClass,
  isSponsorReadOnly,
  updateSponsor,
} from '../../services/sponsorsApi';
import type {
  CategoryEntity,
  SponsorEntity,
  SponsorFirstSource,
  SponsorLifecycleStatus,
  SponsorWritePayload,
  UserPermissionContext,
} from '../../types/sponsors';
import { InfoHint } from '../ui/InfoHint';
import { SlideOverDrawer } from '../ui/SlideOverDrawer';

interface SponsorFormDrawerProps {
  open: boolean;
  editingSponsor: SponsorEntity | null;
  activeRecordClass: 'simulated' | 'live';
  activeEditionId: string;
  referenceCategories: CategoryEntity[];
  categoriesAvailable: boolean;
  permissions: UserPermissionContext;
  hasNamedInteraction?: boolean;
  hasPriorContract?: boolean;
  onClose: () => void;
  onSaved: (sponsor: SponsorEntity) => void;
}

const LIFECYCLE_INPUT_OPTIONS = SPONSOR_LIFECYCLE_OPTIONS.filter(
  (opt) => opt.value !== 'all'
);
const FIRST_SOURCE_INPUT_OPTIONS = SPONSOR_FIRST_SOURCE_OPTIONS.filter(
  (opt) => opt.value !== 'all'
);

export function SponsorFormDrawer({
  open,
  editingSponsor,
  activeRecordClass,
  activeEditionId,
  referenceCategories,
  categoriesAvailable,
  permissions,
  hasNamedInteraction = false,
  hasPriorContract = false,
  onClose,
  onSaved,
}: SponsorFormDrawerProps) {
  const isEditing = Boolean(editingSponsor);
  const readOnly = editingSponsor ? isSponsorReadOnly(editingSponsor) : false;

  const [displayName, setDisplayName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [lifecycleStatus, setLifecycleStatus] =
    useState<SponsorLifecycleStatus>('research_target');
  const [firstSource, setFirstSource] =
    useState<SponsorFirstSource>('research');
  const [gstin, setGstin] = useState('');
  const [website, setWebsite] = useState('');
  const [city, setCity] = useState('');
  const [recordClass, setRecordClass] = useState<'simulated' | 'live'>(
    activeRecordClass
  );
  const [editionId, setEditionId] = useState(activeEditionId);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (editingSponsor) {
      const nextClass: 'simulated' | 'live' =
        editingSponsor.record_class === 'live' ? 'live' : 'simulated';
      setDisplayName(editingSponsor.display_name ?? '');
      setLegalName(editingSponsor.legal_name ?? '');
      setCategoryId(editingSponsor.category_id ?? '');
      setLifecycleStatus(editingSponsor.lifecycle_status ?? 'research_target');
      setFirstSource(editingSponsor.first_source ?? 'research');
      setGstin(editingSponsor.gstin ?? '');
      setWebsite(editingSponsor.website ?? '');
      setCity(editingSponsor.city ?? '');
      setRecordClass(nextClass);
      setEditionId(
        editingSponsor.edition_id || getDefaultSponsorEditionForClass(nextClass)
      );
    } else {
      const defaultEdition = SPONSOR_EDITION_BY_CLASS[activeRecordClass].some(
        (e) => e.value === activeEditionId
      )
        ? activeEditionId
        : getDefaultSponsorEditionForClass(activeRecordClass);

      setDisplayName('');
      setLegalName('');
      setCategoryId('');
      setLifecycleStatus('research_target');
      setFirstSource('research');
      setGstin('');
      setWebsite('');
      setCity('');
      setRecordClass(activeRecordClass);
      setEditionId(defaultEdition);
    }
  }, [open, editingSponsor, activeRecordClass, activeEditionId]);

  const allowProgressionToProspect =
    isEditing &&
    (hasNamedInteraction ||
      editingSponsor?.lifecycle_status === 'prospect' ||
      editingSponsor?.lifecycle_status === 'active');

  const allowPastSponsor =
    hasPriorContract ||
    (isEditing && editingSponsor?.lifecycle_status === 'past_sponsor');

  const canAccessGstin =
    permissions.verified_by_server &&
    permissions.can_view_gstin &&
    !editingSponsor?.gstin_redacted;

  const gstinRestrictionLabel = editingSponsor?.gstin_redacted
    ? 'Redacted by server'
    : !permissions.verified_by_server
      ? 'Server verification required'
      : 'Restricted by role';

  const isStatusOptionDisabled = (value: string): boolean => {
    if (value === 'prospect' || value === 'active') {
      return !allowProgressionToProspect;
    }
    if (value === 'past_sponsor') {
      return !allowPastSponsor;
    }
    return false;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || submitting) return;

    const trimmedDisplay = displayName.trim();
    if (!trimmedDisplay) {
      setFormError('Display name is required.');
      return;
    }

    if (
      (lifecycleStatus === 'prospect' || lifecycleStatus === 'active') &&
      !allowProgressionToProspect
    ) {
      setFormError(
        'A sponsor remains research_target until an interaction exists with a named contact.'
      );
      return;
    }

    if (lifecycleStatus === 'past_sponsor' && !allowPastSponsor) {
      setFormError(
        'Past sponsor status requires a contract from an earlier edition.'
      );
      return;
    }

    const payload: SponsorWritePayload = {
      display_name: trimmedDisplay,
      legal_name: legalName.trim() || null,
      category_id: categoryId.trim() || null,
      lifecycle_status: lifecycleStatus,
      first_source: firstSource,
      ...(canAccessGstin ? { gstin: gstin.trim() || null } : {}),
      website: website.trim() || null,
      city: city.trim() || null,
      record_class: recordClass,
      edition_id: editionId,
    };

    setSubmitting(true);
    setFormError(null);

    try {
      const res = editingSponsor
        ? await updateSponsor(editingSponsor.sponsor_id, payload, editingSponsor)
        : await createSponsor(payload);
      onSaved(res.sponsor);
    } catch (err) {
      if (err instanceof SponsorApiError) {
        setFormError(err.message);
      } else {
        setFormError('Could not save sponsor changes. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlideOverDrawer
      open={open}
      onClose={onClose}
      meta={isEditing ? 'Edit sponsor' : 'New sponsor'}
      title={
        isEditing
          ? editingSponsor?.display_name ?? 'Edit sponsor'
          : 'Register sponsor'
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {readOnly ? (
          <div className="rounded border border-[#D9D7D0] bg-[#FAF9F6] px-3.5 py-2.5 text-[12px] text-[#525E58]">
            This record is read-only and cannot be modified.
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
            htmlFor="sponsor-display-name"
            className="block text-[12px] font-medium text-[#525E58]"
          >
            Display name
          </label>
          <input
            id="sponsor-display-name"
            type="text"
            required
            disabled={readOnly || submitting}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Acme Consumer Labs"
            className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
          />
        </div>

        <div>
          <label
            htmlFor="sponsor-legal-name"
            className="block text-[12px] font-medium text-[#525E58]"
          >
            Legal name
          </label>
          <input
            id="sponsor-legal-name"
            type="text"
            disabled={readOnly || submitting}
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder="Registered entity name for invoicing"
            className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="sponsor-record-class"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Record class
            </label>
            <select
              id="sponsor-record-class"
              disabled={readOnly || submitting || isEditing}
              value={recordClass}
              onChange={(e) => {
                const nextClass = e.target.value as 'simulated' | 'live';
                setRecordClass(nextClass);
                setEditionId(getDefaultSponsorEditionForClass(nextClass));
              }}
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              <option value="simulated">Simulated (demo)</option>
              <option value="live">Live</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="sponsor-edition"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Festival edition
            </label>
            <select
              id="sponsor-edition"
              disabled={readOnly || submitting || isEditing}
              value={editionId}
              onChange={(e) => setEditionId(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              {SPONSOR_EDITION_BY_CLASS[recordClass].map((opt) => (
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
                htmlFor="sponsor-category-id"
                className="block text-[12px] font-medium text-[#525E58]"
              >
                Category
              </label>
              {!categoriesAvailable || referenceCategories.length === 0 ? (
                <InfoHint
                  label="Category reference catalog"
                  content="Category selection requires the canonical CATEGORY reference catalog from the server."
                />
              ) : null}
            </div>
            {referenceCategories.length > 0 ? (
              <select
                id="sponsor-category-id"
                disabled={readOnly || submitting}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
              >
                <option value="">Select category</option>
                {categoryId &&
                !referenceCategories.some((c) => c.category_id === categoryId) ? (
                  <option value={categoryId}>
                    {editingSponsor?.category_name
                      ? `${editingSponsor.category_name} (${categoryId})`
                      : categoryId}
                  </option>
                ) : null}
                {referenceCategories.map((cat) => (
                  <option key={cat.category_id} value={cat.category_id}>
                    {cat.tier ? `${cat.name} (${cat.tier})` : cat.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="sponsor-category-id"
                type="text"
                disabled={readOnly || submitting}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                placeholder="Category catalog unavailable"
                className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] placeholder:font-sans placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
              />
            )}
          </div>

          <div>
            <label
              htmlFor="sponsor-first-source"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              First source
            </label>
            <select
              id="sponsor-first-source"
              disabled={readOnly || submitting}
              value={firstSource}
              onChange={(e) =>
                setFirstSource(e.target.value as SponsorFirstSource)
              }
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              {FIRST_SOURCE_INPUT_OPTIONS.map((opt) => (
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
                htmlFor="sponsor-lifecycle-status"
                className="block text-[12px] font-medium text-[#525E58]"
              >
                Lifecycle status
              </label>
              <InfoHint
                label="Lifecycle transition rules"
                content="Sponsors remain research targets until an interaction exists with a named contact. Past sponsor requires a contract from an earlier edition."
              />
            </div>
            <select
              id="sponsor-lifecycle-status"
              disabled={readOnly || submitting}
              value={lifecycleStatus}
              onChange={(e) =>
                setLifecycleStatus(e.target.value as SponsorLifecycleStatus)
              }
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            >
              {LIFECYCLE_INPUT_OPTIONS.map((opt) => (
                <option
                  key={opt.value}
                  value={opt.value}
                  disabled={isStatusOptionDisabled(opt.value)}
                >
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="sponsor-city"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              City
            </label>
            <input
              id="sponsor-city"
              type="text"
              disabled={readOnly || submitting}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Bengaluru"
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="sponsor-website"
              className="block text-[12px] font-medium text-[#525E58]"
            >
              Website
            </label>
            <input
              id="sponsor-website"
              type="url"
              disabled={readOnly || submitting}
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
              className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] text-[#202824] placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
            />
          </div>

          <div>
            <div className="flex items-center gap-1">
              <label
                htmlFor="sponsor-gstin"
                className="block text-[12px] font-medium text-[#525E58]"
              >
                GSTIN
              </label>
              <InfoHint
                label="GSTIN access policy"
                content="Tax identifier used for invoicing. Frontend hides this input unless verified by the server; actual data restriction is enforced server-side."
              />
            </div>
            {canAccessGstin ? (
              <input
                id="sponsor-gstin"
                type="text"
                disabled={readOnly || submitting}
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="15-character GSTIN"
                className="mt-1 h-9 w-full rounded-md border border-[#D9D7D0] bg-white px-3 font-mono text-[13px] text-[#202824] placeholder:font-sans placeholder:text-[#788C83] focus:border-[#315F52] focus:outline-none disabled:bg-[#FAF9F6]"
              />
            ) : (
              <div className="mt-1 flex h-9 items-center rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-3 text-[12px] text-[#788C83]">
                {gstinRestrictionLabel}
              </div>
            )}
          </div>
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
                  : 'Register sponsor'}
            </button>
          ) : null}
        </div>
      </form>
    </SlideOverDrawer>
  );
}
