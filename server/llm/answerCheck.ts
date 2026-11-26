export interface ExtractedNumericClaim {
  raw: string;
  normalizedValue: number;
  rawNumber: number;
  decimals: number;
  kind: 'currency' | 'percent' | 'plain';
}

export interface GroundingSourceBundle {
  toolResults: unknown[];
  knowledgeTexts: string[];
  userQuestion: string;
}

export interface AnswerCheckResult {
  passed: boolean;
  claimsChecked: ExtractedNumericClaim[];
  ungroundedClaims: ExtractedNumericClaim[];
  warningMessage: string | null;
}

const MONTH_NAMES =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/**
 * Strips non-quantitative identifiers, calendar tokens, ordinals, and week labels
 * before extracting numeric claims.
 */
export function stripNonMetricTokens(text: string): string {
  let cleaned = text;

  // ISO dates & time-like stamps: 2025-04-20, 05:30 IST, 22:41 IST
  cleaned = cleaned.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
  cleaned = cleaned.replace(/\b\d{1,2}:\d{2}(?:\s*(?:IST|UTC|AM|PM))?\b/gi, ' ');

  // Dates with month names: 15 March 2025, 25 Nov 2026, 12–13 April
  cleaned = cleaned.replace(
    new RegExp(
      `\\b\\d{1,2}(?:\\s*[–-]\\s*\\d{1,2})?\\s+${MONTH_NAMES}(?:\\s+\\d{4})?\\b`,
      'gi'
    ),
    ' '
  );
  cleaned = cleaned.replace(
    new RegExp(
      `\\b${MONTH_NAMES}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`,
      'gi'
    ),
    ' '
  );

  // Known domain IDs (metrics, scenarios, KB chunks, tests, bets, decisions, assumptions, risks, editions, records)
  cleaned = cleaned.replace(
    /\b(?:M-\d{1,2}|SC-\d{1,2}|KB-\d{1,2}(?:\.\d+)?|T-\d{1,2}|K-[A-Z0-9-]+|D-\d{1,4}|AS-\d{1,2}|R-\d{1,2}|OD-\d{1,2}|ED-\d{4}(?:-[A-Z0-9]+)?|EX-[A-Z0-9-]+|B[1-5][a-b]?|V[1-3]|L[1-5]|CL-\d{1,2}|C\d{1,2}|S[1-9]\d?|F\d[a-c]?|[A-Z]{2,3}-[A-Z0-9]{4,}|[O]\d{3}|SC0\d)\b/gi,
    ' '
  );

  // Week & countdown labels: W1..W12, W-5..W0, T-7, T−7, T-0
  cleaned = cleaned.replace(/\b(?:W-?\d{1,2}|T[−-]\d{1,2})\b/gi, ' ');

  // Standalone years (2024..2027, 2000s, 2007, 2008, 2011, 2013 often appear in dates/benchmarks, wait keep 2024-2027 strictly masked)
  cleaned = cleaned.replace(/\b202[4-7]\b/g, ' ');

  // Ordinals: 1st, 2nd, 3rd, 4th, etc.
  cleaned = cleaned.replace(/\b\d+(?:st|nd|rd|th)\b/gi, ' ');

  return cleaned;
}

function countDecimals(numText: string): number {
  const clean = numText.replace(/,/g, '');
  const dot = clean.indexOf('.');
  return dot === -1 ? 0 : Math.min(4, clean.length - dot - 1);
}

/**
 * Extracts quantitative claims from free text.
 */
export function extractNumericClaims(text: string): ExtractedNumericClaim[] {
  const masked = stripNonMetricTokens(text);
  const claims: ExtractedNumericClaim[] = [];
  const consumedSpans: Array<{ start: number; end: number }> = [];

  const overlaps = (start: number, end: number) =>
    consumedSpans.some((s) => start < s.end && end > s.start);

  // 1. Currency amounts with optional lakh / crore suffix: ₹22.4L, ₹26.10 lakh, ₹92,500
  const currencyRe =
    /(?:₹|INR\s*)([0-9][0-9,]*(?:\.[0-9]+)?)\s*(cr(?:ore)?s?|lakhs?|L)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = currencyRe.exec(masked)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    consumedSpans.push({ start, end });
    const rawNumber = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(rawNumber)) continue;
    const suffix = (m[2] ?? '').toLowerCase();
    const mult = suffix.startsWith('cr')
      ? 10_000_000
      : suffix.startsWith('l')
        ? 100_000
        : 1;
    claims.push({
      raw: m[0].trim(),
      rawNumber,
      normalizedValue: rawNumber * mult,
      decimals: countDecimals(m[1]),
      kind: 'currency',
    });
  }

  // 2. Percentages: 61%, 85.0%, 3.6%
  const percentRe = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*%/g;
  while ((m = percentRe.exec(masked)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (overlaps(start, end)) continue;
    consumedSpans.push({ start, end });
    const rawNumber = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(rawNumber)) continue;
    claims.push({
      raw: m[0].trim(),
      rawNumber,
      normalizedValue: rawNumber,
      decimals: countDecimals(m[1]),
      kind: 'percent',
    });
  }

  // 3. Numbers with explicit lakh / crore suffix without ₹: 22.4L, 26.1 lakh
  const lakhRe = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(cr(?:ore)?s?|lakhs?|L)\b/gi;
  while ((m = lakhRe.exec(masked)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (overlaps(start, end)) continue;
    consumedSpans.push({ start, end });
    const rawNumber = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(rawNumber)) continue;
    const suffix = m[2].toLowerCase();
    const mult = suffix.startsWith('cr') ? 10_000_000 : 100_000;
    claims.push({
      raw: m[0].trim(),
      rawNumber,
      normalizedValue: rawNumber * mult,
      decimals: countDecimals(m[1]),
      kind: 'currency',
    });
  }

  // 4. Remaining plain numbers
  const plainRe = /\b([0-9][0-9,]*(?:\.[0-9]+)?)\b/g;
  while ((m = plainRe.exec(masked)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (overlaps(start, end)) continue;
    const rawNumber = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(rawNumber)) continue;
    claims.push({
      raw: m[0].trim(),
      rawNumber,
      normalizedValue: rawNumber,
      decimals: countDecimals(m[1]),
      kind: 'plain',
    });
  }

  return claims;
}

