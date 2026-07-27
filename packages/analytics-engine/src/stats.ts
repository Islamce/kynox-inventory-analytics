/** Basic statistics helpers shared by the analytical modules. */

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Sample standard deviation (n-1); population when n === 1 returns 0. */
export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1);
  return Math.sqrt(variance);
}

export function meanAbsoluteDeviation(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return mean(xs.map((x) => Math.abs(x - m)));
}

/** Coefficient of variation. Returns null when the mean is zero (undefined CoV). */
export function coefficientOfVariation(xs: number[]): number | null {
  const m = mean(xs);
  if (m === 0) return null;
  return stdDev(xs) / Math.abs(m);
}

export function round(x: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round((x + Number.EPSILON) * f) / f;
}

/** Linear regression slope over an evenly spaced series. */
export function trendSlope(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (xs[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Inverse of the standard normal CDF (Acklam's rational approximation).
 * Used to convert a service level (e.g. 0.95) into a z-factor for safety stock.
 */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) {
    throw new Error(`normInv requires 0 < p < 1, got ${p}`);
  }
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969,
    138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887,
    66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184,
    -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143,
    3.75440866190742];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}
