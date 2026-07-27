import { describe, it, expect } from 'vitest';
import { abcClassify, abcSummary } from './abc';
import { xyzClassify, abcXyzMatrix } from './xyz';
import { inventoryAging, agingSummary, DEFAULT_AGING_BUCKETS } from './aging';
import { movementCategories } from './movement-category';
import { excessStock, shortageRisks } from './excess-shortage';
import {
  naiveForecast, movingAverageForecast, exponentialSmoothingForecast,
  holtForecast, crostonForecast, forecastAccuracy, selectBestForecast,
  holtWintersForecast,
} from './forecasting';
import { safetyStock, reorderPoint, minMaxPlan } from './planning';
import { inventoryHealthIndex } from './health';
import { aggregateByPeriod, consumptionAnomalies, consumptionStats } from './consumption';
import { coefficientOfVariation, normInv, stdDev } from './stats';

describe('ABC classification', () => {
  it('classifies by cumulative value share, not item count', () => {
    const items = [
      { material: 'M1', metricValue: 800 },
      { material: 'M2', metricValue: 150 },
      { material: 'M3', metricValue: 30 },
      { material: 'M4', metricValue: 15 },
      { material: 'M5', metricValue: 5 },
    ];
    const result = abcClassify(items);
    const byMat = Object.fromEntries(result.map((r) => [r.material, r.abcClass]));
    expect(byMat.M1).toBe('A');   // 80% cumulative
    expect(byMat.M2).toBe('B');   // 95% cumulative
    expect(byMat.M3).toBe('C');
    expect(byMat.M5).toBe('C');
  });

  it('puts zero/negative value items into C', () => {
    const result = abcClassify([
      { material: 'M1', metricValue: 100 },
      { material: 'M2', metricValue: 0 },
      { material: 'M3', metricValue: -5 },
    ]);
    const byMat = Object.fromEntries(result.map((r) => [r.material, r.abcClass]));
    expect(byMat.M2).toBe('C');
    expect(byMat.M3).toBe('C');
  });

  it('always classifies the largest item as A', () => {
    const result = abcClassify([
      { material: 'BIG', metricValue: 1000 },
      { material: 'S', metricValue: 1 },
    ]);
    expect(result.find((r) => r.material === 'BIG')!.abcClass).toBe('A');
  });

  it('rejects invalid thresholds', () => {
    expect(() => abcClassify([], { aThresholdPct: 90, bThresholdPct: 80 })).toThrow();
  });

  it('summarises class shares that add to 100%', () => {
    const result = abcClassify([
      { material: 'M1', metricValue: 700 },
      { material: 'M2', metricValue: 200 },
      { material: 'M3', metricValue: 100 },
    ]);
    const summary = abcSummary(result);
    const totalShare = summary.reduce((a, s) => a + s.metricSharePct, 0);
    expect(totalShare).toBeCloseTo(100, 1);
  });
});

describe('XYZ classification', () => {
  it('classifies stable demand as X', () => {
    const r = xyzClassify([{ material: 'M1', series: [100, 105, 95, 100, 102, 98] }]);
    expect(r[0].xyzClass).toBe('X');
  });

  it('classifies zero-mean demand as Z without dividing by zero', () => {
    const r = xyzClassify([{ material: 'M1', series: [0, 0, 0, 0, 0, 0] }]);
    expect(r[0].xyzClass).toBe('Z');
    expect(r[0].cov).toBeNull();
  });

  it('classifies intermittent demand as Z', () => {
    const r = xyzClassify([{ material: 'M1', series: [0, 50, 0, 0, 60, 0, 0, 0] }]);
    expect(r[0].xyzClass).toBe('Z');
    expect(r[0].intermittent).toBe(true);
  });

  it('treats short history as Z with an explanation', () => {
    const r = xyzClassify([{ material: 'M1', series: [10, 12] }]);
    expect(r[0].xyzClass).toBe('Z');
    expect(r[0].reason).toContain('period');
  });

  it('builds a complete 9-cell ABC-XYZ matrix', () => {
    const matrix = abcXyzMatrix(
      [{ material: 'M1', abcClass: 'A' }, { material: 'M2', abcClass: 'C' }],
      [{ material: 'M1', xyzClass: 'X' }, { material: 'M2', xyzClass: 'Z' }],
    );
    expect(matrix).toHaveLength(9);
    expect(matrix.find((c) => c.segment === 'AX')!.materialCount).toBe(1);
    expect(matrix.find((c) => c.segment === 'CZ')!.materialCount).toBe(1);
  });
});

