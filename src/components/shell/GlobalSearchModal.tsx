import { AlertCircle, ArrowRight, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSeason } from '../../contexts/SeasonContext';
import { apiFetch } from '../../services/authSession';
import {
  OVERVIEW_API_ENDPOINTS,
  SETTINGS_NAV_ITEM,
  SIDEBAR_NAV_GROUPS,
} from '../../services/overviewApi';
import type { NavSectionId } from '../../types/overview';

type SearchScope = 'all' | 'sponsors' | 'campaigns' | 'deals' | 'tasks';

const SEARCH_SCOPES: ReadonlyArray<{ id: SearchScope; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'sponsors', label: 'Sponsors' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'deals', label: 'Deals' },
  { id: 'tasks', label: 'Tasks' },
];

const OVERVIEW_SECTION_ANCHORS: ReadonlyArray<{
  id: string;
  label: string;
  subtitle: string;
}> = [
  { id: 'section-pulse', label: 'Growth pulse', subtitle: 'Overview · Headline metrics' },
  { id: 'section-funnel', label: 'Sponsorship growth funnel', subtitle: 'Overview · Stage progression' },
  { id: 'section-pacing', label: 'Target pacing', subtitle: 'Overview · Scenarios & cash gate' },
  { id: 'section-campaigns', label: 'Campaign performance', subtitle: 'Overview · Sortable table' },
  { id: 'section-attention', label: 'Needs attention queue', subtitle: 'Overview · Priority feed' },
  { id: 'section-bets', label: 'Strategic bets', subtitle: 'Overview · Rules & thresholds' },
  { id: 'section-team', label: 'Team execution', subtitle: 'Overview · Tasks & capacity' },
];

interface SearchEntityResult {
  type: 'sponsor' | 'campaign' | 'opportunity' | 'task';
  section: NavSectionId;
  id: string;
  title: string;
  subtitle: string | null;
  edition_id: string;
  record_class: string;
}

interface GlobalSearchModalProps {
  open: boolean;
  onClose: () => void;
  onNavigateSection: (section: NavSectionId) => void;
  onJumpToOverviewAnchor: (anchorId: string) => void;
  onOpenRecord?: (recordType: string, recordId: string) => void;
}

