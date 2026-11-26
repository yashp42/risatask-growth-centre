import {
  Bell,
  ChevronDown,
  Lock,
  LogOut,
  Menu,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useSeason } from '../../contexts/SeasonContext';
import {
  READ_ONLY_2025_MESSAGE,
  formatEditionSwitcherLabel,
} from '../../lib/dateIst';
import { findNavItem } from '../../services/overviewApi';
import type { NavSectionId } from '../../types/overview';

export type QuickAddEntityType =
  | 'opportunity'
  | 'sponsor'
  | 'campaign'
  | 'task'
  | 'collection';

const QUICK_ADD_OPTIONS: ReadonlyArray<{
  id: QuickAddEntityType;
  label: string;
  hint: string;
}> = [
  {
    id: 'opportunity',
    label: 'New opportunity',
    hint: 'Add a deal record to Pipeline',
  },
  {
    id: 'sponsor',
    label: 'New sponsor',
    hint: 'Register an organisation & contact',
  },
  {
    id: 'campaign',
    label: 'New campaign',
    hint: 'Create a sponsorship initiative',
  },
  {
    id: 'task',
    label: 'New task',
    hint: 'Assign a follow-up or deliverable',
  },
  {
    id: 'collection',
    label: 'Log cash receipt',
    hint: 'Record settlement against signed deal',
  },
];

interface TopNavProps {
  activeSection: NavSectionId;
  onOpenMobileMenu: () => void;
  onOpenSearch: () => void;
  onSelectQuickAdd: (entity: QuickAddEntityType) => void;
  onNavigateSection: (section: NavSectionId) => void;
  devControlsEnabled?: boolean;
  onToggleDevControls?: () => void;
}