describe('Inventory aging', () => {
  it('buckets by days since last movement', () => {
    const r = inventoryAging(
      [
        { material: 'M1', quantity: 10, value: 100, lastMovementDate: '2026-06-30' },
        { material: 'M2', quantity: 5, value: 50, lastMovementDate: '2025-01-01' },
      ],
      '2026-07-15',
    );
    expect(r[0].bucket).toBe('0-30 days');
    expect(r[1].bucket).toBe('> 365 days');
  });

  it('reports items without dates separately instead of guessing', () => {
    const r = inventoryAging([{ material: 'M1', quantity: 1, value: 1 }], '2026-07-15');
    expect(r[0].ageDays).toBeNull();
    const summary = agingSummary(r, DEFAULT_AGING_BUCKETS);
    expect(summary.find((s) => s.bucket === 'No movement data')!.materialCount).toBe(1);
  });
});

describe('Movement categories', () => {
  it('distinguishes non-moving from slow-moving from active', () => {
    const r = movementCategories([
      { material: 'NM', stockQty: 10, stockValue: 100, issuedQty: 0, periodDays: 400, daysSinceLastIssue: 400 },
      { material: 'SM', stockQty: 10, stockValue: 100, issuedQty: 2, periodDays: 365, daysSinceLastIssue: 200 },
      { material: 'AC', stockQty: 10, stockValue: 100, issuedQty: 50, periodDays: 365, daysSinceLastIssue: 5 },
    ]);
    const byMat = Object.fromEntries(r.map((x) => [x.material, x.category]));
    expect(byMat.NM).toBe('non_moving');
    expect(byMat.SM).toBe('slow_moving');
    expect(byMat.AC).toBe('active');
  });

  it('does not label non-moving when the period is too short to judge', () => {
    const r = movementCategories([
      { material: 'M', stockQty: 5, stockValue: 10, issuedQty: 0, periodDays: 30, daysSinceLastIssue: null },
    ]);
    expect(r[0].category).toBe('no_movement_data');
  });
});

describe('Excess and shortage', () => {
  it('computes excess above max stock and skips items missing the reference', () => {
    const r = excessStock(
      [
        { material: 'M1', stockQty: 150, stockValue: 1500, maxStock: 100 },
        { material: 'M2', stockQty: 80, stockValue: 800, maxStock: 100 },
        { material: 'M3', stockQty: 500, stockValue: 5000 }, // no max stock -> excluded
      ],
      'above_max_stock',
    );
    expect(r).toHaveLength(1);
    expect(r[0].material).toBe('M1');
    expect(r[0].excessQty).toBe(50);
    expect(r[0].excessValue).toBe(500);
  });

  it('computes excess above a coverage target', () => {
    const r = excessStock(
      [{ material: 'M1', stockQty: 1000, stockValue: 10000, avgDailyDemand: 5 }],
      'above_coverage_target',
      { coverageTargetDays: 90 },
    );
    expect(r[0].referenceQty).toBe(450);
    expect(r[0].excessQty).toBe(550);
  });

  it('flags negative available stock as critical shortage', () => {
    const r = shortageRisks([{ material: 'M1', stockQty: -5 }]);
    expect(r[0].risk).toBe('critical');
    expect(r[0].gapQty).toBe(5);
  });

  it('flags below safety stock and below reorder point', () => {
    const r = shortageRisks([
      { material: 'SS', stockQty: 5, safetyStock: 20 },
      { material: 'ROP', stockQty: 30, reorderPoint: 50, openSupplyQty: 0 },
      { material: 'OK', stockQty: 100, safetyStock: 20, reorderPoint: 50 },
    ]);
    const mats = r.map((x) => x.material);
    expect(mats).toContain('SS');
    expect(mats).toContain('ROP');
    expect(mats).not.toContain('OK');
  });
});

