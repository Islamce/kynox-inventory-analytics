import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { HttpError } from '../middleware/errors';

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const ALLOWED_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/octet-stream', // some browsers send this for csv/xls
]);

export function validateUploadFile(originalName: string, mime: string): void {
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new HttpError(400, `Unsupported file type '${ext}'. Allowed: XLSX, XLS, CSV.`);
  }
  if (!ALLOWED_MIMES.has(mime)) {
    throw new HttpError(400, 'Unsupported MIME type for spreadsheet upload.');
  }
}

/** Strips path separators and dangerous characters from a filename. */
export function sanitizeFilename(name: string): string {
  return path.basename(name).replace(/[^\w.\-() ]+/g, '_').slice(0, 200);
}

/**
 * Parses a workbook file into sheets of header->value records.
 * Duplicate headers are disambiguated; fully empty rows are skipped;
 * merged-cell gaps come through as undefined and are handled downstream.
 */
export function parseWorkbook(filePath: string, maxRows = 200_000): ParsedSheet[] {
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'Uploaded file no longer exists');
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.readFile(filePath, { cellDates: false, dense: true });
  } catch {
    throw new HttpError(400, 'The file could not be parsed as a spreadsheet. It may be corrupt.');
  }
  const sheets: ParsedSheet[] = [];
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: false });
    if (raw.length === 0) continue;

    // Find the header row: first row with at least 2 non-empty string-ish cells.
    let headerIdx = 0;
    for (let i = 0; i < Math.min(raw.length, 10); i++) {
      const nonEmpty = (raw[i] ?? []).filter((c) => c !== null && String(c).trim() !== '');
      if (nonEmpty.length >= 2) { headerIdx = i; break; }
    }
    const headerRow = raw[headerIdx] ?? [];
    const headers: string[] = [];
    const seen = new Map<string, number>();
    headerRow.forEach((h, i) => {
      let label = String(h ?? '').trim() || `Column ${i + 1}`;
      const count = seen.get(label) ?? 0;
      seen.set(label, count + 1);
      if (count > 0) label = `${label} (${count + 1})`;
      headers.push(label);
    });

    const rows: Record<string, unknown>[] = [];
    for (let i = headerIdx + 1; i < raw.length && rows.length < maxRows; i++) {
      const cells = raw[i] ?? [];
      if (cells.every((c) => c === null || String(c).trim() === '')) continue;
      const record: Record<string, unknown> = {};
      headers.forEach((h, j) => { record[h] = cells[j] ?? null; });
      rows.push(record);
    }
    if (rows.length > 0) sheets.push({ name, headers, rows });
  }
  if (sheets.length === 0) throw new HttpError(400, 'The file contains no data rows.');
  return sheets;
}