export function GlobalSearchModal({
  open,
  onClose,
  onNavigateSection,
  onJumpToOverviewAnchor,
  onOpenRecord,
}: GlobalSearchModalProps) {
  const { editionId, recordClass } = useSeason();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [results, setResults] = useState<SearchEntityResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setErrorMessage(null);
      return;
    }

    const controller = new AbortController();
    const debounce = window.setTimeout(async () => {
      setLoading(true);
      setErrorMessage(null);
      try {
        const params = new URLSearchParams({
          q: trimmed,
          editionId,
          edition_id: editionId,
          record_class: recordClass,
        });
        const resp = await apiFetch(
          `${OVERVIEW_API_ENDPOINTS.globalSearch}?${params.toString()}`,
          {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          }
        );
        const ct = resp.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) {
          throw new Error(`Search service unavailable (HTTP ${resp.status})`);
        }
        const payload = (await resp.json()) as {
          results?: SearchEntityResult[];
          message?: string;
        };
        if (!resp.ok) {
          throw new Error(
            payload.message || `Search failed (HTTP ${resp.status})`
          );
        }
        setResults(Array.isArray(payload.results) ? payload.results : []);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setErrorMessage(
          err instanceof Error ? err.message : 'Unable to search records.'
        );
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(debounce);
      controller.abort();
    };
  }, [open, query, editionId, recordClass]);

  const filteredEntityResults = useMemo(() => {
    if (scope === 'all') return results;
    if (scope === 'sponsors') return results.filter((r) => r.type === 'sponsor');
    if (scope === 'campaigns') return results.filter((r) => r.type === 'campaign');
    if (scope === 'deals') return results.filter((r) => r.type === 'opportunity');
    if (scope === 'tasks') return results.filter((r) => r.type === 'task');
    return results;
  }, [results, scope]);

  const workspaceMatches = useMemo(() => {
    const allModules = [
      ...SIDEBAR_NAV_GROUPS.flatMap((g) => g.items),
      SETTINGS_NAV_ITEM,
    ];
    const q = query.trim().toLowerCase();
    const matchedModules = allModules.filter(
      (item) =>
        !q ||
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
    );
    const matchedAnchors = OVERVIEW_SECTION_ANCHORS.filter(
      (anchor) =>
        !q ||
        anchor.label.toLowerCase().includes(q) ||
        anchor.subtitle.toLowerCase().includes(q)
    );
    return { matchedModules, matchedAnchors };
  }, [query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-16 sm:pt-24"
      role="dialog"
      aria-modal="true"
      aria-label="Global workspace search"
    >
      <div
        className="fixed inset-0 bg-[#202824]/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-md border border-[#D9D7D0] bg-white shadow-xl">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-[#D9D7D0] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-[#788C83]" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search sponsors, campaigns, deals, tasks (${editionId})...`}
            className="w-full bg-transparent text-[14px] text-[#202824] placeholder:text-[#788C83] focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-[12px] font-medium text-[#788C83] hover:text-[#202824]"
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#788C83] hover:bg-[#FAF9F6] hover:text-[#202824]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scope filter bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8E6E0] bg-[#FAF9F6] px-4 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {SEARCH_SCOPES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setScope(item.id)}
                className={`rounded px-2.5 py-1 text-[12px] font-medium transition-colors duration-150 ${
                  scope === item.id
                    ? 'bg-[#315F52] text-white'
                    : 'text-[#525E58] hover:bg-white hover:text-[#202824]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="font-mono text-[11px] text-[#788C83]">
            {editionId} · {recordClass}
          </span>
        </div>

        {/* Results */}
        <div className="max-h-[420px] overflow-y-auto divide-y divide-[#E8E6E0]">
          {/* Entity search results from GET /api/search */}
          <div className="px-4 py-3">
            {!query.trim() ? (
              <p className="text-[12px] text-[#788C83]">
                Type to search live records in {editionId}.
              </p>
            ) : loading ? (
              <p className="text-[13px] text-[#525E58]">Searching records...</p>
            ) : errorMessage ? (
              <div className="flex items-center gap-2 text-[12px] text-[#9B3B32]">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{errorMessage}</span>
              </div>
            ) : filteredEntityResults.length > 0 ? (
              <div className="space-y-1">
                <p className="mb-1.5 text-[11px] font-medium text-[#788C83]">
                  Matching records
                </p>
                {filteredEntityResults.map((item) => (
                  <button
                    key={`${item.type}-${item.id}`}
                    type="button"
                    onClick={() => {
                      if (onOpenRecord) {
                        onOpenRecord(item.type, item.id);
                      } else {
                        onNavigateSection(item.section);
                      }
                      onClose();
                    }}
                    className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left transition-colors duration-150 hover:bg-[#FAF9F6]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-[#202824]">
                        {item.title}
                      </p>
                      <p className="truncate text-[11px] text-[#788C83]">
                        {item.type} · {item.id}
                        {item.subtitle ? ` · ${item.subtitle}` : ''}
                      </p>
                    </div>
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 text-[#788C83]"
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[13px] font-medium text-[#202824]">
                No matching {scope === 'all' ? 'records' : scope}
              </p>
            )}
          </div>

          {/* Local Overview section jumps */}
          {scope === 'all' && workspaceMatches.matchedAnchors.length > 0 ? (
            <div className="px-4 py-3">
              <p className="mb-2 text-[11px] font-medium text-[#788C83]">
                Overview sections
              </p>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {workspaceMatches.matchedAnchors.map((anchor) => (
                  <button
                    key={anchor.id}
                    type="button"
                    onClick={() => {
                      onJumpToOverviewAnchor(anchor.id);
                      onClose();
                    }}
                    className="flex items-center justify-between rounded px-2.5 py-2 text-left transition-colors duration-150 hover:bg-[#FAF9F6]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-[#202824]">
                        {anchor.label}
                      </p>
                      <p className="truncate text-[11px] text-[#788C83]">
                        {anchor.subtitle}
                      </p>
                    </div>
                    <ArrowRight
                      className="h-3.5 w-3.5 shrink-0 text-[#788C83]"
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Workspace module navigation */}
          {workspaceMatches.matchedModules.length > 0 ? (
            <div className="px-4 py-3">
              <p className="mb-2 text-[11px] font-medium text-[#788C83]">
                Workspace navigation
              </p>
              <div className="space-y-1">
                {workspaceMatches.matchedModules.slice(0, 5).map((mod) => (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => {
                      onNavigateSection(mod.id);
                      onClose();
                    }}
                    className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left transition-colors duration-150 hover:bg-[#FAF9F6]"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-[#202824]">
                        {mod.label}
                      </p>
                      <p className="truncate text-[12px] text-[#525E58]">
                        {mod.description}
                      </p>
                    </div>
                    <span className="ml-3 shrink-0 font-mono text-[11px] text-[#788C83]">
                      {mod.groupLabel}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
