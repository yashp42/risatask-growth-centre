import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useSeason } from '../../contexts/SeasonContext';
import { isHistoricalReadOnlyEdition } from '../../lib/dateIst';
import {
  CampaignApiError,
  fetchCampaignPortfolio,
  getDefaultEditionForClass,
} from '../../services/campaignsApi';
import type {
  CampaignEntity,
  CampaignPortfolioFilters,
  CampaignPortfolioRow,
  CampaignPortfolioSummary,
} from '../../types/campaigns';
import type {
  ApiErrorInfo,
  DataLoadStatus,
  FilterOption,
} from '../../types/overview';
import type { PreviewStateMode } from '../overview/OverviewHeaderFilters';
import { CampaignDetailView } from './CampaignDetailView';
import { CampaignFormDrawer } from './CampaignFormDrawer';
import { CampaignPortfolioPage } from './CampaignPortfolioPage';

interface CampaignsWorkspaceProps {
  showDevControls: boolean;
  initialCampaignId?: string | null;
  onClearInitialCampaignId?: () => void;
  onOpenSponsor?: (sponsorId: string) => void;
}

export function CampaignsWorkspace({
  showDevControls,
  initialCampaignId = null,
  onClearInitialCampaignId,
  onOpenSponsor,
}: CampaignsWorkspaceProps) {
  const { editionId, recordClass, asOf, setEditionAndClass, setAsOf } =
    useSeason();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<CampaignPortfolioFilters>(() => ({
    search: '',
    record_class: recordClass,
    edition_id: editionId,
    channel_id: 'all',
    bet_id: 'all',
    owner_member_id: 'all',
    status: 'all',
    as_of: asOf,
  }));

  const [previewMode, setPreviewMode] = useState<PreviewStateMode>('default');
  const [reloadNonce, setReloadNonce] = useState(0);

  const [status, setStatus] = useState<DataLoadStatus>('loading');
  const [rows, setRows] = useState<CampaignPortfolioRow[]>([]);
  const [summary, setSummary] = useState<CampaignPortfolioSummary>({
    active_campaigns_count: null,
    open_pipeline_metric: null,
    signed_value_metric: null,
    data_version: null,
  });
  const [ownerOptions, setOwnerOptions] = useState<FilterOption[]>([
    { value: 'all', label: 'All owners' },
  ]);
  const [error, setError] = useState<ApiErrorInfo | null>(null);

  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    initialCampaignId
  );
  const [selectedCampaignSeed, setSelectedCampaignSeed] =
    useState<CampaignEntity | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<CampaignEntity | null>(
    null
  );

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
    if (initialCampaignId) {
      setSelectedCampaignId(initialCampaignId);
    }
  }, [initialCampaignId]);

  const handleChangeFilters = useCallback(
    (
      updater:
        | CampaignPortfolioFilters
        | ((prev: CampaignPortfolioFilters) => CampaignPortfolioFilters)
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

    if (showDevControls && previewMode === 'loading') {
      setStatus('loading');
      setError(null);
      return () => controller.abort();
    }

    if (showDevControls && previewMode === 'error') {
      setStatus('error');
      setError({
        code: 'UNAVAILABLE',
        message: 'Campaign data could not be retrieved right now.',
        endpoint: '',
      });
      return () => controller.abort();
    }

    setStatus('loading');
    setError(null);

    fetchCampaignPortfolio(filters, controller.signal)
      .then((res) => {
        setRows(res.rows);
        setSummary(res.summary);
        setOwnerOptions(res.owners);
        setStatus(res.rows.length > 0 ? 'ready' : 'empty');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus('error');
        setError({
          code: err instanceof CampaignApiError ? err.code : 'ERROR',
          message:
            err instanceof CampaignApiError
              ? err.message
              : 'Unable to load campaigns.',
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

  const writableRecordClass: 'simulated' | 'live' =
    filters.record_class === 'live' ? 'live' : 'simulated';
  const isHistoricalReadOnly = isHistoricalReadOnlyEdition(
    filters.edition_id,
    filters.record_class
  );

  return (
    <>
      {selectedCampaignId ? (
        <CampaignDetailView
          campaignId={selectedCampaignId}
          initialCampaign={selectedCampaignSeed}
          recordClass={filters.record_class}
          editionId={filters.edition_id}
          asOfDate={filters.as_of}
          reloadToken={reloadNonce}
          onBack={() => {
            setSelectedCampaignId(null);
            setSelectedCampaignSeed(null);
            onClearInitialCampaignId?.();
          }}
          onEditCampaign={(campaign) => {
            if (isHistoricalReadOnly) return;
            setEditingCampaign(campaign);
            setFormOpen(true);
          }}
          onInvalidatePortfolio={invalidateAll}
          onOpenSponsor={onOpenSponsor}
        />
      ) : (
        <CampaignPortfolioPage
          filters={filters}
          onChangeFilters={handleChangeFilters}
          rows={rows}
          summary={summary}
          ownerOptions={ownerOptions}
          status={status}
          error={error}
          onRetry={invalidateAll}
          onRefresh={invalidateAll}
          onCreateCampaign={() => {
            if (isHistoricalReadOnly) return;
            setEditingCampaign(null);
            setFormOpen(true);
          }}
          onEditCampaign={(campaign) => {
            if (isHistoricalReadOnly) return;
            setEditingCampaign(campaign);
            setFormOpen(true);
          }}
          onOpenCampaign={(campaign) => {
            setSelectedCampaignSeed(campaign);
            setSelectedCampaignId(campaign.campaign_id);
          }}
          showDevControls={showDevControls}
          previewMode={previewMode}
          onChangePreviewMode={setPreviewMode}
        />
      )}

      <CampaignFormDrawer
        open={formOpen}
        editingCampaign={editingCampaign}
        activeRecordClass={writableRecordClass}
        activeEditionId={getDefaultEditionForClass(writableRecordClass)}
        onClose={() => {
          setFormOpen(false);
          setEditingCampaign(null);
        }}
        onSaved={(saved) => {
          setFormOpen(false);
          setEditingCampaign(null);
          if (selectedCampaignId === saved.campaign_id) {
            setSelectedCampaignSeed(saved);
          }
          invalidateAll();
        }}
      />
    </>
  );
}
