import type { DetectedDateFormat, NormalizedDate } from '@kynox/shared-types';

/**
 * Source-independent Date Normalization Engine.
 *
 * Detects a wide range of date encodings (slash / dash / dot D-M / M-D, ISO,
 * compact YYYYMMDD, Excel serials, ISO timestamps with timezone, English and
 * Arabic textual months), normalizes them to ISO, and — crucially — resolves
 * DD/MM vs MM/DD ambiguity from *column* evidence rather than guessing on a
 * single value. Original values and detected formats are always preserved.
 *
 * The internal system-of-record is ISO (YYYY-MM-DD for dates, full ISO 8601
 * for date-times). UI display formatting is a separate concern (see
 * `formatDisplayDate`).
 */

/** Excel serial date epoch (1899-12-30, accounting for the 1900 leap-year bug). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

export type LocalePreference = 'DMY' | 'MDY';

export interface DateNormalizeOptions {
  /** Forced day/month order, e.g. from column detection or user selection. */
  order?: LocalePreference;
  /** Forced format from column detection (wins over per-value guessing). */
  format?: DetectedDateFormat;
  sourceColumnName?: string | null;
  sourceRowNumber?: number | null;
  /** Reject dates after "now" as out-of-range (kept as a warning by default). */
  now?: Date;
}

const EN_MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
// Gregorian month names as commonly written in Arabic.
const AR_MONTHS: Record<string, number> = {
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4, 'مايو': 5,
  'يونيو': 6, 'يوليو': 7, 'أغسطس': 8, 'اغسطس': 8, 'سبتمبر': 9, 'أكتوبر': 10,
  'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
};

function base(opts: DateNormalizeOptions, raw: string | number | null): NormalizedDate {
  return {
    originalDateValue: raw,
    normalizedDate: null,
    detectedDateFormat: 'UNKNOWN',
    dateParsingStatus: 'invalid',
    dateParsingConfidence: 0,
    timezoneDetected: null,
    parsingWarnings: [],
    sourceRowNumber: opts.sourceRowNumber ?? null,
    sourceColumnName: opts.sourceColumnName ?? null,
  };
}

function validYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < MIN_YEAR || y > MAX_YEAR) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function fromExcelSerial(n: number): string | null {
  if (!(n > 60 && n < 80000)) return null;     // ~1900-03..2118, below-60 excluded (leap bug zone)
  const d = new Date(EXCEL_EPOCH_MS + Math.floor(n) * 86_400_000);
  const y = d.getUTCFullYear();
  if (y < MIN_YEAR || y > MAX_YEAR) return null;
  return d.toISOString().slice(0, 10);
}

