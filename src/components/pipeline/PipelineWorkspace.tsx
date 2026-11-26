import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSeason } from '../../contexts/SeasonContext';
import { isHistoricalReadOnlyEdition } from '../../lib/dateIst';
import {
  PipelineApiError,
  fetchPipelineContextCampaigns,
  fetchPipelineWorkspace,
  getDefaultPipelineEditionForClass,
} from '../../services/pipelineApi';
import {
  DEFAULT_UNVERIFIED_PERMISSIONS,
  fetchCurrentUserPermissions,
  fetchReferenceCategories,
} from '../../services/sponsorsApi';
import type { CampaignEntity } from '../../types/campaigns';
import type {
  ApiErrorInfo,
  DataLoadStatus,
  FilterOption,
} from '../../types/overview';
import type {
  OpportunityEntity,
  PipelineFilters,
  PipelineSummaryState,
} from '../../types/pipeline';
import type { CategoryEntity, UserPermissionContext } from '../../types/sponsors';
import type { PreviewStateMode } from '../overview/OverviewHeaderFilters';
import { OpportunityDetailView } from './OpportunityDetailView';
import { OpportunityFormDrawer } from './OpportunityFormDrawer';
import { OpportunityStageDrawer } from './OpportunityStageDrawer';
import { PipelineDirectoryPage } from './PipelineDirectoryPage';

interface PipelineWorkspaceProps {
  showDevControls: boolean;
  initialOpportunityId?: string | null;
  onClearInitialOpportunityId?: () => void;
  onOpenSponsor?: (sponsorId: string) => void;
  onOpenCampaign?: (campaignId: string) => void;
}

