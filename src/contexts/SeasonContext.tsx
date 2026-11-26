import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  formatEditionSwitcherLabel,
  getTodayIstIso,
  isHistoricalReadOnlyEdition,
  isIsoDateString,
  resolveRecordClassForEdition,
  type CanonicalRecordClass,
} from '../lib/dateIst';
import { apiFetch } from '../services/authSession';
import { useAuth } from './AuthContext';

export interface FestivalEditionRow {
  edition_id: string;
  name: string;
  record_class: CanonicalRecordClass;
  starts_at: string | null;
  season_start: string | null;
  preseason_start: string | null;
  is_current: boolean;
}

const DEFAULT_FALLBACK_EDITIONS: ReadonlyArray<FestivalEditionRow> = [
  {
    edition_id: 'ED-2026-DEMO',
    name: 'Demo season 2026-27',
    record_class: 'simulated',
    starts_at: null,
    season_start: null,
    preseason_start: null,
    is_current: true,
  },
  {
    edition_id: 'ED-2025',
    name: 'CampusFest 2025',
    record_class: 'historical_synthetic',
    starts_at: null,
    season_start: null,
    preseason_start: null,
    is_current: false,
  },
];

async function fetchEditionsFromApi(): Promise<FestivalEditionRow[]> {
  const response = await apiFetch('/api/editions', {
    headers: { Accept: 'application/json' },
  });
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`GET /api/editions returned non-JSON (${response.status})`);
  }
  const body = (await response.json()) as
    | FestivalEditionRow[]
    | { editions?: FestivalEditionRow[]; message?: string };
  if (!response.ok) {
    const msg =
      !Array.isArray(body) && body.message
        ? body.message
        : `Unable to load festival editions (HTTP ${response.status}).`;
    throw new Error(msg);
  }
  const rows = Array.isArray(body) ? body : body.editions ?? [];
  return rows.map((row) => ({
    edition_id: String(row.edition_id),
    name: String(row.name ?? row.edition_id),
    record_class: resolveRecordClassForEdition(
      String(row.edition_id),
      row.record_class
    ),
    starts_at: row.starts_at ? String(row.starts_at).slice(0, 10) : null,
    season_start: row.season_start ? String(row.season_start).slice(0, 10) : null,
    preseason_start: row.preseason_start
      ? String(row.preseason_start).slice(0, 10)
      : null,
    is_current: Boolean(row.is_current),
  }));
}