/** Normalizes one value. When `order`/`format` is supplied it is trusted. */
export function normalizeDateValue(raw: unknown, opts: DateNormalizeOptions = {}): NormalizedDate {
  const out = base(opts, (typeof raw === 'number' || typeof raw === 'string') ? raw : (raw == null ? null : String(raw)));
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    out.dateParsingStatus = 'empty';
    return out;
  }

  // Date object (some XLSX parsers hand these back).
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return out;
    out.normalizedDate = raw.toISOString().slice(0, 10);
    out.detectedDateFormat = 'ISO_TIMESTAMP';
    out.dateParsingStatus = 'parsed';
    out.dateParsingConfidence = 1;
    return out;
  }

  // Numeric → Excel serial (only when clearly a date-range serial).
  if (typeof raw === 'number') {
    const isoDate = fromExcelSerial(raw);
    if (isoDate) {
      out.normalizedDate = isoDate;
      out.detectedDateFormat = 'EXCEL_SERIAL';
      out.dateParsingStatus = 'parsed';
      out.dateParsingConfidence = 0.9;
      if (!Number.isInteger(raw)) out.parsingWarnings.push('Excel serial had a time fraction; time-of-day was dropped.');
      return out;
    }
    out.parsingWarnings.push('Numeric value is outside the Excel date-serial range; not treated as a date.');
    return out;
  }

  const s = String(raw).trim();

  // ISO timestamp (with or without timezone).
  const isoTs = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (isoTs) {
    const [, y, m, d] = isoTs;
    if (validYmd(+y, +m, +d)) {
      const tz = isoTs[7] ?? null;
      out.normalizedDate = new Date(s.replace(' ', 'T') + (tz ? '' : 'Z')).toISOString();
      out.detectedDateFormat = tz ? 'ISO_TIMESTAMP_TZ' : 'ISO_TIMESTAMP';
      out.timezoneDetected = tz;
      out.dateParsingStatus = 'parsed';
      out.dateParsingConfidence = 1;
      return finalizeRange(out, opts);
    }
  }

  // Textual month (English / Arabic): "22 Jul 2026", "July 22, 2026", "22 يوليو 2026".
  const textual = parseTextualMonth(s);
  if (textual) {
    if (validYmd(textual.y, textual.m, textual.d)) {
      out.normalizedDate = iso(textual.y, textual.m, textual.d);
      out.detectedDateFormat = 'TEXT_MONTH';
      out.dateParsingStatus = 'parsed';
      out.dateParsingConfidence = 0.95;
      return finalizeRange(out, opts);
    }
    out.parsingWarnings.push('Recognised a month name but the day/year was invalid.');
    return out;
  }

  // ISO date (unambiguous) YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD.
  const isoDate = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoDate && validYmd(+isoDate[1], +isoDate[2], +isoDate[3])) {
    out.normalizedDate = iso(+isoDate[1], +isoDate[2], +isoDate[3]);
    out.detectedDateFormat = s.includes('/') ? 'YYYY/MM/DD' : s.includes('.') ? 'YYYY.MM.DD' : 'YYYY-MM-DD';
    out.dateParsingStatus = 'parsed';
    out.dateParsingConfidence = 1;
    return finalizeRange(out, opts);
  }

  // Compact 8-digit: YYYYMMDD (unambiguous) or DDMMYYYY/MMDDYYYY (needs order).
  const eight = s.match(/^(\d{8})$/);
  if (eight) {
    const g = eight[1];
    const yFirst = { y: +g.slice(0, 4), m: +g.slice(4, 6), d: +g.slice(6, 8) };
    if (validYmd(yFirst.y, yFirst.m, yFirst.d)) {
      out.normalizedDate = iso(yFirst.y, yFirst.m, yFirst.d);
      out.detectedDateFormat = 'YYYYMMDD';
      out.dateParsingStatus = 'parsed';
      out.dateParsingConfidence = 1;
      return finalizeRange(out, opts);
    }
    // DDMMYYYY vs MMDDYYYY
    const a = +g.slice(0, 2), b = +g.slice(2, 4), y = +g.slice(4, 8);
    return resolveDayMonth(out, opts, a, b, y, 'DDMMYYYY', 'MMDDYYYY');
  }

  // Excel serial delivered as text.
  if (/^\d{5}$/.test(s)) {
    const isoS = fromExcelSerial(Number(s));
    if (isoS) {
      out.normalizedDate = isoS;
      out.detectedDateFormat = 'EXCEL_SERIAL';
      out.dateParsingStatus = 'parsed';
      out.dateParsingConfidence = 0.85;
      return out;
    }
  }

  // Separated numeric: a<sep>b<sep>year  (DD/MM vs MM/DD ambiguity).
  const sep = s.match(/^(\d{1,2})([/\-.])(\d{1,2})\2(\d{2,4})$/);
  if (sep) {
    const a = +sep[1], b = +sep[3];
    let y = +sep[4];
    if (sep[4].length === 2) y += y >= 70 ? 1900 : 2000;
    const symbol = sep[2];
    const dmy = (symbol === '/' ? 'DD/MM/YYYY' : symbol === '-' ? 'DD-MM-YYYY' : 'DD.MM.YYYY') as DetectedDateFormat;
    const mdy = (symbol === '/' ? 'MM/DD/YYYY' : symbol === '-' ? 'MM-DD-YYYY' : 'MM.DD.YYYY') as DetectedDateFormat;
    return resolveDayMonth(out, opts, a, b, y, dmy, mdy);
  }

  out.parsingWarnings.push('No known date format matched this value.');
  return out;
}

