import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSeason } from '../../contexts/SeasonContext';
import { isHistoricalReadOnlyEdition } from '../../lib/dateIst';
import {
  DEFAULT_UNVERIFIED_PERMISSIONS,
  SponsorApiError,
  fetchCurrentUserPermissions,
  fetchReferenceCategories,
  fetchSponsorsDirectory,
  getDefaultSponsorEditionForClass,
} from '../../services/sponsorsApi';
import type {
  ApiErrorInfo,
  DataLoadStatus,
  FilterOption,
} from '../../types/overview';
import type {
  CategoryEntity,
  SponsorDirectoryFilters,
  SponsorEntity,
  UserPermissionContext,
} from '../../types/sponsors';
import type { PreviewStateMode } from '../overview/OverviewHeaderFilters';
import { SponsorDetailView } from './SponsorDetailView';
import { SponsorDirectoryPage } from './SponsorDirectoryPage';
import { SponsorFormDrawer } from './SponsorFormDrawer';

interface SponsorsWorkspaceProps {
  showDevControls: boolean;
  initialSponsorId?: string | null;
  onClearInitialSponsorId?: () => void;
  onOpenCampaign?: (campaignId: string) => void;
}

export function SponsorsWorkspace({
  showDevControls,
  initialSponsorId = null,
  onClearInitialSponsorId,
  onOpenCampaign,
}: SponsorsWorkspaceProps) {
  const { editionId, recordClass, setEditionAndClass } = useSeason();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<SponsorDirectoryFilters>(() => ({
    search: '',
    record_class: recordClass,
    edition_id: editionId,
    lifecycle_status: 'all',
    category_id: 'all',
    first_source: 'all',
    city: 'all',
  }));

  const [previewMode, setPreviewMode] = useState<PreviewStateMode>('default');
  const [reloadNonce, setReloadNonce] = useState(0);

  const [permissions, setPermissions] = useState<UserPermissionContext>(
    DEFAULT_UNVERIFIED_PERMISSIONS
  );

  const [referenceCategories, setReferenceCategories] = useState<
    CategoryEntity[]
  >([]);
  const [categoriesAvailable, setCategoriesAvailable] = useState(false);

  const [status, setStatus] = useState<DataLoadStatus>('loading');
  const [sponsors, setSponsors] = useState<SponsorEntity[]>([]);
  const [derivedCategoryOptions, setDerivedCategoryOptions] = useState<
    FilterOption[]
  >([{ value: 'all', label: 'All categories' }]);
  const [cityOptions, setCityOptions] = useState<FilterOption[]>([
    { value: 'all', label: 'All cities' },
  ]);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  const [selectedSponsorId, setSelectedSponsorId] = useState<string | null>(
    initialSponsorId
  );
  const [selectedSponsorSeed, setSelectedSponsorSeed] =
    useState<SponsorEntity | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingSponsor, setEditingSponsor] = useState<SponsorEntity | null>(
    null
  );
  const [editRulesContext, setEditRulesContext] = useState<{
    hasNamedInteraction: boolean;
    hasPriorContract: boolean;
  }>({
    hasNamedInteraction: false,
    hasPriorContract: false,
  });

  useEffect(() => {
    setFilters((prev) =>
      prev.edition_id === editionId && prev.record_class === recordClass
        ? prev
        : { ...prev, edition_id: editionId, record_class: recordClass }
    );
  }, [editionId, recordClass]);

  useEffect(() => {
    if (initialSponsorId) {
      setSelectedSponsorId(initialSponsorId);
    }
  }, [initialSponsorId]);

  const handleChangeFilters = useCallback(
    (
      updater:
        | SponsorDirectoryFilters
        | ((prev: SponsorDirectoryFilters) => SponsorDirectoryFilters)
    ) => {
      setFilters((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (
          next.edition_id !== prev.edition_id ||
          next.record_class !== prev.record_class
        ) {
          setEditionAndClass(
            next.edition_id,
            next.record_class === 'external_research'
              ? undefined
              : next.record_class
          );
        }
        return next;
      });
    },
    [setEditionAndClass]
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
    fetchReferenceCategories(controller.signal).then((res) => {
      setReferenceCategories(res.categories);
      setCategoriesAvailable(res.available);
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
        message: 'Sponsor directory could not be retrieved right now.',
        endpoint: '',
      });
      return () => controller.abort();
    }

    setStatus('loading');
    setError(null);

    fetchSponsorsDirectory(filters, controller.signal)
      .then((res) => {
        setSponsors(res.sponsors);
        setDerivedCategoryOptions(res.categories);
        setCityOptions(res.cities);
        setStatus(res.sponsors.length > 0 ? 'ready' : 'empty');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus('error');
        setError({
          code: err instanceof SponsorApiError ? err.code : 'ERROR',
          message:
            err instanceof SponsorApiError
              ? err.message
              : 'Unable to load sponsors.',
          endpoint: '',
        });
      });

    return () => controller.abort();
  }, [filters, previewMode, showDevControls, reloadNonce]);

  const invalidateAll = useCallback(() => {
    setPreviewMode('default');
    setReloadNonce((n) => n + 1);
    void queryClient.invalidateQueries();
  }, [queryClient]);

  const categoryOptions = useMemo<FilterOption[]>(() => {
    if (referenceCategories.length > 0) {
      return [
        { value: 'all', label: 'All categories' },
        ...referenceCategories.map((cat) => ({
          value: cat.category_id,
          label: cat.tier ? `${cat.name} (${cat.tier})` : cat.name,
        })),
      ];
    }
    return derivedCategoryOptions;
  }, [referenceCategories, derivedCategoryOptions]);

  const writableRecordClass: 'simulated' | 'live' =
    filters.record_class === 'live' ? 'live' : 'simulated';
  const isHistoricalReadOnly = isHistoricalReadOnlyEdition(
    filters.edition_id,
    filters.record_class
  );

  return (
    <>
      {selectedSponsorId ? (
        <SponsorDetailView
          sponsorId={selectedSponsorId}
          initialSponsor={selectedSponsorSeed}
          recordClass={filters.record_class}
          editionId={filters.edition_id}
          permissions={permissions}
          reloadToken={reloadNonce}
          onBack={() => {
            setSelectedSponsorId(null);
            setSelectedSponsorSeed(null);
            onClearInitialSponsorId?.();
          }}
          onEditSponsor={(sponsor, rulesContext) => {
            if (isHistoricalReadOnly) return;
            setEditingSponsor(sponsor);
            setEditRulesContext(rulesContext);
            setFormOpen(true);
          }}
          onOpenCampaign={onOpenCampaign}
          onInvalidateDirectory={invalidateAll}
        />
      ) : (
        <SponsorDirectoryPage
          filters={filters}
          onChangeFilters={handleChangeFilters}
          sponsors={sponsors}
          categoryOptions={categoryOptions}
          cityOptions={cityOptions}
          permissions={permissions}
          status={status}
          error={error}
          onRetry={invalidateAll}
          onRefresh={invalidateAll}
          onCreateSponsor={() => {
            if (isHistoricalReadOnly) return;
            setEditingSponsor(null);
            setEditRulesContext({
              hasNamedInteraction: false,
              hasPriorContract: false,
            });
            setFormOpen(true);
          }}
          onEditSponsor={(sponsor) => {
            if (isHistoricalReadOnly) return;
            setEditingSponsor(sponsor);
            setEditRulesContext({
              hasNamedInteraction:
                sponsor.lifecycle_status === 'prospect' ||
                sponsor.lifecycle_status === 'active',
              hasPriorContract:
                Boolean(sponsor.has_prior_edition_contract) ||
                sponsor.lifecycle_status === 'past_sponsor',
            });
            setFormOpen(true);
          }}
          onOpenSponsor={(sponsor) => {
            setSelectedSponsorSeed(sponsor);
            setSelectedSponsorId(sponsor.sponsor_id);
          }}
          showDevControls={showDevControls}
          previewMode={previewMode}
          onChangePreviewMode={setPreviewMode}
        />
      )}

      <SponsorFormDrawer
        open={formOpen}
        editingSponsor={editingSponsor}
        activeRecordClass={writableRecordClass}
        activeEditionId={getDefaultSponsorEditionForClass(writableRecordClass)}
        referenceCategories={referenceCategories}
        categoriesAvailable={categoriesAvailable}
        permissions={permissions}
        hasNamedInteraction={editRulesContext.hasNamedInteraction}
        hasPriorContract={editRulesContext.hasPriorContract}
        onClose={() => {
          setFormOpen(false);
          setEditingSponsor(null);
        }}
        onSaved={(saved) => {
          setFormOpen(false);
          setEditingSponsor(null);
          if (selectedSponsorId === saved.sponsor_id) {
            setSelectedSponsorSeed(saved);
          }
          invalidateAll();
        }}
      />
    </>
  );
}
