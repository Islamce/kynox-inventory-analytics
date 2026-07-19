/**
 * Tolerant-but-explicit value parsers. They never guess silently: every parse
 * returns the parsed value plus a flag describing what interpretation was used,
 * so cleansing can be shown to the user before it is applied.
 */

export interface NumberParse {
  value: number | null;
  interpretation: 'plain' | 'thousands_dot_decimal_comma' | 'thousands_comma' | 'negative_trailing_sign' | 'failed';
}

/**
 * Parses ERP-style numbers: "1.234,56" (EU), "1,234.56" (US), "123,45",
 * SAP trailing-sign negatives "100-", plain numbers.
 */
export function parseNumber(raw: unknown): NumberParse {
  if (raw === null || raw === undefined || raw === '') return { value: null, interpretation: 'failed' };
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { value: raw, interpretation: 'plain' } : { value: null, interpretation: 'failed' };
  }
  let s = String(raw).trim();
  if (s === '') return { value: null, interpretation: 'failed' };

  let interpretation: NumberParse['interpretation'] = 'plain';
  let negative = false;
  if (s.endsWith('-')) {                    // SAP trailing sign
    negative = true;
    s = s.slice(0, -1).trim();
    interpretation = 'negative_trailing_sign';
  }
  if (s.startsWith('(') && s.endsWith(')')) { // accounting negatives
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\s/g, '');

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // EU format: 1.234,56
      s = s.replace(/\./g, '').replace(',', '.');
      interpretation = 'thousands_dot_decimal_comma';
    } else {
      // US format: 1,234.56
      s = s.replace(/,/g, '');
      interpretation = 'thousands_comma';
    }
  } else if (hasComma) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length !== 3) {
      // decimal comma: 123,45
      s = s.replace(',', '.');
      interpretation = 'thousands_dot_decimal_comma';
    } else {
      // thousands separators: 1,234 or 1,234,567
      s = s.replace(/,/g, '');
      interpretation = 'thousands_comma';
    }
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return { value: null, interpretation: 'failed' };
  return { value: negative ? -n : n, interpretation };
}

export interface DateParse {
  /** ISO date (YYYY-MM-DD) or null. */
  value: string | null;
  format: string | null;
}

const DATE_PATTERNS: { re: RegExp; format: string; build: (m: RegExpMatchArray) => [number, number, number] }[] = [
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})/, format: 'YYYY-MM-DD', build: (m) => [+m[1], +m[2], +m[3]] },
  { re: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, format: 'YYYY/MM/DD', build: (m) => [+m[1], +m[2], +m[3]] },
  { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, format: 'DD.MM.YYYY', build: (m) => [+m[3], +m[2], +m[1]] },
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, format: 'DD/MM/YYYY', build: (m) => [+m[3], +m[2], +m[1]] },
  { re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, format: 'DD-MM-YYYY', build: (m) => [+m[3], +m[2], +m[1]] },
  { re: /^(\d{4})(\d{2})(\d{2})$/, format: 'YYYYMMDD', build: (m) => [+m[1], +m[2], +m[3]] },
];

/** Excel serial date epoch (1899-12-30, accounting for the 1900 leap-year bug). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

export function parseDate(raw: unknown): DateParse {
  if (raw === null || raw === undefined || raw === '') return { value: null, format: null };
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { value: raw.toISOString().slice(0, 10), format: 'Date object' };
  }
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    // Excel serial date range ~1954..2118
    const d = new Date(EXCEL_EPOCH_MS + raw * 86_400_000);
    return { value: d.toISOString().slice(0, 10), format: 'Excel serial' };
  }
  const s = String(raw).trim();
  for (const p of DATE_PATTERNS) {
    const m = s.match(p.re);
    if (m) {
      const [y, mo, d] = p.build(m);
      if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) continue;
      const date = new Date(Date.UTC(y, mo - 1, d));
      // Reject invalid combinations like 31.02.2026
      if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) continue;
      return { value: date.toISOString().slice(0, 10), format: p.format };
    }
  }
  return { value: null, format: null };
}

export function normalizeText(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

/** Simple Levenshtein-based similarity in [0,1]. */
export function similarity(a: string, b: string): number {
  const s1 = a.toLowerCase();
  const s2 = b.toLowerCase();
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  let prev = Array.from({ length: len2 + 1 }, (_, j) => j);
  for (let i = 1; i <= len1; i++) {
    const curr = [i];
    for (let j = 1; j <= len2; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (s1[i - 1] === s2[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return 1 - prev[len2] / Math.max(len1, len2);
}