describe('Forecasting', () => {
  const series = [10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17];

  it('naive repeats the last value', () => {
    const f = naiveForecast(series, 3);
    expect(f.forecast).toEqual([17, 17, 17]);
  });

  it('moving average uses the window mean', () => {
    const f = movingAverageForecast([10, 20, 30], 2, 3);
    expect(f.forecast[0]).toBe(20);
  });

  it('exponential smoothing produces a finite level', () => {
    const f = exponentialSmoothingForecast(series, 2);
    expect(f.forecast[0]).toBeGreaterThan(10);
    expect(f.forecast[0]).toBeLessThan(20);
  });

  it('holt captures trend', () => {
    const f = holtForecast([10, 20, 30, 40, 50, 60], 2);
    expect(f.forecast[1]).toBeGreaterThan(f.forecast[0]);
  });

  it('holt-winters handles a seasonal series', () => {
    const seasonal = [100, 50, 100, 50, 100, 50, 100, 50];
    const f = holtWintersForecast(seasonal, 2, 2);
    expect(f.method).toBe('holt_winters');
    expect(f.forecast[0]).toBeGreaterThan(f.forecast[1] - 100); // finite, sane
  });

  it('croston handles intermittent demand with zero-safe rates', () => {
    const f = crostonForecast([0, 0, 6, 0, 0, 9, 0, 0, 0, 6], 2);
    expect(f.forecast[0]).toBeGreaterThan(0);
    expect(f.forecast[0]).toBeLessThan(10);
  });

  it('accuracy metrics are zero-demand safe', () => {
    const acc = forecastAccuracy([0, 0, 0], [1, 1, 1]);
    expect(acc.mape).toBeNull();
    expect(acc.wape).toBeNull();
    expect(acc.mae).toBe(1);
  });

  it('refuses to fit on insufficient history', () => {
    const r = selectBestForecast([5, 6, 7], 3);
    expect(r.insufficientData).toBe(true);
    expect(r.forecast).toBeNull();
    expect(r.note).toContain('history');
  });

  it('selects a best method via holdout back-test', () => {
    const r = selectBestForecast(series, 3);
    expect(r.insufficientData).toBe(false);
    expect(r.best).toBeTruthy();
    expect(r.forecast!.forecast).toHaveLength(3);
    expect(r.comparisons.filter((c) => c.recommended)).toHaveLength(1);
  });
});

describe('Planning', () => {
  it('statistical safety stock grows with service level', () => {
    const input = { demandSeries: [100, 120, 90, 110, 105, 95], periodDays: 30, leadTimeDays: 14 };
    const ss95 = safetyStock('statistical_service_level', { ...input, serviceLevel: 0.95 });
    const ss99 = safetyStock('statistical_service_level', { ...input, serviceLevel: 0.99 });
    expect(ss99.safetyStock).toBeGreaterThan(ss95.safetyStock);
    expect(ss95.formula).toContain('z');
  });

  it('reorder point = lead-time demand + safety stock', () => {
    const r = reorderPoint(10, 7, 30);
    expect(r.reorderPoint).toBe(100);
  });

  it('min/max plan is consistent', () => {
    const r = minMaxPlan(10, 7, 30, 30);
    expect(r.minStock).toBe(100);
    expect(r.maxStock).toBe(400);
    expect(r.orderQuantity).toBe(300);
  });

  it('normInv approximates known quantiles', () => {
    expect(normInv(0.5)).toBeCloseTo(0, 3);
    expect(normInv(0.975)).toBeCloseTo(1.96, 2);
  });
});

describe('Health index', () => {
  it('renormalises weights over measurable components', () => {
    const r = inventoryHealthIndex({
      availability: 80, excess: 60, obsolescence: null, aging: null, turnover: 70, dataQuality: 90,
    });
    expect(r.score).toBeGreaterThan(0);
    expect(r.appliedWeights.obsolescence).toBe(0);
    expect(r.explanation.join(' ')).toContain('excluded');
    const applied = Object.values(r.appliedWeights).reduce((a, b) => a + b, 0);
    expect(applied).toBeCloseTo(1, 2);
  });
});

describe('Consumption analytics', () => {
  it('aggregates and zero-fills monthly periods', () => {
    const series = aggregateByPeriod(
      [
        { date: '2026-01-15', quantity: 10, value: 100 },
        { date: '2026-03-10', quantity: 20, value: 200 },
      ],
      'month',
    );
    expect(series.map((p) => p.period)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(series[1].quantity).toBe(0);
  });

  it('detects spikes with z-score', () => {
    const points = [10, 11, 9, 10, 10, 11, 10, 100].map((q, i) => ({
      period: `2026-0${i + 1}`, quantity: q, value: q * 10,
    }));
    const anomalies = consumptionAnomalies(points, 2);
    expect(anomalies.some((a) => a.direction === 'spike' && a.quantity === 100)).toBe(true);
  });

  it('is silent on constant series and computes stats', () => {
    const points = [5, 5, 5, 5, 5, 5].map((q, i) => ({ period: `p${i}`, quantity: q, value: q }));
    expect(consumptionAnomalies(points)).toHaveLength(0);
    const stats = consumptionStats(points);
    expect(stats.avgPerPeriod).toBe(5);
    expect(stats.stdDevPerPeriod).toBe(0);
  });
});

describe('Stats safety', () => {
  it('CoV is null on zero mean', () => {
    expect(coefficientOfVariation([0, 0, 0])).toBeNull();
  });
  it('stdDev of single point is 0', () => {
    expect(stdDev([5])).toBe(0);
  });
});