function readInitialUrlSeasonState(): {
  editionId: string;
  recordClass: CanonicalRecordClass;
  asOf: string;
} {
  const todayIst = getTodayIstIso();
  if (typeof window === 'undefined') {
    return {
      editionId: 'ED-2026-DEMO',
      recordClass: 'simulated',
      asOf: todayIst,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const urlEdition = params.get('editionId') || params.get('edition_id');
  const urlClass = params.get('recordClass') || params.get('record_class');
  const urlAsOf = params.get('asOf') || params.get('as_of');

  const editionId =
    urlEdition === 'ED-2025' || urlEdition === 'ED-2026-DEMO' || urlEdition
      ? urlEdition
      : 'ED-2026-DEMO';
  const recordClass = resolveRecordClassForEdition(
    editionId,
    urlClass === 'historical_synthetic' || urlClass === 'simulated' || urlClass === 'live'
      ? urlClass
      : undefined
  );
  const asOf = isIsoDateString(urlAsOf) ? urlAsOf : todayIst;

  return { editionId, recordClass, asOf };
}

function syncSeasonToUrl(
  editionId: string,
  recordClass: CanonicalRecordClass,
  asOf: string,
  replace = true
): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('editionId', editionId);
  url.searchParams.set('recordClass', recordClass);
  url.searchParams.set('asOf', asOf);
  if (replace) {
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } else {
    window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }
}

export interface SeasonContextValue {
  editions: FestivalEditionRow[];
  activeEdition: FestivalEditionRow | null;
  editionId: string;
  recordClass: CanonicalRecordClass;
  asOf: string;
  isReadOnlyHistorical: boolean;
  editionsLoading: boolean;
  editionsError: string | null;
  setEditionId: (nextEditionId: string) => void;
  setEditionAndClass: (
    nextEditionId: string,
    nextRecordClass?: CanonicalRecordClass
  ) => void;
  setAsOf: (nextAsOf: string) => void;
  resetToDefault: () => void;
  refetchEditions: () => void;
  editionDisplayLabel: string;
}

const SeasonContext = createContext<SeasonContextValue | null>(null);

export function SeasonProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const initial = useMemo(() => readInitialUrlSeasonState(), []);
  const [editionId, setEditionIdState] = useState<string>(initial.editionId);
  const [recordClass, setRecordClassState] = useState<CanonicalRecordClass>(
    initial.recordClass
  );
  const [asOf, setAsOfState] = useState<string>(initial.asOf);

  const editionsQuery = useQuery({
    queryKey: ['editions'],
    queryFn: fetchEditionsFromApi,
    enabled: status === 'authenticated',
    staleTime: 60_000,
  });

  const editions = useMemo<FestivalEditionRow[]>(() => {
    const data = editionsQuery.data;
    if (data && data.length > 0) {
      return data;
    }
    return [...DEFAULT_FALLBACK_EDITIONS];
  }, [editionsQuery.data]);

  // Keep URL synced on mount and popstate
  useEffect(() => {
    syncSeasonToUrl(editionId, recordClass, asOf, true);
  }, [editionId, recordClass, asOf]);

  useEffect(() => {
    const handlePopState = () => {
      const next = readInitialUrlSeasonState();
      setEditionIdState(next.editionId);
      setRecordClassState(next.recordClass);
      setAsOfState(next.asOf);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Ensure editionId aligns to a loaded festival_edition row when /api/editions resolves
  useEffect(() => {
    if (!editionsQuery.data || editionsQuery.data.length === 0) return;
    const matched = editionsQuery.data.find((e) => e.edition_id === editionId);
    if (matched) {
      if (matched.record_class !== recordClass) {
        setRecordClassState(matched.record_class);
      }
      return;
    }
    const preferred =
      editionsQuery.data.find((e) => e.edition_id === 'ED-2026-DEMO') ??
      editionsQuery.data.find((e) => e.is_current) ??
      editionsQuery.data[0];
    if (preferred) {
      setEditionIdState(preferred.edition_id);
      setRecordClassState(preferred.record_class);
    }
  }, [editionsQuery.data, editionId, recordClass]);

  const setEditionAndClass = useCallback(
    (nextEditionId: string, nextRecordClass?: CanonicalRecordClass) => {
      const matched = editions.find((e) => e.edition_id === nextEditionId);
      const resolvedClass = matched
        ? matched.record_class
        : resolveRecordClassForEdition(nextEditionId, nextRecordClass);
      setEditionIdState(nextEditionId);
      setRecordClassState(resolvedClass);
    },
    [editions]
  );

  const setEditionId = useCallback(
    (nextEditionId: string) => {
      setEditionAndClass(nextEditionId);
    },
    [setEditionAndClass]
  );

  const setAsOf = useCallback((nextAsOf: string) => {
    if (isIsoDateString(nextAsOf)) {
      setAsOfState(nextAsOf);
    }
  }, []);

  const resetToDefault = useCallback(() => {
    const todayIst = getTodayIstIso();
    const defaultRow =
      editions.find((e) => e.edition_id === 'ED-2026-DEMO') ??
      editions.find((e) => e.is_current) ??
      editions[0];
    const nextEdition = defaultRow?.edition_id ?? 'ED-2026-DEMO';
    const nextClass = defaultRow?.record_class ?? 'simulated';
    setEditionIdState(nextEdition);
    setRecordClassState(nextClass);
    setAsOfState(todayIst);
  }, [editions]);

  const activeEdition = useMemo(
    () => editions.find((e) => e.edition_id === editionId) ?? null,
    [editions, editionId]
  );

  const isReadOnlyHistorical = isHistoricalReadOnlyEdition(editionId, recordClass);
  const editionDisplayLabel = formatEditionSwitcherLabel(
    editionId,
    activeEdition?.name
  );

  const value = useMemo<SeasonContextValue>(
    () => ({
      editions,
      activeEdition,
      editionId,
      recordClass,
      asOf,
      isReadOnlyHistorical,
      editionsLoading: editionsQuery.isLoading,
      editionsError:
        editionsQuery.error instanceof Error ? editionsQuery.error.message : null,
      setEditionId,
      setEditionAndClass,
      setAsOf,
      resetToDefault,
      refetchEditions: () => {
        void editionsQuery.refetch();
      },
      editionDisplayLabel,
    }),
    [
      editions,
      activeEdition,
      editionId,
      recordClass,
      asOf,
      isReadOnlyHistorical,
      editionsQuery,
      setEditionId,
      setEditionAndClass,
      setAsOf,
      resetToDefault,
      editionDisplayLabel,
    ]
  );

  return (
    <SeasonContext.Provider value={value}>{children}</SeasonContext.Provider>
  );
}

export function useSeason(): SeasonContextValue {
  const ctx = useContext(SeasonContext);
  if (!ctx) {
    throw new Error('useSeason must be used inside SeasonProvider');
  }
  return ctx;
}
