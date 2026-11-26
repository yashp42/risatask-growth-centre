/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalyticsWorkspace } from './components/analytics/AnalyticsWorkspace';
import { GrowthAnalystWorkspace } from './components/analyst/GrowthAnalystWorkspace';
import { DemoLandingScreen } from './components/auth/DemoLandingScreen';
import { CampaignsWorkspace } from './components/campaigns/CampaignsWorkspace';
import { CollectionsWorkspace } from './components/collections/CollectionsWorkspace';
import { OverviewDashboard } from './components/overview/OverviewDashboard';
import { PipelineWorkspace } from './components/pipeline/PipelineWorkspace';
import { TeamSettingsWorkspace } from './components/settings/TeamSettingsWorkspace';
import { AppShell } from './components/shell/AppShell';
import { SponsorsWorkspace } from './components/sponsors/SponsorsWorkspace';
import { TasksWorkspace } from './components/tasks/TasksWorkspace';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SeasonProvider } from './contexts/SeasonContext';
import { useGrowthAnalystSession } from './hooks/useGrowthAnalystSession';
import { apiFetch } from './services/authSession';
import type { NavSectionId } from './types/overview';

const VALID_NAV_SECTIONS: ReadonlySet<NavSectionId> = new Set([
  'overview',
  'campaigns',
  'sponsors',
  'pipeline',
  'tasks',
  'collections',
  'analytics',
  'growth-analyst',
  'team-settings',
]);

interface UrlNavState {
  section: NavSectionId;
  campaignId: string | null;
  sponsorId: string | null;
  opportunityId: string | null;
  taskId: string | null;
}

