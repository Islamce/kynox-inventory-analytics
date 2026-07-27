import type { AgingBucket, AgingResult } from '@kynox/shared-types';
import { round } from './stats';

export const DEFAULT_AGING_BUCKETS: AgingBucket[] = [
  { label: '0-30 days', minDays: 0, maxDays: 30 },
  { label: '31-60 days', minDays: 31, maxDays: 60 },
  { label: '61-90 days', minDays: 61, maxDays: 90 },
  { label: '91-180 days', minDays: 91, maxDays: 180 },
  { label: '181-365 days', minDays: 181, maxDays: 365 },
  { label: '> 365 days', minDays: 366, maxDays: null },
];

export type AgingDateBasis = 'last_receipt' | 'last_issue' | 'last_movement';

export interface AgingInput {
  material: string;
  quantity: number;
  value: number;
  lastReceiptDate?: string | null;
  lastIssueDate?: string | null;
  lastMovementDate?: string | null;
}

function pickDate(item: AgingInput, basis: AgingDateBasis): string | null {
  switch (basis) {
    case 'last_receipt': return item.lastReceiptDate ?? item.lastMovementDate ?? null;
    case 'last_issue': return item.lastIssueDate ?? item.lastMovementDate ?? null;
    case 'last_movement':
      return item.lastMovementDate ?? item.lastReceiptDate ?? item.lastIssueDate ?? null;
  }
}

export function bucketFor(ageDays: number, buckets: AgingBucket[]): string | null {
  for (const b of buckets) {
    if (ageDays >= b.minDays && (b.maxDays === null || ageDays <= b.maxDays)) {
      return b.label;
    }
  }
  return null;
}

/**
 * Inventory aging relative to an as-of date. Items without a usable reference
 * date get ageDays = null and are reported separately, never guessed.
 */
export function inventoryAging(
  items: AgingInput[],
  asOfDate: string,
  basis: AgingDateBasis = 'last_movement',
  buckets: AgingBucket[] = DEFAULT_AGING_BUCKETS,
): AgingResult[] {
  const asOf = new Date(asOfDate).getTime();
  if (Number.isNaN(asOf)) throw new Error(`Invalid asOfDate: ${asOfDate}`);
  return items.map((item) => {
    const ref = pickDate(item, basis);
    const refTime = ref ? new Date(ref).getTime() : NaN;
    if (!ref || Number.isNaN(refTime)) {
      return { material: item.material, ageDays: null, bucket: null, quantity: item.quantity, value: item.value };
    }
    const ageDays = Math.max(0, Math.floor((asOf - refTime) / 86_400_000));
    return {
      material: item.material,
      ageDays,
      bucket: bucketFor(ageDays, buckets),
      quantity: item.quantity,
      value: round(item.value, 2),
    };
  });
}

export interface AgingBucketSummary {
  bucket: string;
  materialCount: number;
  quantity: number;
  value: number;
}

export function agingSummary(results: AgingResult[], buckets: AgingBucket[] = DEFAULT_AGING_BUCKETS): AgingBucketSummary[] {
  const summaries: AgingBucketSummary[] = buckets.map((b) => ({
    bucket: b.label, materialCount: 0, quantity: 0, value: 0,
  }));
  const unknown: AgingBucketSummary = { bucket: 'No movement data', materialCount: 0, quantity: 0, value: 0 };
  for (const r of results) {
    const target = r.bucket ? summaries.find((s) => s.bucket === r.bucket) : unknown;
    if (target) {
      target.materialCount += 1;
      target.quantity += r.quantity;
      target.value += r.value;
    }
  }
  for (const s of [...summaries, unknown]) {
    s.quantity = round(s.quantity, 3);
    s.value = round(s.value, 2);
  }
  return [...summaries, unknown];
}