function collectNumbersFromUnknown(node: unknown, out: Set<number>): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'number') {
    if (Number.isFinite(node)) {
      out.add(node);
    }
    return;
  }
  if (typeof node === 'string') {
    for (const c of extractNumericClaims(node)) {
      out.add(c.normalizedValue);
      out.add(c.rawNumber);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectNumbersFromUnknown(item, out);
    }
    return;
  }
  if (typeof node === 'object') {
    for (const val of Object.values(node as Record<string, unknown>)) {
      collectNumbersFromUnknown(val, out);
    }
  }
}

function approxEqualAtDecimals(
  candidate: number,
  claimVal: number,
  decimals: number
): boolean {
  if (!Number.isFinite(candidate) || !Number.isFinite(claimVal)) return false;
  const factor = 10 ** Math.min(4, Math.max(0, decimals));
  const roundedCandidate = Math.round((candidate + Number.EPSILON) * factor) / factor;
  const roundedClaim = Math.round((claimVal + Number.EPSILON) * factor) / factor;
  if (Math.abs(roundedCandidate - roundedClaim) <= 0.5 / factor + 1e-9) {
    return true;
  }
  // Allow nearest integer rounding differences (e.g. 22.43 -> 22.4)
  const tolerance = Math.max(0.5 / factor, Math.abs(claimVal) * 0.002);
  return Math.abs(candidate - claimVal) <= tolerance;
}

function claimMatchesAnyGround(
  claim: ExtractedNumericClaim,
  groundNumbers: ReadonlySet<number>,
  questionNumbers: ReadonlySet<number>
): boolean {
  // Ignore numbers quoted from the user question
  for (const qVal of questionNumbers) {
    if (
      approxEqualAtDecimals(qVal, claim.normalizedValue, claim.decimals) ||
      approxEqualAtDecimals(qVal, claim.rawNumber, claim.decimals)
    ) {
      return true;
    }
  }

  for (const gVal of groundNumbers) {
    // 1. Direct match on normalized or raw value
    if (
      approxEqualAtDecimals(gVal, claim.normalizedValue, claim.decimals) ||
      approxEqualAtDecimals(gVal, claim.rawNumber, claim.decimals)
    ) {
      return true;
    }

    // 2. Lakh / Crore conversion: e.g. DB returns 2240000 (INR) and answer writes ₹22.4L (rawNumber 22.4)
    if (claim.kind === 'currency' || claim.kind === 'plain') {
      if (
        approxEqualAtDecimals(gVal / 100_000, claim.rawNumber, claim.decimals) ||
        approxEqualAtDecimals(gVal * 100_000, claim.normalizedValue, claim.decimals) ||
        approxEqualAtDecimals(gVal / 10_000_000, claim.rawNumber, claim.decimals) ||
        approxEqualAtDecimals(gVal * 10_000_000, claim.normalizedValue, claim.decimals)
      ) {
        return true;
      }
    }

    // 3. Ratio -> Percentage conversion: DB ratio 0.6071 and answer writes 61% or 60.7%
    if (claim.kind === 'percent' && gVal >= 0 && gVal <= 1.5) {
      if (approxEqualAtDecimals(gVal * 100, claim.rawNumber, claim.decimals)) {
        return true;
      }
    }
    if (claim.kind === 'plain' && claim.rawNumber <= 1.5 && gVal > 1.5 && gVal <= 150) {
      if (approxEqualAtDecimals(gVal / 100, claim.rawNumber, claim.decimals)) {
        return true;
      }
    }
  }

  return false;
}

export function verifyAnswerNumbers(
  answerText: string,
  bundle: GroundingSourceBundle
): AnswerCheckResult {
  const claims = extractNumericClaims(answerText);
  if (claims.length === 0) {
    return {
      passed: true,
      claimsChecked: [],
      ungroundedClaims: [],
      warningMessage: null,
    };
  }

  const groundNumbers = new Set<number>();
  collectNumbersFromUnknown(bundle.toolResults, groundNumbers);
  for (const txt of bundle.knowledgeTexts) {
    for (const c of extractNumericClaims(txt)) {
      groundNumbers.add(c.normalizedValue);
      groundNumbers.add(c.rawNumber);
    }
  }

  const questionNumbers = new Set<number>();
  for (const c of extractNumericClaims(bundle.userQuestion)) {
    questionNumbers.add(c.normalizedValue);
    questionNumbers.add(c.rawNumber);
  }

  const ungroundedClaims = claims.filter(
    (claim) => !claimMatchesAnyGround(claim, groundNumbers, questionNumbers)
  );

  if (ungroundedClaims.length === 0) {
    return {
      passed: true,
      claimsChecked: claims,
      ungroundedClaims: [],
      warningMessage: null,
    };
  }

  const labels = Array.from(new Set(ungroundedClaims.map((c) => c.raw)));
  return {
    passed: false,
    claimsChecked: claims,
    ungroundedClaims,
    warningMessage: `These figures could not be verified: ${labels.join(', ')}`,
  };
}
