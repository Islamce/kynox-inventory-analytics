import type { XyzResult, XyzClass } from '@kynox/shared-types';
import { coefficientOfVariation, mean, round, stdDev } from './stats';

export interface XyzOptions {
  /** CoV upper bound for class X. Default 0.5. */
  xMaxCov?: number;
  /** CoV upper bound for class Y. Default 1.0. */
  yMaxCov?: number;
  /** Share of zero-demand periods above which demand counts as intermittent. Default 0.4. */
  intermittencyThreshold?: number;
  /** Minimum number of periods required for a meaningful classification. Default 4. */
  minPeriods?: number;
}

export interface XyzInput {
  material: string;
  /** Demand/consumption per period (chronological, zero-filled for empty periods). */
  series: number[];
}

/**
 * XYZ classification of demand variability using the coefficient of variation
 * plus intermittency handling. Safe on zero-mean and sparse series.
 */
export function xyzClassify(items: XyzInput[], options: XyzOptions = {}): XyzResult[] {
  const xMax = options.xMaxCov ?? 0.5;
  const yMax = options.yMaxCov ?? 1.0;
  const intTh = options.intermittencyThreshold ?? 0.4;
  const minPeriods = options.minPeriods ?? 4;

  return items.map(({ material, series }) => {
    const m = mean(series);
    const sd = stdDev(series);
    const cov = coefficientOfVariation(series);
    const zeroShare = series.length === 0
      ? 1
      : series.filter((v) => v === 0).length / series.length;
    const intermittent = zeroShare >= intTh;

    let xyzClass: XyzClass;
    let reason: string;

    if (series.length < minPeriods) {
      xyzClass = 'Z';
      reason = `Only ${series.length} period(s) of history (< ${minPeriods} required); treated as unpredictable.`;
    } else if (m === 0) {
      xyzClass = 'Z';
      reason = 'No demand in the analysed horizon (zero mean); unpredictable.';
    } else if (intermittent) {
      xyzClass = 'Z';
      reason = `Intermittent demand: ${round(zeroShare * 100, 1)}% of periods had zero demand (threshold ${round(intTh * 100, 0)}%).`;
    } else if (cov !== null && cov <= xMax) {
      xyzClass = 'X';
      reason = `Stable demand: coefficient of variation ${round(cov, 2)} ≤ ${xMax}.`;
    } else if (cov !== null && cov <= yMax) {
      xyzClass = 'Y';
      reason = `Moderate variability: coefficient of variation ${round(cov, 2)} between ${xMax} and ${yMax}.`;
    } else {
      xyzClass = 'Z';
      reason = `High variability: coefficient of variation ${cov === null ? 'undefined' : round(cov, 2)} > ${yMax}.`;
    }

    return {
      material,
      mean: round(m, 4),
      stdDev: round(sd, 4),
      cov: cov === null ? null : round(cov, 4),
      zeroPeriodShare: round(zeroShare, 4),
      intermittent,
      xyzClass,
      reason,
    };
  });
}

// ---------------------------------------------------------------------------
// ABC-XYZ matrix
// ---------------------------------------------------------------------------

export interface MatrixCell {
  segment: string;              // e.g. "AX"
  materials: string[];
  materialCount: number;
  recommendedPolicy: string;
}

const MATRIX_POLICIES: Record<string, string> = {
  AX: 'High value, stable demand: tight control, frequent review, statistical safety stock at high service level, frequent cycle counts.',
  AY: 'High value, variable demand: close monitoring, enhanced forecasting with trend/seasonality, buffer via safety stock, monthly review.',
  AZ: 'High value, unpredictable demand: management attention, scenario planning, order-driven supply where possible, manual review of every replenishment.',
  BX: 'Medium value, stable demand: automated replenishment, standard service level, periodic review.',
  BY: 'Medium value, variable demand: semi-automated planning with exception alerts, moderate safety stock.',
  BZ: 'Medium value, unpredictable demand: min/max control with periodic manual review, conservative commitments.',
  CX: 'Low value, stable demand: simple automatic replenishment (kanban / two-bin), infrequent review, bulk orders.',
  CY: 'Low value, variable demand: min/max policy with generous max, low review frequency.',
  CZ: 'Low value, unpredictable demand: simplified control, make/buy-to-order where applicable, consider delisting.',
};

export function abcXyzMatrix(
  abc: { material: string; abcClass: string }[],
  xyz: { material: string; xyzClass: string }[],
): MatrixCell[] {
  const xyzByMaterial = new Map(xyz.map((x) => [x.material, x.xyzClass]));
  const cells = new Map<string, string[]>();
  for (const a of ['A', 'B', 'C']) {
    for (const x of ['X', 'Y', 'Z']) {
      cells.set(`${a}${x}`, []);
    }
  }
  for (const item of abc) {
    const xyzClass = xyzByMaterial.get(item.material) ?? 'Z';
    const segment = `${item.abcClass}${xyzClass}`;
    cells.get(segment)?.push(item.material);
  }
  return [...cells.entries()].map(([segment, materials]) => ({
    segment,
    materials,
    materialCount: materials.length,
    recommendedPolicy: MATRIX_POLICIES[segment] ?? '',
  }));
}
