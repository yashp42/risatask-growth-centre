export type GateEvaluationStatus =
  | 'on plan'
  | 'base trajectory: trigger B3/B4 contingencies'
  | 'below base gate'
  | 're-plan to downside'
  | 'unavailable';

export interface WeekEndEntry {
  week: number;
  period: string;
  week_end: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns today's calendar date in Asia/Kolkata (IST) as YYYY-MM-DD.
 */
export function getTodayIstIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Pure calendar arithmetic on YYYY-MM-DD without local timezone drift.
 */
export function addDaysIso(isoDate: string, deltaDays: number): string {
  if (!isValidIsoDate(isoDate)) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = String(dt.getUTCFullYear()).padStart(4, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Week n ends on season_start + (7 * n - 1) days in IST calendar dates.
 * Example: season_start = 2026-10-26 -> W1 end = 2026-11-01, W4 end = 2026-11-22.
 */
export function computeWeekEndDates(
  seasonStartIso: string,
  maxWeek = 10
): WeekEndEntry[] {
  const result: WeekEndEntry[] = [];
  for (let week = 1; week <= maxWeek; week += 1) {
    result.push({
      week,
      period: `W${week}`,
      week_end: addDaysIso(seasonStartIso, 7 * week - 1),
    });
  }
  return result;
}

/**
 * Evaluates cumulative signed value against base (SC-01) and plan (SC-02) pacing gates.
 */
export function computeGateStatus(
  value: number | null,
  baseGate: number | null,
  planGate: number | null
): GateEvaluationStatus {
  if (
    value === null ||
    !Number.isFinite(value) ||
    baseGate === null ||
    !Number.isFinite(baseGate) ||
    planGate === null ||
    !Number.isFinite(planGate)
  ) {
    return 'unavailable';
  }
  if (value >= planGate) {
    return 'on plan';
  }
  if (value >= baseGate) {
    return 'base trajectory: trigger B3/B4 contingencies';
  }
  if (value >= 0.8 * baseGate) {
    return 'below base gate';
  }
  return 're-plan to downside';
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Extracts a YYYY-MM-DD calendar date in IST from a timestamp string or Date object.
 */
export function extractIstDateFromTimestamp(
  value: string | Date | null | undefined
): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (isValidIsoDate(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return getTodayIstIso(parsed);
    }
    const prefix = trimmed.slice(0, 10);
    return isValidIsoDate(prefix) ? prefix : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return getTodayIstIso(value);
  }
  return null;
}

/**
 * Formats YYYY-MM-DD into e.g. "2 Jan 2027" for user-facing server messages.
 */
export function formatShortDisplayDate(isoDate: string): string {
  if (!isValidIsoDate(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-').map(Number);
  const monthLabel = SHORT_MONTHS[m - 1] ?? String(m);
  return `${d} ${monthLabel} ${y}`;
}

export function computeCashGateStatus(
  value: number | null,
  gateValue: number | null,
  options?: {
    asOf?: string | null;
    dueDate?: string | null;
    isHistorical?: boolean;
  }
): string {
  if (
    !options?.isHistorical &&
    options?.dueDate &&
    options?.asOf &&
    options.asOf < options.dueDate
  ) {
    return `Not yet due: evaluated on ${formatShortDisplayDate(options.dueDate)}`;
  }
  if (
    value === null ||
    !Number.isFinite(value) ||
    gateValue === null ||
    !Number.isFinite(gateValue)
  ) {
    return 'unavailable';
  }
  if (value >= gateValue) {
    return 'keep';
  }
  return 'escalate';
}