/** Decides day/month order for an ambiguous a/b/year triple. */
function resolveDayMonth(
  out: NormalizedDate, opts: DateNormalizeOptions,
  a: number, b: number, y: number, dmyFormat: DetectedDateFormat, mdyFormat: DetectedDateFormat,
): NormalizedDate {
  const forced = opts.format === dmyFormat ? 'DMY' : opts.format === mdyFormat ? 'MDY' : opts.order;
  const tryOrder = (order: LocalePreference): boolean => {
    const [d, m] = order === 'DMY' ? [a, b] : [b, a];
    if (!validYmd(y, m, d)) return false;
    out.normalizedDate = iso(y, m, d);
    out.detectedDateFormat = order === 'DMY' ? dmyFormat : mdyFormat;
    out.dateParsingStatus = 'parsed';
    return true;
  };

  if (forced) {
    if (tryOrder(forced)) { out.dateParsingConfidence = opts.format ? 0.98 : 0.9; return finalizeRange(out, opts); }
    // forced order invalid — fall through to self-evidence
  }
  // Self-evidence from this single value.
  if (a > 12 && b <= 12) { if (tryOrder('DMY')) { out.dateParsingConfidence = 0.95; return finalizeRange(out, opts); } }
  if (b > 12 && a <= 12) { if (tryOrder('MDY')) { out.dateParsingConfidence = 0.95; return finalizeRange(out, opts); } }
  if (a > 12 && b > 12) {
    out.parsingWarnings.push(`Both components exceed 12 (${a}, ${b}); this is not a valid day/month date.`);
    out.dateParsingStatus = 'invalid';
    return out;
  }
  // Genuinely ambiguous (both <= 12) with no order hint.
  if (validYmd(y, b, a) || validYmd(y, a, b)) {
    out.detectedDateFormat = dmyFormat;
    out.dateParsingStatus = 'ambiguous';
    out.dateParsingConfidence = 0.4;
    out.parsingWarnings.push(
      `Value ${a}${dmyFormat.includes('/') ? '/' : dmyFormat.includes('-') ? '-' : '.'}${b} is ambiguous: both DD/MM and MM/DD are possible. Select the intended date format.`,
    );
    return out;
  }
  out.parsingWarnings.push('Value did not resolve to a valid date under either order.');
  return out;
}

function finalizeRange(out: NormalizedDate, opts: DateNormalizeOptions): NormalizedDate {
  if (out.dateParsingStatus !== 'parsed' || !out.normalizedDate) return out;
  const iso10 = out.normalizedDate.slice(0, 10);
  const y = +iso10.slice(0, 4);
  if (y < MIN_YEAR || y > MAX_YEAR) {
    out.dateParsingStatus = 'out_of_range';
    out.parsingWarnings.push(`Year ${y} is outside the supported range ${MIN_YEAR}–${MAX_YEAR}.`);
    return out;
  }
  const now = opts.now ?? new Date();
  if (new Date(iso10 + 'T00:00:00Z').getTime() > now.getTime()) {
    out.parsingWarnings.push('Date is in the future relative to import time.');
  }
  return out;
}

function parseTextualMonth(s: string): { y: number; m: number; d: number } | null {
  const cleaned = s.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = cleaned.split(' ');
  if (tokens.length < 3) return null;
  let y = 0, m = 0, d = 0;
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (EN_MONTHS[lower]) m = EN_MONTHS[lower];
    else if (AR_MONTHS[t]) m = AR_MONTHS[t];
    else if (/^\d{4}$/.test(t)) y = +t;
    else if (/^\d{1,2}$/.test(t)) d = +t;
  }
  if (m && y && d) return { y, m, d };
  return null;
}

// ---------------------------------------------------------------------------
// Column-level analysis (ambiguity resolution + mixed-format detection)
// ---------------------------------------------------------------------------

