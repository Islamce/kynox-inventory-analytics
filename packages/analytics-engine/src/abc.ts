import type { AbcResult, AbcClass } from '@kynox/shared-types';
import { round } from './stats';

export interface AbcOptions {
  /** Cumulative-value threshold for class A, as a percentage. Default 80. */
  aThresholdPct?: number;
  /** Cumulative-value threshold for class B (A + B), as a percentage. Default 95. */
  bThresholdPct?: number;
}

export interface AbcInput {
  material: string;
  /** The classification metric (annual consumption value, stock value, ...). */
  metricValue: number;
}

/**
 * ABC classification by cumulative value share (Pareto), never by item count.
 * Items with zero or negative metric value fall into class C by definition.
 */
export function abcClassify(items: AbcInput[], options: AbcOptions = {}): AbcResult[] {
  const aTh = options.aThresholdPct ?? 80;
  const bTh = options.bThresholdPct ?? 95;
  if (aTh <= 0 || bTh <= aTh || bTh > 100) {
    throw new Error(`Invalid ABC thresholds: A=${aTh}, B=${bTh}`);
  }
  const sorted = [...items].sort((a, b) => b.metricValue - a.metricValue);
  const total = sorted.reduce((acc, i) => acc + Math.max(0, i.metricValue), 0);
  let cumulative = 0;
  return sorted.map((item) => {
    const positive = Math.max(0, item.metricValue);
    cumulative += positive;
    const cumulativePct = total === 0 ? 100 : (cumulative / total) * 100;
    let abcClass: AbcClass;
    if (item.metricValue <= 0 || total === 0) {
      abcClass = 'C';
    } else if (cumulativePct <= aTh || cumulative - positive === 0) {
      // The first (largest) item is always A even if it alone exceeds the threshold.
      abcClass = cumulativePct <= aTh || cumulative === positive ? 'A' : 'B';
    } else if (cumulativePct <= bTh) {
      abcClass = 'B';
    } else {
      abcClass = 'C';
    }
    return {
      material: item.material,
      metricValue: item.metricValue,
      cumulativePct: round(cumulativePct, 2),
      abcClass,
    };
  });
}

export interface AbcClassSummary {
  abcClass: AbcClass;
  materialCount: number;
  metricValue: number;
  metricSharePct: number;
  recommendedPolicy: string;
}

const ABC_POLICIES: Record<AbcClass, string> = {
  A: 'Tight control: frequent review, accurate forecasting, cycle counting at high frequency, negotiated supply agreements.',
  B: 'Moderate control: periodic review, standard forecasting, medium counting frequency.',
  C: 'Simplified control: bulk ordering, low review frequency, simple min/max policies.',
};

export function abcSummary(results: AbcResult[]): AbcClassSummary[] {
  const total = results.reduce((a, r) => a + Math.max(0, r.metricValue), 0);
  return (['A', 'B', 'C'] as AbcClass[]).map((cls) => {
    const inClass = results.filter((r) => r.abcClass === cls);
    const value = inClass.reduce((a, r) => a + Math.max(0, r.metricValue), 0);
    return {
      abcClass: cls,
      materialCount: inClass.length,
      metricValue: round(value, 2),
      metricSharePct: round(total === 0 ? 0 : (value / total) * 100, 2),
      recommendedPolicy: ABC_POLICIES[cls],
    };
  });
}
