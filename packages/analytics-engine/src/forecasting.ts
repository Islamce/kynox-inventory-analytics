import type { ForecastResult, ForecastAccuracy, ForecastComparison } from '@kynox/shared-types';
import { mean, round } from './stats';

/**
 * Transparent forecasting methods. Every method returns its fitted values
 * (one-step-ahead in-sample predictions) so accuracy can be measured, plus
 * the h-step-ahead forecast and the parameters used.
 */

export function naiveForecast(series: number[], horizon: number): ForecastResult {
  const fitted = series.map((_, i) => (i === 0 ? null : series[i - 1]));
  const last = series.length ? series[series.length - 1] : 0;
  return { method: 'naive', forecast: Array(horizon).fill(last), fitted, params: {} };
}

export function seasonalNaiveForecast(series: number[], horizon: number, seasonLength = 12): ForecastResult {
  const fitted = series.map((_, i) => (i < seasonLength ? null : series[i - seasonLength]));
  const forecast: number[] = [];
  for (let h = 0; h < horizon; h++) {
    const idx = series.length - seasonLength + (h % seasonLength);
    forecast.push(idx >= 0 && idx < series.length ? series[idx] : (series.length ? series[series.length - 1] : 0));
  }
  return { method: 'seasonal_naive', forecast, fitted, params: { seasonLength } };
}

export function movingAverageForecast(series: number[], horizon: number, window = 3): ForecastResult {
  const w = Math.min(window, Math.max(1, series.length));
  const fitted = series.map((_, i) => {
    if (i < w) return null;
    return mean(series.slice(i - w, i));
  });
  const last = series.length >= 1 ? mean(series.slice(-w)) : 0;
  return { method: 'moving_average', forecast: Array(horizon).fill(round(last, 4)), fitted, params: { window: w } };
}

export function weightedMovingAverageForecast(series: number[], horizon: number, weights = [0.5, 0.3, 0.2]): ForecastResult {
  const w = weights.length;
  const norm = weights.reduce((a, b) => a + b, 0);
  const predictAt = (endExclusive: number): number | null => {
    if (endExclusive < w) return null;
    let acc = 0;
    for (let k = 0; k < w; k++) acc += weights[k] * series[endExclusive - 1 - k];
    return acc / norm;
  };
  const fitted = series.map((_, i) => predictAt(i));
  const point = predictAt(series.length);
  const last = point ?? (series.length ? mean(series) : 0);
  return { method: 'weighted_moving_average', forecast: Array(horizon).fill(round(last, 4)), fitted, params: { window: w } };
}

export function exponentialSmoothingForecast(series: number[], horizon: number, alpha = 0.3): ForecastResult {
  if (series.length === 0) return { method: 'exponential_smoothing', forecast: Array(horizon).fill(0), fitted: [], params: { alpha } };
  const fitted: (number | null)[] = [null];
  let level = series[0];
  for (let i = 1; i < series.length; i++) {
    fitted.push(level);
    level = alpha * series[i] + (1 - alpha) * level;
  }
  return { method: 'exponential_smoothing', forecast: Array(horizon).fill(round(level, 4)), fitted, params: { alpha } };
}