export interface ColumnDateAnalysis {
  order: LocalePreference | null;      // resolved day/month order, when determinable
  dominantFormat: DetectedDateFormat | null;
  ambiguous: boolean;                  // order could not be determined from the data
  mixed: boolean;                      // more than one distinct format present
  formats: DetectedDateFormat[];
  parsedCount: number;
  total: number;
}

/**
 * Analyzes a whole column of raw values to resolve DD/MM vs MM/DD order using
 * cross-row evidence (any component > 12 fixes the order) and to detect mixed
 * formats. Falls back to the supplied locale preference only as a last resort.
 */
export function detectColumnDateFormat(values: unknown[], opts: DateNormalizeOptions = {}): ColumnDateAnalysis {
  let sawDayFirstEvidence = false;   // some a > 12
  let sawMonthFirstEvidence = false; // some b > 12
  const formatSet = new Set<DetectedDateFormat>();
  let parsed = 0;
  let total = 0;

  for (const v of values) {
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) continue;
    total += 1;
    const s = String(v).trim();
    const sep = s.match(/^(\d{1,2})([/\-.])(\d{1,2})\2\d{2,4}$/);
    if (sep) {
      const a = +sep[1], b = +sep[3];
      if (a > 12 && b <= 12) sawDayFirstEvidence = true;
      if (b > 12 && a <= 12) sawMonthFirstEvidence = true;
      formatSet.add(sep[2] === '/' ? 'DD/MM/YYYY' : sep[2] === '-' ? 'DD-MM-YYYY' : 'DD.MM.YYYY');
      continue;
    }
    // Non-separated values contribute their own detected format.
    const one = normalizeDateValue(v, { order: opts.order });
    if (one.dateParsingStatus === 'parsed') { parsed += 1; formatSet.add(one.detectedDateFormat); }
    else if (one.detectedDateFormat !== 'UNKNOWN') formatSet.add(one.detectedDateFormat);
  }

  let order: LocalePreference | null = null;
  let ambiguous = false;
  if (sawDayFirstEvidence && !sawMonthFirstEvidence) order = 'DMY';
  else if (sawMonthFirstEvidence && !sawDayFirstEvidence) order = 'MDY';
  else if (sawDayFirstEvidence && sawMonthFirstEvidence) { order = null; ambiguous = true; }
  else {
    // No decisive evidence. Only "ambiguous" if the column actually contains
    // separated numeric dates that need an order.
    const hasSeparated = [...formatSet].some((f) => /^(DD|MM)[/\-.]/.test(f));
    if (hasSeparated) { order = opts.order ?? null; ambiguous = opts.order == null; }
  }

  const separatedFamilies = new Set([...formatSet].map((f) => f.replace(/^(DD|MM)/, 'XX')));
  const mixed = separatedFamilies.size > 1 || formatSet.size > 1;

  return {
    order,
    dominantFormat: [...formatSet][0] ?? null,
    ambiguous,
    mixed,
    formats: [...formatSet],
    parsedCount: parsed,
    total,
  };
}

/** Normalizes a whole column, applying the resolved order to each value. */
export function normalizeDateColumn(values: unknown[], opts: DateNormalizeOptions = {}): {
  analysis: ColumnDateAnalysis;
  dates: NormalizedDate[];
} {
  const analysis = detectColumnDateFormat(values, opts);
  const order = analysis.order ?? opts.order;
  const dates = values.map((v, i) =>
    normalizeDateValue(v, { ...opts, order: order ?? undefined, sourceRowNumber: i }),
  );
  return { analysis, dates };
}

// ---------------------------------------------------------------------------
// UI display formatting (centralised; storage stays ISO)
// ---------------------------------------------------------------------------

/** Formats an ISO date/timestamp for display. Default UI format: DD/MM/YYYY. */
export function formatDisplayDate(isoValue: string | null | undefined, format = 'DD/MM/YYYY'): string {
  if (!isoValue) return '';
  const m = isoValue.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(isoValue);
  const [, y, mo, d] = m;
  return format
    .replace('YYYY', y).replace('MM', mo).replace('DD', d);
}
