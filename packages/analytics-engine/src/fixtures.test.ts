/**
 * Fixture-based verification: every expected value in this file was computed
 * BY HAND from the stated formula, independently of the implementation.
 */
import { describe, it, expect } from 'vitest';
import { abcClassify } from './abc';
import { xyzClassify } from './xyz';
import { inventoryAging } from './aging';
import { excessStock, shortageRisks } from './excess-shortage';
import { forecastAccuracy, naiveForecast, crostonForecast } from './forecasting';
import { safetyStock, reorderPoint, minMaxPlan } from './planning';
import { inventoryHealthIndex } from './health';
import { movementCategories } from './movement-category';
import { coefficientOfVariation, stdDev, mean, normInv } from './stats';

describe('fixture: ABC cumulative classification', () => {
  // Values: 500, 300, 120, 50, 30 → total 1000.
  // Cumulative %: 50, 80, 92, 97, 100.
  // Thresholds A≤80, B≤95 → A: 500, 300 · B: 120 · C: 50, 30.
  it('matches hand-computed cumulative shares', () => {
    const r = abcClassify([
      { material: 'M1', metricValue: 500 },
      { material: 'M2', metricValue: 300 },
      { material: 'M3', metricValue: 120 },
      { material: 'M4', metricValue: 50 },
      { material: 'M5', metricValue: 30 },
    ]);
    expect(r.map((x) => [x.material, x.cumulativePct, x.abcClass])).toEqual([
      ['M1', 50, 'A'],
      ['M2', 80, 'A'],
      ['M3', 92, 'B'],
      ['M4', 97, 'C'],
      ['M5', 100, 'C'],
    ]);
  });
});

describe('fixture: coefficient of variation and XYZ', () => {
  // Series 8, 12, 10, 10, 12, 8: mean = 10.
  // Sample variance = ((−2)²+2²+0+0+2²+(−2)²)/5 = 16/5 = 3.2 → σ = 1.78885…
  // CoV = 0.178885… → X class (≤ 0.5).
  it('computes CoV = σ/μ with sample standard deviation', () => {
    const series = [8, 12, 10, 10, 12, 8];
    expect(mean(series)).toBe(10);
    expect(stdDev(series)).toBeCloseTo(Math.sqrt(3.2), 6);
    expect(coefficientOfVariation(series)).toBeCloseTo(Math.sqrt(3.2) / 10, 6);
    const xyz = xyzClassify([{ material: 'M', series }]);
    expect(xyz[0].cov).toBeCloseTo(0.1789, 3);
    expect(xyz[0].xyzClass).toBe('X');
  });

  // 3 zeros in 6 periods = 50% ≥ 40% threshold → intermittent → Z.
  it('classifies 50% zero periods as intermittent Z', () => {
    const xyz = xyzClassify([{ material: 'M', series: [0, 20, 0, 22, 0, 21] }]);
    expect(xyz[0].zeroPeriodShare).toBe(0.5);
    expect(xyz[0].xyzClass).toBe('Z');
    expect(xyz[0].intermittent).toBe(true);
  });
});

describe('fixture: inventory aging', () => {
  // As of 2026-07-19: last movement 2026-07-01 → 18 days → bucket 0-30.
  // 2026-04-01 → 109 days → bucket 91-180. 2025-06-01 → 413 days → >365.
  it('computes exact day counts and buckets', () => {
    const r = inventoryAging([
      { material: 'A', quantity: 1, value: 10, lastMovementDate: '2026-07-01' },
      { material: 'B', quantity: 1, value: 10, lastMovementDate: '2026-04-01' },
      { material: 'C', quantity: 1, value: 10, lastMovementDate: '2025-06-01' },
    ], '2026-07-19');
    expect(r[0].ageDays).toBe(18);
    expect(r[0].bucket).toBe('0-30 days');
    expect(r[1].ageDays).toBe(109);
    expect(r[1].bucket).toBe('91-180 days');
    expect(r[2].ageDays).toBe(413);
    expect(r[2].bucket).toBe('> 365 days');
  });
});

describe('fixture: excess stock valuation', () => {
  // Stock 250 @ value 1000 → unit price 4. Max stock 100 → excess 150 → value 600.
  it('values excess at the implied unit price', () => {
    const r = excessStock([{ material: 'M', stockQty: 250, stockValue: 1000, maxStock: 100 }], 'above_max_stock');
    expect(r[0].excessQty).toBe(150);
    expect(r[0].excessValue).toBe(600);
  });

  // Coverage method: daily demand 4, target 90 days → reference 360.
  // Stock 500 @ 2/unit → excess 140 → value 280.
  it('coverage-target reference = daily demand × target days', () => {
    const r = excessStock(
      [{ material: 'M', stockQty: 500, stockValue: 1000, avgDailyDemand: 4 }],
      'above_coverage_target', { coverageTargetDays: 90 },
    );
    expect(r[0].referenceQty).toBe(360);
    expect(r[0].excessQty).toBe(140);
    expect(r[0].excessValue).toBe(280);
  });
});

describe('fixture: shortage gap quantities', () => {
  it('gap below safety stock = SS − available', () => {
    const r = shortageRisks([{ material: 'M', stockQty: 12, safetyStock: 30 }]);
    expect(r[0].gapQty).toBe(18);
    expect(r[0].risk).toBe('high');
  });
  it('uncovered reservations = reservations − available − open supply', () => {
    const r = shortageRisks([{
      material: 'M', stockQty: 10, availableQty: 10, openReservationsQty: 25, openSupplyQty: 5,
    }]);
    expect(r[0].gapQty).toBe(10); // 25 − 10 − 5
    expect(r[0].risk).toBe('critical');
  });
});