export function holtForecast(series: number[], horizon: number, alpha = 0.3, beta = 0.1): ForecastResult {
  if (series.length < 2) return naiveForecast(series, horizon);
  const fitted: (number | null)[] = [null, null];
  let level = series[0];
  let trend = series[1] - series[0];
  for (let i = 1; i < series.length; i++) {
    if (i >= 2) fitted.push(level + trend);
    const prevLevel = level;
    level = alpha * series[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  const forecast = Array.from({ length: horizon }, (_, h) => round(level + (h + 1) * trend, 4));
  return { method: 'holt', forecast, fitted, params: { alpha, beta } };
}

export function holtWintersForecast(
  series: number[], horizon: number, seasonLength = 12,
  alpha = 0.3, beta = 0.05, gamma = 0.2,
): ForecastResult {
  // Requires at least two full seasons; caller should gate on this.
  if (series.length < seasonLength * 2) return holtForecast(series, horizon, alpha, beta);
  // Initial components from the first two seasons (additive seasonality).
  const season1Mean = mean(series.slice(0, seasonLength));
  const season2Mean = mean(series.slice(seasonLength, seasonLength * 2));
  let level = season1Mean;
  let trend = (season2Mean - season1Mean) / seasonLength;
  const seasonal = series.slice(0, seasonLength).map((v) => v - season1Mean);

  const fitted: (number | null)[] = Array(seasonLength).fill(null);
  for (let i = seasonLength; i < series.length; i++) {
    const sIdx = i % seasonLength;
    fitted.push(level + trend + seasonal[sIdx]);
    const prevLevel = level;
    level = alpha * (series[i] - seasonal[sIdx]) + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    seasonal[sIdx] = gamma * (series[i] - level) + (1 - gamma) * seasonal[sIdx];
  }
  const forecast = Array.from({ length: horizon }, (_, h) =>
    round(level + (h + 1) * trend + seasonal[(series.length + h) % seasonLength], 4));
  return { method: 'holt_winters', forecast, fitted, params: { seasonLength, alpha, beta, gamma } };
}

/** Croston's method for intermittent demand (with SBA bias correction variant). */
export function crostonForecast(series: number[], horizon: number, alpha = 0.1, sba = false): ForecastResult {
  const fitted: (number | null)[] = [];
  let demandLevel: number | null = null;   // smoothed demand size
  let intervalLevel: number | null = null; // smoothed inter-demand interval
  let periodsSinceDemand = 0;

  for (let i = 0; i < series.length; i++) {
    fitted.push(demandLevel !== null && intervalLevel !== null && intervalLevel > 0
      ? (sba ? (1 - alpha / 2) : 1) * (demandLevel / intervalLevel)
      : null);
    periodsSinceDemand += 1;
    if (series[i] > 0) {
      demandLevel = demandLevel === null ? series[i] : alpha * series[i] + (1 - alpha) * demandLevel;
      intervalLevel = intervalLevel === null ? periodsSinceDemand : alpha * periodsSinceDemand + (1 - alpha) * intervalLevel;
      periodsSinceDemand = 0;
    }
  }
  const rate = demandLevel !== null && intervalLevel !== null && intervalLevel > 0
    ? (sba ? (1 - alpha / 2) : 1) * (demandLevel / intervalLevel)
    : 0;
  return {
    method: sba ? 'croston_sba' : 'croston',
    forecast: Array(horizon).fill(round(rate, 4)),
    fitted,
    params: { alpha },
  };
}

export function linearTrendForecast(series: number[], horizon: number): ForecastResult {
  const n = series.length;
  if (n < 2) return naiveForecast(series, horizon);
  const xMean = (n - 1) / 2;
  const yMean = mean(series);
  let num = 0; let den = 0;
  for (let i = 0; i < n; i++) { num += (i - xMean) * (series[i] - yMean); den += (i - xMean) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  const fitted = series.map((_, i) => (i === 0 ? null : intercept + slope * i));
  const forecast = Array.from({ length: horizon }, (_, h) => round(intercept + slope * (n + h), 4));
  return { method: 'linear_trend', forecast, fitted, params: { slope: round(slope, 6), intercept: round(intercept, 6) } };
}

// ---------------------------------------------------------------------------
// Accuracy metrics — all zero-demand safe
// ---------------------------------------------------------------------------

export function forecastAccuracy(actuals: number[], predictions: (number | null)[]): ForecastAccuracy {
  const pairs: { a: number; p: number }[] = [];
  for (let i = 0; i < Math.min(actuals.length, predictions.length); i++) {
    const p = predictions[i];
    if (p !== null && Number.isFinite(p)) pairs.push({ a: actuals[i], p });
  }
  if (pairs.length === 0) {
    return { mae: NaN, rmse: NaN, mape: null, wape: null, bias: NaN, mad: NaN, trackingSignal: null };
  }
  const errors = pairs.map(({ a, p }) => a - p);
  const absErrors = errors.map(Math.abs);
  const mae = mean(absErrors);
  const rmse = Math.sqrt(mean(errors.map((e) => e * e)));
  const nonZero = pairs.filter(({ a }) => a !== 0);
  const mape = nonZero.length === 0 ? null
    : mean(nonZero.map(({ a, p }) => Math.abs((a - p) / a))) * 100;
  const actualSum = pairs.reduce((acc, { a }) => acc + Math.abs(a), 0);
  const wape = actualSum === 0 ? null : (absErrors.reduce((x, y) => x + y, 0) / actualSum) * 100;
  const bias = mean(errors);
  const mad = mae;
  const trackingSignal = mad === 0 ? null : errors.reduce((x, y) => x + y, 0) / mad;
  return {
    mae: round(mae, 4),
    rmse: round(rmse, 4),
    mape: mape === null ? null : round(mape, 2),
    wape: wape === null ? null : round(wape, 2),
    bias: round(bias, 4),
    mad: round(mad, 4),
    trackingSignal: trackingSignal === null ? null : round(trackingSignal, 3),
  };
}

// ---------------------------------------------------------------------------
// Method selection via holdout back-test
// ---------------------------------------------------------------------------

export interface MethodSelectionResult {
  comparisons: ForecastComparison[];
  best: string | null;
  insufficientData: boolean;
  note: string;
  forecast: ForecastResult | null;
}

const MIN_HISTORY = 6;

/**
 * Back-tests candidate methods on a holdout (last 20%, min 2 periods) and
 * recommends the method with the lowest WAPE (falling back to MAE).
 * Refuses to fit anything on insufficient history.
 */
export function selectBestForecast(series: number[], horizon: number, seasonLength = 12): MethodSelectionResult {
  if (series.length < MIN_HISTORY) {
    return {
      comparisons: [],
      best: null,
      insufficientData: true,
      note: `Only ${series.length} period(s) of history. At least ${MIN_HISTORY} are required to fit and back-test a model.`,
      forecast: null,
    };
  }
  const holdout = Math.max(2, Math.floor(series.length * 0.2));
  const train = series.slice(0, series.length - holdout);
  const test = series.slice(series.length - holdout);
  const zeroShare = series.filter((v) => v === 0).length / series.length;

  const candidates: ((s: number[], h: number) => ForecastResult)[] = [
    (s, h) => naiveForecast(s, h),
    (s, h) => movingAverageForecast(s, h, 3),
    (s, h) => weightedMovingAverageForecast(s, h),
    (s, h) => exponentialSmoothingForecast(s, h),
    (s, h) => holtForecast(s, h),
    (s, h) => linearTrendForecast(s, h),
  ];
  if (series.length >= seasonLength * 2) {
    candidates.push((s, h) => seasonalNaiveForecast(s, h, seasonLength));
    candidates.push((s, h) => holtWintersForecast(s, h, seasonLength));
  }
  if (zeroShare >= 0.3) {
    candidates.push((s, h) => crostonForecast(s, h));
    candidates.push((s, h) => crostonForecast(s, h, 0.1, true));
  }

  const comparisons: ForecastComparison[] = [];
  for (const make of candidates) {
    const model = make(train, holdout);
    const accuracy = forecastAccuracy(test, model.forecast.slice(0, holdout));
    comparisons.push({ method: model.method, accuracy, recommended: false });
  }

  const scored = comparisons.filter((c) => Number.isFinite(c.accuracy.mae));
  scored.sort((a, b) => {
    const aw = a.accuracy.wape ?? Infinity;
    const bw = b.accuracy.wape ?? Infinity;
    if (aw !== bw) return aw - bw;
    return a.accuracy.mae - b.accuracy.mae;
  });
  const best = scored[0]?.method ?? null;
  for (const c of comparisons) c.recommended = c.method === best;

  let finalForecast: ForecastResult | null = null;
  if (best) {
    const rebuild: Record<string, () => ForecastResult> = {
      naive: () => naiveForecast(series, horizon),
      seasonal_naive: () => seasonalNaiveForecast(series, horizon, seasonLength),
      moving_average: () => movingAverageForecast(series, horizon, 3),
      weighted_moving_average: () => weightedMovingAverageForecast(series, horizon),
      exponential_smoothing: () => exponentialSmoothingForecast(series, horizon),
      holt: () => holtForecast(series, horizon),
      holt_winters: () => holtWintersForecast(series, horizon, seasonLength),
      croston: () => crostonForecast(series, horizon),
      croston_sba: () => crostonForecast(series, horizon, 0.1, true),
      linear_trend: () => linearTrendForecast(series, horizon),
    };
    finalForecast = rebuild[best]?.() ?? null;
  }

  return {
    comparisons,
    best,
    insufficientData: false,
    note: best
      ? `Selected '${best}' by lowest WAPE on a ${holdout}-period holdout back-test.`
      : 'No method produced a finite accuracy score on the holdout.',
    forecast: finalForecast,
  };
}
