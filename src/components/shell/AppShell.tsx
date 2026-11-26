import { useEffect, useState, type ReactNode } from 'react';
import { useSeason } from '../../contexts/SeasonContext';
import type { UseGrowthAnalystSessionResult } from '../../hooks/useGrowthAnalystSession';
import { READ_ONLY_2025_MESSAGE } from '../../lib/dateIst';
import type { NavSectionId } from '../../types/overview';
import { GrowthAnalystLauncher } from '../analyst/GrowthAnalystLauncher';
import { GrowthAnalystPanel } from '../analyst/GrowthAnalystPanel';
import { SlideOverDrawer } from '../ui/SlideOverDrawer';
import { GlobalSearchModal } from './GlobalSearchModal';
import { Sidebar } from './Sidebar';
import { TopNav, type QuickAddEntityType } from './TopNav';

const QUICK_ADD_SCHEMA_META: Record<
  QuickAddEntityType,
  {
    title: string;
    fields: string[];
  }
> = {
  opportunity: {
    title: 'New sponsorship opportunity',
    fields: [
      'Sponsor organisation',
      'Campaign',
      'Cash commitment estimate',
      'In-kind valuation (separate)',
      'Stage',
      'Owner',
    ],
  },
  sponsor: {
    title: 'New sponsor organisation',
    fields: [
      'Organisation name',
      'Industry category',
      'Primary contact',
      'Owner',
      'Prior edition history',
    ],
  },
  campaign: {
    title: 'New sponsorship campaign',
    fields: [
      'Campaign name',
      'Festival edition',
      'Owner',
      'Target cash value',
      'Strategic bet',
    ],
  },
  task: {
    title: 'New execution task',
    fields: [
      'Task title',
      'Linked opportunity or campaign',
      'Assignee',
      'Due date',
    ],
  },
  collection: {
    title: 'Log cash receipt',
    fields: [
      'Confirmed partnership',
      'Receipt amount (cash only)',
      'Settlement date',
      'Reference',
    ],
  },
};

interface AppShellProps {
  activeSection: NavSectionId;
  onSelectSection: (section: NavSectionId) => void;
  onOpenAnalystWorkspace: (promptContext?: string) => void;
  analystSession: UseGrowthAnalystSessionResult;
  onOpenAnalystLinkedRecord?: (recordType: string, recordId: string) => void;
  devControlsEnabled: boolean;
  onToggleDevControls: () => void;
  children: ReactNode;
}

export function AppShell({
  activeSection,
  onSelectSection,
  onOpenAnalystWorkspace,
  analystSession,
  onOpenAnalystLinkedRecord,
  devControlsEnabled,
  onToggleDevControls,
  children,
}: AppShellProps) {
  const { isReadOnlyHistorical } = useSeason();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [analystPanelOpen, setAnalystPanelOpen] = useState(false);
  const [quickAddEntity, setQuickAddEntity] = useState<QuickAddEntityType | null>(
    null
  );

  useEffect(() => {
    if (activeSection === 'growth-analyst') {
      setAnalystPanelOpen(false);
    }
  }, [activeSection]);

  useEffect(() => {
    if (isReadOnlyHistorical && quickAddEntity) {
      setQuickAddEntity(null);
    }
  }, [isReadOnlyHistorical, quickAddEntity]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleJumpToOverviewAnchor = (anchorId: string) => {
    if (activeSection !== 'overview') {
      onSelectSection('overview');
    }
    window.setTimeout(() => {
      const el = document.getElementById(anchorId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 60);
  };

  const quickAddDetails = quickAddEntity
    ? QUICK_ADD_SCHEMA_META[quickAddEntity]
    : null;

  return (
    <div className="flex min-h-screen bg-[#F3F1EB] text-[#202824]">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={onSelectSection}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav
          activeSection={activeSection}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          onSelectQuickAdd={(entity) => {
            if (!isReadOnlyHistorical) {
              setQuickAddEntity(entity);
            }
          }}
          onNavigateSection={onSelectSection}
          devControlsEnabled={devControlsEnabled}
          onToggleDevControls={onToggleDevControls}
        />

        <main className="flex-1 px-4 pt-6 pb-24 sm:px-6 lg:px-10 lg:pt-8 lg:pb-24">
          <div className="mx-auto w-full max-w-[1220px]">{children}</div>
        </main>
      </div>

      <GrowthAnalystLauncher
        visible={activeSection !== 'growth-analyst' && !analystPanelOpen}
        onClick={() => setAnalystPanelOpen(true)}
      />

      <GrowthAnalystPanel
        open={analystPanelOpen && activeSection !== 'growth-analyst'}
        onClose={() => setAnalystPanelOpen(false)}
        contextSection={activeSection}
        session={analystSession}
        onOpenFullWorkspace={onOpenAnalystWorkspace}
        onOpenRecord={onOpenAnalystLinkedRecord}
      />

      <GlobalSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigateSection={onSelectSection}
        onJumpToOverviewAnchor={handleJumpToOverviewAnchor}
        onOpenRecord={onOpenAnalystLinkedRecord}
      />

      <SlideOverDrawer
        open={Boolean(quickAddDetails)}
        onClose={() => setQuickAddEntity(null)}
        meta="Quick add"
        title={quickAddDetails?.title ?? ''}
      >
        {quickAddDetails ? (
          <div className="space-y-5">
            <div className="rounded-md border border-dashed border-[#D9D7D0] bg-[#FAF9F6] px-4 py-3.5">
              <p className="text-[13px] text-[#525E58]">
                {isReadOnlyHistorical
                  ? READ_ONLY_2025_MESSAGE
                  : 'Use the respective workspace directory to create or edit records in this edition.'}
              </p>
            </div>

            <div>
              <p className="mb-2 text-[12px] font-medium text-[#788C83]">
                Fields
              </p>
              <ul className="divide-y divide-[#E8E6E0] rounded-md border border-[#D9D7D0] bg-white">
                {quickAddDetails.fields.map((field) => (
                  <li
                    key={field}
                    className="px-3.5 py-2.5 text-[13px] text-[#202824]"
                  >
                    {field}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </SlideOverDrawer>
    </div>
  );
}