function formatInitials(name: string | null | undefined, fallbackId: string): string {
  const source = (name || fallbackId || 'TM').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function TopNav({
  activeSection,
  onOpenMobileMenu,
  onOpenSearch,
  onSelectQuickAdd,
  onNavigateSection,
  devControlsEnabled = false,
  onToggleDevControls,
}: TopNavProps) {
  const { member, signOut } = useAuth();
  const {
    editions,
    editionId,
    recordClass,
    asOf,
    isReadOnlyHistorical,
    setEditionId,
  } = useSeason();
  const [openMenu, setOpenMenu] = useState<'quick-add' | 'notifications' | 'profile' | null>(null);
  const [notificationTab, setNotificationTab] = useState<'all' | 'unread'>('all');
  const navRef = useRef<HTMLDivElement>(null);

  const currentNav = findNavItem(activeSection);
  const displayName = member?.full_name || member?.member_id || 'Signed in';
  const displayRoles =
    member && member.roles.length > 0 ? member.roles.join(', ') : 'no roles';
  const initials = formatInitials(member?.full_name, member?.member_id ?? '');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <header
      ref={navRef}
      className="sticky top-0 z-30 flex h-14 w-full items-center justify-between gap-3 border-b border-[#D9D7D0] bg-white px-4 sm:px-6 lg:px-8"
    >
      {/* Left zone: Mobile menu + Context breadcrumb + Global season switcher */}
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="flex lg:hidden h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#D9D7D0] text-[#202824] hover:bg-[#FAF9F6]"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
        </button>

        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="hidden xl:inline text-[#788C83] whitespace-nowrap">
            {currentNav.groupLabel}
          </span>
          <span className="hidden xl:inline text-[#D9D7D0]" aria-hidden="true">
            /
          </span>
          <span className="truncate font-medium text-[#202824]">
            {currentNav.label}
          </span>
        </nav>

        {/* Global Edition Switcher */}
        <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-[#E8E6E0]">
          <label htmlFor="global-edition-switcher" className="sr-only">
            Festival edition season context
          </label>
          <select
            id="global-edition-switcher"
            value={editionId}
            onChange={(e) => setEditionId(e.target.value)}
            aria-label="Global edition context"
            className="h-8 rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-2.5 text-[12px] font-medium text-[#202824] focus:border-[#315F52] focus:outline-none"
          >
            {editions.map((ed) => (
              <option key={ed.edition_id} value={ed.edition_id}>
                {formatEditionSwitcherLabel(ed.edition_id, ed.name)}
              </option>
            ))}
          </select>
          <span className="hidden xl:inline font-mono text-[11px] text-[#788C83] whitespace-nowrap">
            {recordClass} · as of {asOf}
          </span>
        </div>
      </div>

      {/* Right zone: Read-only/Audit notice, Search, Quick Add, Notifications, Identity & Sign out */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {isReadOnlyHistorical ? (
          <span
            className="hidden lg:inline-flex items-center gap-1.5 rounded border border-[#D9D7D0] bg-[#FAF9F6] px-2.5 py-1 text-[11px] font-medium text-[#525E58] whitespace-nowrap shrink-0"
            title={READ_ONLY_2025_MESSAGE}
          >
            <Lock className="h-3 w-3 text-[#788C83]" aria-hidden="true" />
            {READ_ONLY_2025_MESSAGE}
          </span>
        ) : (
          <span className="hidden 2xl:inline-flex items-center rounded border border-[#D9D7D0] bg-[#FAF9F6] px-2.5 py-1 text-[11px] font-medium text-[#525E58] whitespace-nowrap shrink-0">
            Demo: changes are recorded and audited
          </span>
        )}

        {/* Global search trigger */}
        <button
          type="button"
          onClick={() => {
            setOpenMenu(null);
            onOpenSearch();
          }}
          aria-label="Search sponsors, campaigns, deals and tasks"
          className="flex h-9 items-center justify-between gap-2 rounded-md border border-[#D9D7D0] bg-[#FAF9F6] px-2.5 text-[13px] text-[#788C83] transition-colors duration-150 hover:border-[#788C83] hover:text-[#202824] sm:w-36 xl:w-44"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-[#788C83]" aria-hidden="true" />
            <span className="hidden sm:inline truncate">Search...</span>
            <span className="sm:hidden">Search</span>
          </span>
          <kbd className="hidden md:inline-block font-mono text-[11px] text-[#788C83]">
            ⌘K
          </kbd>
        </button>

        {/* Quick Add menu (explicitly disabled on ED-2025) */}
        <div className="relative">
          <button
            type="button"
            disabled={isReadOnlyHistorical}
            title={isReadOnlyHistorical ? READ_ONLY_2025_MESSAGE : undefined}
            aria-expanded={!isReadOnlyHistorical && openMenu === 'quick-add'}
            aria-haspopup="menu"
            onClick={() => {
              if (isReadOnlyHistorical) return;
              setOpenMenu((prev) => (prev === 'quick-add' ? null : 'quick-add'));
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#315F52] px-3 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#264B40] disabled:cursor-not-allowed disabled:bg-[#E8E6E0] disabled:text-[#788C83] whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Quick add</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
          </button>

          {openMenu === 'quick-add' && !isReadOnlyHistorical ? (
            <div
              role="menu"
              aria-label="Quick add records"
              className="absolute right-0 mt-2 w-64 rounded-md border border-[#D9D7D0] bg-white py-1.5 shadow-md"
            >
              <div className="border-b border-[#E8E6E0] px-3 py-1.5">
                <p className="text-[11px] font-medium text-[#788C83]">
                  Create sponsorship record
                </p>
              </div>
              {QUICK_ADD_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    onSelectQuickAdd(option.id);
                  }}
                  className="flex w-full flex-col px-3 py-2 text-left transition-colors duration-150 hover:bg-[#FAF9F6]"
                >
                  <span className="text-[13px] font-medium text-[#202824]">
                    {option.label}
                  </span>
                  <span className="text-[11px] text-[#788C83]">{option.hint}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            type="button"
            aria-label="Notifications"
            aria-expanded={openMenu === 'notifications'}
            aria-haspopup="dialog"
            onClick={() =>
              setOpenMenu((prev) =>
                prev === 'notifications' ? null : 'notifications'
              )
            }
            className={`flex h-9 w-9 items-center justify-center rounded-md border transition-colors duration-150 ${
              openMenu === 'notifications'
                ? 'border-[#315F52] bg-[#EBF1EE] text-[#315F52]'
                : 'border-[#D9D7D0] bg-white text-[#525E58] hover:bg-[#FAF9F6] hover:text-[#202824]'
            }`}
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
          </button>

          {openMenu === 'notifications' ? (
            <div
              role="dialog"
              aria-label="Notifications panel"
              className="absolute right-0 mt-2 w-80 rounded-md border border-[#D9D7D0] bg-white shadow-md"
            >
              <div className="flex items-center justify-between border-b border-[#E8E6E0] px-4 py-3">
                <span className="text-[13px] font-semibold text-[#202824]">
                  Notifications
                </span>
                <div className="flex items-center gap-1 rounded border border-[#E8E6E0] bg-[#FAF9F6] p-0.5">
                  <button
                    type="button"
                    onClick={() => setNotificationTab('all')}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      notificationTab === 'all'
                        ? 'bg-white text-[#202824] shadow-xs'
                        : 'text-[#788C83] hover:text-[#202824]'
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setNotificationTab('unread')}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      notificationTab === 'unread'
                        ? 'bg-white text-[#202824] shadow-xs'
                        : 'text-[#788C83] hover:text-[#202824]'
                    }`}
                  >
                    Unread
                  </button>
                </div>
              </div>
              <div className="px-4 py-8 text-center">
                <p className="text-[13px] font-medium text-[#202824]">
                  {notificationTab === 'unread'
                    ? 'No unread notifications'
                    : 'No notifications'}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* User Profile (name & roles from GET /api/me) */}
        <div className="relative">
          <button
            type="button"
            aria-label="User profile menu"
            aria-expanded={openMenu === 'profile'}
            aria-haspopup="menu"
            onClick={() =>
              setOpenMenu((prev) => (prev === 'profile' ? null : 'profile'))
            }
            className="flex h-9 items-center gap-2 rounded-md border border-[#D9D7D0] bg-white px-2.5 text-[13px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6] shrink-0"
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#EBF1EE] text-[11px] font-semibold text-[#315F52]"
              aria-hidden="true"
            >
              {initials}
            </span>
            <span className="hidden md:flex items-center gap-1.5 whitespace-nowrap">
              <span className="max-w-[120px] truncate font-medium text-[#202824]">
                {displayName}
              </span>
              <span className="text-[#D9D7D0]" aria-hidden="true">
                ·
              </span>
              <span className="max-w-[130px] truncate font-mono text-[11px] text-[#525E58]">
                {displayRoles}
              </span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-[#788C83]" aria-hidden="true" />
          </button>

          {openMenu === 'profile' ? (
            <div
              role="menu"
              aria-label="Account options"
              className="absolute right-0 mt-2 w-72 rounded-md border border-[#D9D7D0] bg-white py-1.5 shadow-md"
            >
              <div className="border-b border-[#E8E6E0] px-3.5 py-2.5">
                <p className="text-[13px] font-semibold text-[#202824]">
                  {displayName}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-[#525E58]">
                  {member?.member_id ?? ''}
                  {member?.roles.length ? ` · ${member.roles.join(', ')}` : ''}
                </p>
                <div className="mt-2 sm:hidden">
                  <label
                    htmlFor="mobile-edition-switcher"
                    className="block text-[11px] text-[#788C83]"
                  >
                    Festival edition
                  </label>
                  <select
                    id="mobile-edition-switcher"
                    value={editionId}
                    onChange={(e) => setEditionId(e.target.value)}
                    className="mt-1 h-8 w-full rounded border border-[#D9D7D0] bg-[#FAF9F6] px-2 text-[12px]"
                  >
                    {editions.map((ed) => (
                      <option key={ed.edition_id} value={ed.edition_id}>
                        {formatEditionSwitcherLabel(ed.edition_id, ed.name)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenMenu(null);
                  onNavigateSection('team-settings');
                }}
                className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] text-[#202824] hover:bg-[#FAF9F6]"
              >
                <SlidersHorizontal
                  className="h-3.5 w-3.5 text-[#788C83]"
                  aria-hidden="true"
                />
                Team &amp; Settings
              </button>

              {import.meta.env.DEV && onToggleDevControls ? (
                <div className="mt-1 border-t border-[#E8E6E0] pt-1">
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={devControlsEnabled}
                    onClick={() => {
                      onToggleDevControls();
                      setOpenMenu(null);
                    }}
                    className="flex w-full items-center justify-between px-3.5 py-2 text-left text-[12px] text-[#525E58] hover:bg-[#FAF9F6]"
                  >
                    <span>Developer state preview</span>
                    <span className="font-mono text-[11px] text-[#315F52]">
                      {devControlsEnabled ? 'On' : 'Off'}
                    </span>
                  </button>
                </div>
              ) : null}

              <div className="mt-1 border-t border-[#E8E6E0] pt-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    void signOut();
                  }}
                  className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] text-[#991B1B] hover:bg-[#FAF9F6]"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  Sign out
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Direct Sign out button in header */}
        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#D9D7D0] bg-white px-3 text-[13px] font-medium text-[#202824] transition-colors duration-150 hover:bg-[#FAF9F6] whitespace-nowrap shrink-0"
        >
          <LogOut className="h-3.5 w-3.5 text-[#525E58]" aria-hidden="true" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