function readUrlNavState(): UrlNavState {
  if (typeof window === 'undefined') {
    return {
      section: 'overview',
      campaignId: null,
      sponsorId: null,
      opportunityId: null,
      taskId: null,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const rawSection = params.get('section') as NavSectionId | null;
  const section: NavSectionId =
    rawSection && VALID_NAV_SECTIONS.has(rawSection) ? rawSection : 'overview';
  return {
    section,
    campaignId: params.get('campaignId'),
    sponsorId: params.get('sponsorId'),
    opportunityId: params.get('opportunityId'),
    taskId: params.get('taskId'),
  };
}

function writeUrlNavState(state: UrlNavState, replace = false): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('section', state.section);

  if (state.campaignId) url.searchParams.set('campaignId', state.campaignId);
  else url.searchParams.delete('campaignId');

  if (state.sponsorId) url.searchParams.set('sponsorId', state.sponsorId);
  else url.searchParams.delete('sponsorId');

  if (state.opportunityId)
    url.searchParams.set('opportunityId', state.opportunityId);
  else url.searchParams.delete('opportunityId');

  if (state.taskId) url.searchParams.set('taskId', state.taskId);
  else url.searchParams.delete('taskId');

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  if (replace) {
    window.history.replaceState(null, '', nextUrl);
  } else {
    window.history.pushState(null, '', nextUrl);
  }
}

async function fetchDataVersion(): Promise<string | null> {
  const response = await apiFetch('/api/version', {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  const data = (await response.json()) as {
    data_version?: string | number | null;
    version?: string | number | null;
  };
  const v = data.data_version ?? data.version;
  return v !== undefined && v !== null ? String(v) : null;
}

function AuthenticatedWorkspace() {
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const initialNav = useMemo(() => readUrlNavState(), []);

  const [activeSection, setActiveSection] = useState<NavSectionId>(
    initialNav.section
  );
  const [lastContextSection, setLastContextSection] = useState<NavSectionId>(
    initialNav.section === 'growth-analyst' ? 'overview' : initialNav.section
  );
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(
    initialNav.campaignId
  );
  const [selectedSponsorId, setSelectedSponsorId] = useState<string | null>(
    initialNav.sponsorId
  );
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<
    string | null
  >(initialNav.opportunityId);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    initialNav.taskId
  );
  const [analystPromptContext, setAnalystPromptContext] = useState<string | null>(
    null
  );
  const [externalDataNonce, setExternalDataNonce] = useState(0);
  const [devControlsEnabled, setDevControlsEnabled] = useState<boolean>(() => {
    if (!import.meta.env.DEV) return false;
    return new URLSearchParams(window.location.search).get('debug') === '1';
  });

  // Poll GET /api/version every 10 seconds and invalidate React Query caches on change
  const lastVersionRef = useRef<string | null>(null);
  const versionQuery = useQuery({
    queryKey: ['data-version'],
    queryFn: fetchDataVersion,
    enabled: status === 'authenticated',
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    const nextVersion = versionQuery.data;
    if (!nextVersion) return;
    if (lastVersionRef.current !== null && lastVersionRef.current !== nextVersion) {
      void queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== 'data-version',
      });
      setExternalDataNonce((prev) => prev + 1);
    }
    lastVersionRef.current = nextVersion;
  }, [versionQuery.data, queryClient]);

  // Sync navigation + drill-through selection into URL while preserving editionId/asOf/filters
  useEffect(() => {
    writeUrlNavState(
      {
        section: activeSection,
        campaignId: selectedCampaignId,
        sponsorId: selectedSponsorId,
        opportunityId: selectedOpportunityId,
        taskId: selectedTaskId,
      },
      true
    );
  }, [
    activeSection,
    selectedCampaignId,
    selectedSponsorId,
    selectedOpportunityId,
    selectedTaskId,
  ]);

  useEffect(() => {
    const onPopState = () => {
      const next = readUrlNavState();
      setActiveSection(next.section);
      if (next.section !== 'growth-analyst') {
        setLastContextSection(next.section);
      }
      setSelectedCampaignId(next.campaignId);
      setSelectedSponsorId(next.sponsorId);
      setSelectedOpportunityId(next.opportunityId);
      setSelectedTaskId(next.taskId);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleAfterAnalystAction = useCallback(() => {
    void queryClient.invalidateQueries();
    setExternalDataNonce((prev) => prev + 1);
  }, [queryClient]);

  const analystContextMeta = useMemo(
    () => ({
      activeSection:
        activeSection === 'growth-analyst'
          ? lastContextSection
          : activeSection,
      selectedCampaignId,
      selectedSponsorId,
      selectedOpportunityId,
      selectedTaskId,
    }),
    [
      activeSection,
      lastContextSection,
      selectedCampaignId,
      selectedSponsorId,
      selectedOpportunityId,
      selectedTaskId,
    ]
  );

  const analystSession = useGrowthAnalystSession(
    analystContextMeta,
    handleAfterAnalystAction
  );

  const activeRecordContext = useMemo(() => {
    const contextSec =
      activeSection === 'growth-analyst' ? lastContextSection : activeSection;
    if (contextSec === 'campaigns' && selectedCampaignId) {
      return { entityType: 'campaign' as const, entityId: selectedCampaignId };
    }
    if (contextSec === 'sponsors' && selectedSponsorId) {
      return { entityType: 'sponsor' as const, entityId: selectedSponsorId };
    }
    if (contextSec === 'pipeline' && selectedOpportunityId) {
      return {
        entityType: 'opportunity' as const,
        entityId: selectedOpportunityId,
      };
    }
    if (contextSec === 'tasks' && selectedTaskId) {
      return { entityType: 'task' as const, entityId: selectedTaskId };
    }
    return null;
  }, [
    activeSection,
    lastContextSection,
    selectedCampaignId,
    selectedSponsorId,
    selectedOpportunityId,
    selectedTaskId,
  ]);

  const handleOpenAnalyst = (promptContext?: string) => {
    if (activeSection !== 'growth-analyst') {
      setLastContextSection(activeSection);
    }
    setAnalystPromptContext(promptContext ?? null);
    setActiveSection('growth-analyst');
  };

  const handleOpenCampaignDetail = (campaignId: string) => {
    setSelectedCampaignId(campaignId);
    setLastContextSection('campaigns');
    setActiveSection('campaigns');
  };

  const handleOpenSponsorDetail = (sponsorId: string) => {
    setSelectedSponsorId(sponsorId);
    setLastContextSection('sponsors');
    setActiveSection('sponsors');
  };

  const handleOpenOpportunityDetail = (opportunityId: string) => {
    setSelectedOpportunityId(opportunityId);
    setLastContextSection('pipeline');
    setActiveSection('pipeline');
  };

  const handleOpenTaskDetail = (taskId: string) => {
    setSelectedTaskId(taskId);
    setLastContextSection('tasks');
    setActiveSection('tasks');
  };

  const handleOpenLinkedRecord = (recordType: string, recordId: string) => {
    if (!recordId) return;
    switch (recordType.toLowerCase()) {
      case 'sponsor':
        handleOpenSponsorDetail(recordId);
        break;
      case 'campaign':
        handleOpenCampaignDetail(recordId);
        break;
      case 'opportunity':
        handleOpenOpportunityDetail(recordId);
        break;
      case 'task':
        handleOpenTaskDetail(recordId);
        break;
      default:
        break;
    }
  };

  const handleSelectSection = (section: NavSectionId) => {
    if (section === 'growth-analyst') {
      if (activeSection !== 'growth-analyst') {
        setLastContextSection(activeSection);
      }
      setActiveSection('growth-analyst');
      return;
    }
    setAnalystPromptContext(null);
    if (section !== 'campaigns') {
      setSelectedCampaignId(null);
    }
    if (section !== 'sponsors') {
      setSelectedSponsorId(null);
    }
    if (section !== 'pipeline') {
      setSelectedOpportunityId(null);
    }
    if (section !== 'tasks') {
      setSelectedTaskId(null);
    }
    setLastContextSection(section);
    setActiveSection(section);
  };

  const showDevControls = import.meta.env.DEV && devControlsEnabled;

  if (status !== 'authenticated') {
    return <DemoLandingScreen />;
  }

  return (
    <AppShell
      activeSection={activeSection}
      onSelectSection={handleSelectSection}
      onOpenAnalystWorkspace={handleOpenAnalyst}
      analystSession={analystSession}
      onOpenAnalystLinkedRecord={handleOpenLinkedRecord}
      devControlsEnabled={devControlsEnabled}
      onToggleDevControls={() => setDevControlsEnabled((prev) => !prev)}
    >
      {activeSection === 'overview' ? (
        <OverviewDashboard
          key={`overview-${externalDataNonce}`}
          showDevControls={showDevControls}
          onNavigateSection={(sec) => handleSelectSection(sec)}
          onOpenCampaignDetail={handleOpenCampaignDetail}
          onOpenRecord={handleOpenLinkedRecord}
        />
      ) : activeSection === 'campaigns' ? (
        <CampaignsWorkspace
          key={`campaigns-${externalDataNonce}`}
          showDevControls={showDevControls}
          initialCampaignId={selectedCampaignId}
          onClearInitialCampaignId={() => setSelectedCampaignId(null)}
          onOpenSponsor={handleOpenSponsorDetail}
        />
      ) : activeSection === 'sponsors' ? (
        <SponsorsWorkspace
          key={`sponsors-${externalDataNonce}`}
          showDevControls={showDevControls}
          initialSponsorId={selectedSponsorId}
          onClearInitialSponsorId={() => setSelectedSponsorId(null)}
          onOpenCampaign={handleOpenCampaignDetail}
        />
      ) : activeSection === 'pipeline' ? (
        <PipelineWorkspace
          key={`pipeline-${externalDataNonce}`}
          showDevControls={showDevControls}
          initialOpportunityId={selectedOpportunityId}
          onClearInitialOpportunityId={() => setSelectedOpportunityId(null)}
          onOpenSponsor={handleOpenSponsorDetail}
          onOpenCampaign={handleOpenCampaignDetail}
        />
      ) : activeSection === 'tasks' ? (
        <TasksWorkspace
          key={`tasks-${externalDataNonce}`}
          showDevControls={showDevControls}
          initialTaskId={selectedTaskId}
          onClearInitialTaskId={() => setSelectedTaskId(null)}
          onOpenSponsor={handleOpenSponsorDetail}
          onOpenOpportunity={handleOpenOpportunityDetail}
          onOpenCampaign={handleOpenCampaignDetail}
        />
      ) : activeSection === 'collections' ? (
        <CollectionsWorkspace
          key={`collections-${externalDataNonce}`}
          showDevControls={showDevControls}
          onOpenSponsor={handleOpenSponsorDetail}
          onOpenOpportunity={handleOpenOpportunityDetail}
        />
      ) : activeSection === 'analytics' ? (
        <AnalyticsWorkspace
          key={`analytics-${externalDataNonce}`}
          showDevControls={showDevControls}
          onOpenCampaign={handleOpenCampaignDetail}
          onOpenCampaigns={() => handleSelectSection('campaigns')}
          onOpenSponsors={() => handleSelectSection('sponsors')}
          onOpenPipeline={() => handleSelectSection('pipeline')}
        />
      ) : activeSection === 'team-settings' ? (
        <TeamSettingsWorkspace />
      ) : (
        <GrowthAnalystWorkspace
          session={analystSession}
          activeContextSection={lastContextSection}
          activeRecordContext={activeRecordContext}
          initialDraft={analystPromptContext}
          onOpenRecord={handleOpenLinkedRecord}
        />
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SeasonProvider>
        <AuthenticatedWorkspace />
      </SeasonProvider>
    </AuthProvider>
  );
}