export function PipelineWorkspace({
  showDevControls,
  initialOpportunityId = null,
  onClearInitialOpportunityId,
  onOpenSponsor,
  onOpenCampaign,
}: PipelineWorkspaceProps) {
  const { editionId, recordClass, asOf, setEditionAndClass, setAsOf } =
    useSeason();

  const [filters, setFilters] = useState<PipelineFilters>(() => ({
    search: '',
    record_class: recordClass,
    edition_id: editionId,
    stage: 'all',
    owner_member_id: 'all',
    originating_campaign_id: 'all',
    bet_id: 'all',
    support_type: 'all',
    category_id: 'all',
    as_of: asOf,
  }));

  const [previewMode, setPreviewMode] = useState<PreviewStateMode>('default');
  const [reloadNonce, setReloadNonce] = useState(0);

  const [permissions, setPermissions] = useState<UserPermissionContext>(
    DEFAULT_UNVERIFIED_PERMISSIONS
  );
  const [referenceCategories, setReferenceCategories] = useState<
    CategoryEntity[]
  >([]);

  const [status, setStatus] = useState<DataLoadStatus>('loading');
  const [opportunities, setOpportunities] = useState<OpportunityEntity[]>([]);
  const [summary, setSummary] = useState<PipelineSummaryState>({
    metrics: {},
    data_version: null,
  });
  const [ownerOptions, setOwnerOptions] = useState<FilterOption[]>([
    { value: 'all', label: 'All owners' },
  ]);
  const [derivedCampaignOptions, setDerivedCampaignOptions] = useState<
    FilterOption[]
  >([{ value: 'all', label: 'All campaigns' }]);
  const [derivedCategoryOptions, setDerivedCategoryOptions] = useState<
    FilterOption[]
  >([{ value: 'all', label: 'All categories' }]);
  const [contextCampaigns, setContextCampaigns] = useState<CampaignEntity[]>(
    []
  );
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  const [selectedOpportunityId, setSelectedOpportunityId] = useState<
    string | null
  >(initialOpportunityId);
  const [selectedOpportunitySeed, setSelectedOpportunitySeed] =
    useState<OpportunityEntity | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingOpportunity, setEditingOpportunity] =
    useState<OpportunityEntity | null>(null);

  const [stageDrawerOpen, setStageDrawerOpen] = useState(false);
  const [stageOpportunity, setStageOpportunity] =
    useState<OpportunityEntity | null>(null);

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

  useEffect(() => {
    if (initialOpportunityId) {
      setSelectedOpportunityId(initialOpportunityId);
    }
  }, [initialOpportunityId]);

  const handleChangeFilters = useCallback(
    (
      updater:
        | PipelineFilters
        | ((prev: PipelineFilters) => PipelineFilters)
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
    fetchReferenceCategories(controller.signal).then((res) => {
      setReferenceCategories(res.categories);
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
        message: 'Pipeline data could not be retrieved right now.',
        endpoint: '',
      });
      return () => controller.abort();
    }

    setStatus('loading');
    setError(null);

    fetchPipelineWorkspace(filters, controller.signal)
      .then((res) => {
        setOpportunities(res.opportunities);
        setSummary(res.summary);
        setOwnerOptions(res.owners);
        setDerivedCampaignOptions(res.campaigns);
        setDerivedCategoryOptions(res.categories);
        setStatus(res.opportunities.length > 0 ? 'ready' : 'empty');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus('error');
        setError({
          code: err instanceof PipelineApiError ? err.code : 'ERROR',
          message:
            err instanceof PipelineApiError
              ? err.message
              : 'Unable to load pipeline opportunities.',
          endpoint: '',
        });
      });

    return () => controller.abort();
  }, [filters, previewMode, showDevControls, reloadNonce]);

  const writableRecordClass: 'simulated' | 'live' =
    filters.record_class === 'live' ? 'live' : 'simulated';
  const writableEditionId =
    getDefaultPipelineEditionForClass(writableRecordClass);

  // Load campaigns matching the active record_class/edition for filter & create dropdowns
  useEffect(() => {
    const controller = new AbortController();
    fetchPipelineContextCampaigns(
      filters.record_class,
      filters.edition_id,
      controller.signal
    )
      .then((list) => {
        setContextCampaigns(list);
      })
      .catch(() => {
        setContextCampaigns([]);
      });
    return () => controller.abort();
  }, [filters.record_class, filters.edition_id, reloadNonce]);

  const campaignOptions = useMemo<FilterOption[]>(() => {
    const map = new Map<string, string>();
    for (const opt of derivedCampaignOptions) {
      if (opt.value !== 'all') {
        map.set(opt.value, opt.label);
      }
    }
    for (const cam of contextCampaigns) {
      map.set(cam.campaign_id, cam.name || cam.campaign_id);
    }
    return [
      { value: 'all', label: 'All campaigns' },
      ...Array.from(map.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [derivedCampaignOptions, contextCampaigns]);

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

  const invalidateAll = useCallback(() => {
    setPreviewMode('default');
    setReloadNonce((n) => n + 1);
  }, []);

  const isHistoricalReadOnly = isHistoricalReadOnlyEdition(
    filters.edition_id,
    filters.record_class
  );

  return (
    <>
      {selectedOpportunityId ? (
        <OpportunityDetailView
          opportunityId={selectedOpportunityId}
          initialOpportunity={selectedOpportunitySeed}
          recordClass={filters.record_class}
          editionId={filters.edition_id}
          permissions={permissions}
          reloadToken={reloadNonce}
          onBack={() => {
            setSelectedOpportunityId(null);
            setSelectedOpportunitySeed(null);
            onClearInitialOpportunityId?.();
          }}
          onEditMetadata={(opportunity) => {
            if (isHistoricalReadOnly) return;
            setEditingOpportunity(opportunity);
            setFormOpen(true);
          }}
          onUpdateStage={(opportunity) => {
            if (isHistoricalReadOnly) return;
            setStageOpportunity(opportunity);
            setStageDrawerOpen(true);
          }}
          onOpenSponsor={onOpenSponsor}
          onOpenCampaign={onOpenCampaign}
          onInvalidatePipeline={invalidateAll}
        />
      ) : (
        <PipelineDirectoryPage
          filters={filters}
          onChangeFilters={handleChangeFilters}
          opportunities={opportunities}
          summary={summary}
          ownerOptions={ownerOptions}
          campaignOptions={campaignOptions}
          categoryOptions={categoryOptions}
          permissions={permissions}
          status={status}
          error={error}
          onRetry={invalidateAll}
          onRefresh={invalidateAll}
          onCreateOpportunity={() => {
            if (isHistoricalReadOnly) return;
            setEditingOpportunity(null);
            setFormOpen(true);
          }}
          onUpdateStage={(opportunity) => {
            if (isHistoricalReadOnly) return;
            setStageOpportunity(opportunity);
            setStageDrawerOpen(true);
          }}
          onOpenOpportunity={(opportunity) => {
            setSelectedOpportunitySeed(opportunity);
            setSelectedOpportunityId(opportunity.opportunity_id);
          }}
          showDevControls={showDevControls}
          previewMode={previewMode}
          onChangePreviewMode={setPreviewMode}
        />
      )}

      <OpportunityFormDrawer
        open={formOpen}
        editingOpportunity={editingOpportunity}
        activeRecordClass={writableRecordClass}
        activeEditionId={writableEditionId}
        campaigns={contextCampaigns}
        ownerOptions={ownerOptions}
        permissions={permissions}
        onClose={() => {
          setFormOpen(false);
          setEditingOpportunity(null);
        }}
        onSaved={(saved) => {
          setFormOpen(false);
          setEditingOpportunity(null);
          if (selectedOpportunityId === saved.opportunity_id) {
            setSelectedOpportunitySeed(saved);
          }
          invalidateAll();
        }}
      />

      <OpportunityStageDrawer
        open={stageDrawerOpen}
        opportunity={stageOpportunity}
        ownerOptions={ownerOptions}
        permissions={permissions}
        onClose={() => {
          setStageDrawerOpen(false);
          setStageOpportunity(null);
        }}
        onSaved={(updated) => {
          setStageDrawerOpen(false);
          setStageOpportunity(null);
          if (updated && selectedOpportunityId === updated.opportunity_id) {
            setSelectedOpportunitySeed(updated);
          }
          invalidateAll();
        }}
      />
    </>
  );
}
