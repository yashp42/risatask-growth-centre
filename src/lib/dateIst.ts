export const READ_ONLY_2025_MESSAGE = '2025 data is read-only';

export type CanonicalEditionId = 'ED-2026-DEMO' | 'ED-2025' | string;
export type CanonicalRecordClass = 'simulated' | 'historical_synthetic' | 'live';

/**
 * Returns today's calendar date (YYYY-MM-DD) in Asia/Kolkata (IST).
 */
export function getTodayIstIso(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // Fallback below if Intl timeZone is unavailable
  }
  const istMillis = now.getTime() + 330 * 60 * 1000;
  return new Date(istMillis).toISOString().slice(0, 10);
}

export function isIsoDateString(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function resolveRecordClassForEdition(
  editionId: string,
  fallback?: CanonicalRecordClass
): CanonicalRecordClass {
  if (editionId === 'ED-2025') return 'historical_synthetic';
  if (editionId === 'ED-2026-DEMO') return 'simulated';
  if (editionId === 'ED-2026-LIVE') return 'live';
  return fallback ?? 'simulated';
}

export function formatEditionSwitcherLabel(editionId: string, name?: string | null): string {
  if (editionId === 'ED-2026-DEMO') {
    return 'Demo season 2026-27 (simulated)';
  }
  if (editionId === 'ED-2025') {
    return '2025 (synthetic)';
  }
  return name ? `${name} (${editionId})` : editionId;
}

export function formatRecordClassDisplay(recordClass: string | null | undefined): string {
  switch (recordClass) {
    case 'simulated':
      return 'simulated';
    case 'historical_synthetic':
      return 'historical_synthetic';
    case 'live':
      return 'live';
    case 'external_research':
      return 'external_research';
    default:
      return recordClass ?? 'simulated';
  }
}

export function isHistoricalReadOnlyEdition(
  editionId: string | null | undefined,
  recordClass?: string | null
): boolean {
  return editionId === 'ED-2025' || recordClass === 'historical_synthetic';
}
