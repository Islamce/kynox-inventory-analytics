import { mean, median, round, stdDev, trendSlope } from './stats';

export interface PeriodPoint {
  period: string;               // e.g. '2025-01' or '2025-W03' or '2025-01-15'
  quantity: number;
  value: number;
}

export type Granularity = 'day' | 'week' | 'month';

/** Aggregates dated movements into a contiguous zero-filled period series. */
export function aggregateByPeriod(
  rows: { date: string; quantity: number; value: number }[],
  granularity: Granularity,
): PeriodPoint[] {
  const buckets = new Map<string, { quantity: number; value: number }>();
  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const r of rows) {
    const d = new Date(r.date);
    if (Number.isNaN(d.getTime())) continue;
    minTime = Math.min(minTime, d.getTime());
    maxTime = Math.max(maxTime, d.getTime());
    const key = periodKey(d, granularity);
    const b = buckets.get(key) ?? { quantity: 0, value: 0 };
    b.quantity += r.quantity;
    b.value += r.value;
    buckets.set(key, b);
  }
  if (!Number.isFinite(minTime)) return [];
  // Zero-fill the range so variability metrics see empty periods.
  const points: PeriodPoint[] = [];
  const cursor = new Date(minTime);
  const end = new Date(maxTime);
  const seen = new Set<string>();
  while (cursor.getTime() <= end.getTime()) {
    const key = periodKey(cursor, granularity);
    if (!seen.has(key)) {
      seen.add(key);
      const b = buckets.get(key) ?? { quantity: 0, value: 0 };
      points.push({ period: key, quantity: round(b.quantity, 3), value: round(b.value, 2) });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

export function periodKey(d: Date, granularity: Granularity): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  if (granularity === 'day') return `${y}-${m}-${day}`;
  if (granularity === 'month') return `${y}-${m}`;
  // ISO week
  const date = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface ConsumptionStats {
  totalQuantity: number;
  totalValue: number;
  avgPerPeriod: number;
  medianPerPeriod: number;
  stdDevPerPeriod: number;
  trendSlopePerPeriod: number;   // positive = growing consumption
  zeroPeriods: number;
  periods: number;
}

export function consumptionStats(series: PeriodPoint[]): ConsumptionStats {
  const qtys = series.map((p) => p.quantity);
  return {
    totalQuantity: round(qtys.reduce((a, b) => a + b, 0), 3),
    totalValue: round(series.reduce((a, p) => a + p.value, 0), 2),
    avgPerPeriod: round(mean(qtys), 3),
    medianPerPeriod: round(median(qtys), 3),
    stdDevPerPeriod: round(stdDev(qtys), 3),
    trendSlopePerPeriod: round(trendSlope(qtys), 4),
    zeroPeriods: qtys.filter((q) => q === 0).length,
    periods: qtys.length,
  };
}

export interface AnomalyPoint {
  period: string;
  quantity: number;
  zScore: number;
  direction: 'spike' | 'drop';
}

/**
 * Flags demand spikes/drops using a z-score against the rest of the series.
 * Requires at least 6 periods; sub-threshold series return no anomalies
 * rather than noise.
 */
export function consumptionAnomalies(series: PeriodPoint[], zThreshold = 3): AnomalyPoint[] {
  if (series.length < 6) return [];
  const qtys = series.map((p) => p.quantity);
  const m = mean(qtys);
  const sd = stdDev(qtys);
  if (sd === 0) return [];
  const anomalies: AnomalyPoint[] = [];
  for (const p of series) {
    const z = (p.quantity - m) / sd;
    if (Math.abs(z) >= zThreshold) {
      anomalies.push({
        period: p.period,
        quantity: p.quantity,
        zScore: round(z, 2),
        direction: z > 0 ? 'spike' : 'drop',
      });
    }
  }
  return anomalies;
}