describe('fixture: forecast accuracy metrics', () => {
  // Actuals [100, 200, 300], predictions [110, 190, 330]:
  // errors −10, +10, −30 · |e| = 10, 10, 30.
  // MAE = 50/3 = 16.6667 · RMSE = √((100+100+900)/3) = √366.667 = 19.1485
  // MAPE = (10/100 + 10/200 + 30/300)/3 ×100 = (0.1+0.05+0.1)/3×100 = 8.3333
  // WAPE = 50/600 ×100 = 8.3333 · bias = −30/3 = −10
  // tracking signal = Σe / MAD = −30 / 16.6667 = −1.8
  it('matches hand-computed MAE/RMSE/MAPE/WAPE/bias/tracking signal', () => {
    const acc = forecastAccuracy([100, 200, 300], [110, 190, 330]);
    expect(acc.mae).toBeCloseTo(16.6667, 3);
    expect(acc.rmse).toBeCloseTo(19.1485, 3);
    expect(acc.mape).toBeCloseTo(8.33, 1);
    expect(acc.wape).toBeCloseTo(8.33, 1);
    expect(acc.bias).toBeCloseTo(-10, 4);
    expect(acc.trackingSignal).toBeCloseTo(-1.8, 2);
  });

  it('zero-only actuals give null MAPE/WAPE, never NaN or Infinity', () => {
    const acc = forecastAccuracy([0, 0], [5, 5]);
    expect(acc.mape).toBeNull();
    expect(acc.wape).toBeNull();
    expect(Number.isFinite(acc.mae)).toBe(true);
  });

  it('croston on all-zero demand forecasts 0, not NaN', () => {
    const f = crostonForecast([0, 0, 0, 0], 3);
    expect(f.forecast).toEqual([0, 0, 0]);
  });

  it('naive on empty series forecasts 0', () => {
    expect(naiveForecast([], 2).forecast).toEqual([0, 0]);
  });
});

describe('fixture: safety stock / ROP / min-max', () => {
  // Monthly demand [300, 330, 270, 300] over 30-day periods, LT 9 days, SL 95%.
  // σ_period = stdDev([300,330,270,300]) = √(Σ(0,30,−30,0)²/3) = √600 = 24.4949
  // σ_daily = 24.4949/√30 = 4.4721… · z(0.95) = 1.6449
  // SS = 1.6449 × 4.4721 × √9 = 22.068
  it('statistical safety stock matches the formula step by step', () => {
    const ss = safetyStock('statistical_service_level', {
      demandSeries: [300, 330, 270, 300], periodDays: 30, leadTimeDays: 9, serviceLevel: 0.95,
    });
    const sigmaDaily = Math.sqrt(600) / Math.sqrt(30);
    const expected = normInv(0.95) * sigmaDaily * Math.sqrt(9);
    expect(ss.safetyStock).toBeCloseTo(expected, 2);
    expect(ss.safetyStock).toBeCloseTo(22.07, 1);
  });

  // Daily demand 10, LT 9, SS 22.07 → ROP = 90 + 22.07 = 112.07
  it('ROP = lead-time demand + safety stock', () => {
    const r = reorderPoint(10, 9, 22.07);
    expect(r.leadTimeDemand).toBe(90);
    expect(r.reorderPoint).toBeCloseTo(112.07, 2);
  });

  // Min = 112.07; coverage 30 days → Max = 112.07 + 300 = 412.07; order qty 300.
  it('min/max plan is arithmetically consistent', () => {
    const m = minMaxPlan(10, 9, 22.07, 30);
    expect(m.minStock).toBeCloseTo(112.07, 2);
    expect(m.maxStock).toBeCloseTo(412.07, 2);
    expect(m.orderQuantity).toBeCloseTo(300, 2);
  });

  it('days-of-supply method: SS = avg daily demand × days', () => {
    const ss = safetyStock('days_of_supply', {
      demandSeries: [300, 300], periodDays: 30, leadTimeDays: 5, daysOfSupply: 7,
    });
    expect(ss.safetyStock).toBe(70); // 10/day × 7
  });
});

describe('fixture: inventory health index weighting', () => {
  // All six measurable: 0.25×80 + 0.20×90 + 0.15×100 + 0.15×60 + 0.15×70 + 0.10×95
  // = 20 + 18 + 15 + 9 + 10.5 + 9.5 = 82.
  it('weighted sum matches hand calculation when all components measurable', () => {
    const r = inventoryHealthIndex({
      availability: 80, excess: 90, obsolescence: 100, aging: 60, turnover: 70, dataQuality: 95,
    });
    expect(r.score).toBe(82);
  });

  // Only availability (0.25) and dataQuality (0.10) measurable → renormalised
  // weights 25/35 and 10/35 → 80×(25/35) + 95×(10/35) = 57.142 + 27.142 = 84.3.
  it('renormalisation matches hand calculation', () => {
    const r = inventoryHealthIndex({
      availability: 80, excess: null, obsolescence: null, aging: null, turnover: null, dataQuality: 95,
    });
    expect(r.score).toBeCloseTo(84.3, 1);
  });
});

describe('fixture: movement categories with duplicates and turnover', () => {
  // Stock 100, issued 50 in 365 days → turnover 0.5 < 1 → slow-moving even
  // though the last issue was recent.
  it('low turnover with recent issues is slow-moving, not active', () => {
    const r = movementCategories([{
      material: 'M', stockQty: 100, stockValue: 1000, issuedQty: 50, periodDays: 365, daysSinceLastIssue: 10,
    }]);
    expect(r[0].category).toBe('slow_moving');
    expect(r[0].annualizedTurnover).toBe(0.5);
  });
});
