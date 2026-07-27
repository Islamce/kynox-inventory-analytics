import type { ExcessResult, ShortageResult } from '@kynox/shared-types';
import { round } from './stats';

export type ExcessMethod =
  | 'above_max_stock'
  | 'above_coverage_target'
  | 'above_safety_plus_leadtime'
  | 'no_demand';

export interface ExcessInput {
  material: string;
  stockQty: number;
  stockValue: number;
  maxStock?: number | null;
  safetyStock?: number | null;
  leadTimeDays?: number | null;
  /** Average daily demand derived from consumption history. */
  avgDailyDemand?: number | null;
  /** Whether any demand/consumption exists in the analysed horizon. */
  hasDemand?: boolean;
}

export interface ExcessOptions {
  /** Coverage target in days of demand for the coverage method. Default 90. */
  coverageTargetDays?: number;
}

/** Unit price derived from the stock line so excess value stays consistent with stock value. */
function unitPrice(item: ExcessInput): number {
  return item.stockQty > 0 ? item.stockValue / item.stockQty : 0;
}

export function excessStock(
  items: ExcessInput[],
  method: ExcessMethod,
  options: ExcessOptions = {},
): ExcessResult[] {
  const coverageDays = options.coverageTargetDays ?? 90;
  const results: ExcessResult[] = [];

  for (const item of items) {
    let referenceQty: number | null = null;

    switch (method) {
      case 'above_max_stock':
        if (item.maxStock != null && item.maxStock > 0) referenceQty = item.maxStock;
        break;
      case 'above_coverage_target':
        if (item.avgDailyDemand != null && item.avgDailyDemand > 0) {
          referenceQty = item.avgDailyDemand * coverageDays;
        }
        break;
      case 'above_safety_plus_leadtime':
        if (item.safetyStock != null && item.avgDailyDemand != null && item.leadTimeDays != null) {
          referenceQty = item.safetyStock + item.avgDailyDemand * item.leadTimeDays;
        }
        break;
      case 'no_demand':
        if (item.hasDemand === false && item.stockQty > 0) referenceQty = 0;
        break;
    }

    if (referenceQty === null) continue; // required inputs missing — analysis not applicable, never guessed
    const excessQty = Math.max(0, item.stockQty - referenceQty);
    if (excessQty <= 0) continue;
    results.push({
      material: item.material,
      method,
      stockQty: item.stockQty,
      stockValue: round(item.stockValue, 2),
      referenceQty: round(referenceQty, 3),
      excessQty: round(excessQty, 3),
      excessValue: round(excessQty * unitPrice(item), 2),
    });
  }
  return results.sort((a, b) => b.excessValue - a.excessValue);
}

export interface ShortageInput {
  material: string;
  stockQty: number;
  availableQty?: number | null;
  safetyStock?: number | null;
  reorderPoint?: number | null;
  openReservationsQty?: number | null;
  openSupplyQty?: number | null;
  avgDailyDemand?: number | null;
  leadTimeDays?: number | null;
}

export function shortageRisks(items: ShortageInput[]): ShortageResult[] {
  const results: ShortageResult[] = [];
  for (const item of items) {
    const available = item.availableQty ?? item.stockQty;

    if (available < 0) {
      results.push({
        material: item.material,
        reason: `Negative available stock (${round(available, 3)}).`,
        stockQty: item.stockQty,
        gapQty: round(-available, 3),
        risk: 'critical',
      });
      continue;
    }

    const uncovered = (item.openReservationsQty ?? 0) - available - (item.openSupplyQty ?? 0);
    if (uncovered > 0) {
      results.push({
        material: item.material,
        reason: `Open reservations exceed available stock plus open supply by ${round(uncovered, 3)}.`,
        stockQty: item.stockQty,
        gapQty: round(uncovered, 3),
        risk: 'critical',
      });
      continue;
    }

    if (item.safetyStock != null && item.safetyStock > 0 && available < item.safetyStock) {
      const projectedStockoutDays = item.avgDailyDemand && item.avgDailyDemand > 0
        ? Math.floor(available / item.avgDailyDemand)
        : null;
      results.push({
        material: item.material,
        reason: projectedStockoutDays !== null
          ? `Stock below safety stock; projected stockout in ~${projectedStockoutDays} days at average demand.`
          : 'Stock below safety stock.',
        stockQty: item.stockQty,
        safetyStock: item.safetyStock,
        gapQty: round(item.safetyStock - available, 3),
        risk: available === 0 ? 'critical' : 'high',
      });
      continue;
    }

    if (item.reorderPoint != null && item.reorderPoint > 0 && available < item.reorderPoint
        && (item.openSupplyQty ?? 0) === 0) {
      results.push({
        material: item.material,
        reason: 'Stock below reorder point with no open supply.',
        stockQty: item.stockQty,
        reorderPoint: item.reorderPoint,
        gapQty: round(item.reorderPoint - available, 3),
        risk: 'medium',
      });
    }
  }
  return results.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2 };
    return order[a.risk] - order[b.risk] || b.gapQty - a.gapQty;
  });
}
