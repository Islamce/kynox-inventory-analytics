import type { MovementCategory } from '@kynox/shared-types';
import { round } from './stats';

export interface MovementCategoryOptions {
  /** Days without any issue after which a material is non-moving. Default 365. */
  nonMovingDays?: number;
  /** Days without issue after which a material is slow-moving. Default 180. */
  slowMovingDays?: number;
  /** Annual turnover below which a stocked material counts as slow-moving. Default 1. */
  slowTurnoverThreshold?: number;
}

export interface MovementCategoryInput {
  material: string;
  stockQty: number;
  stockValue: number;
  /** Total issued/consumed quantity in the analysed period. */
  issuedQty: number;
  /** Length of the analysed period in days. */
  periodDays: number;
  /** Days since the last issue as of the analysis date; null when unknown. */
  daysSinceLastIssue: number | null;
}

export interface MovementCategoryResult {
  material: string;
  category: MovementCategory;
  annualizedTurnover: number | null;
  daysSinceLastIssue: number | null;
  reason: string;
  stockQty: number;
  stockValue: number;
}

/**
 * Classifies materials into active / slow-moving / non-moving.
 * Slow-moving, non-moving, excess and obsolete are deliberately distinct
 * concepts in this platform; this module only handles movement frequency.
 */
export function movementCategories(
  items: MovementCategoryInput[],
  options: MovementCategoryOptions = {},
): MovementCategoryResult[] {
  const nonMovingDays = options.nonMovingDays ?? 365;
  const slowMovingDays = options.slowMovingDays ?? 180;
  const slowTurnover = options.slowTurnoverThreshold ?? 1;

  return items.map((item) => {
    const avgStock = item.stockQty; // closing stock used as proxy when no opening stock is supplied
    let turnover: number | null = null;
    if (item.periodDays > 0 && avgStock > 0) {
      turnover = (item.issuedQty / avgStock) * (365 / item.periodDays);
    }

    let category: MovementCategory;
    let reason: string;

    if (item.daysSinceLastIssue === null && item.issuedQty === 0) {
      if (item.periodDays >= nonMovingDays) {
        category = 'non_moving';
        reason = `No issues recorded in the ${item.periodDays}-day analysis period (≥ ${nonMovingDays}-day non-moving threshold).`;
      } else {
        category = 'no_movement_data';
        reason = `No issue history available and the analysed period (${item.periodDays} days) is shorter than the non-moving threshold (${nonMovingDays} days).`;
      }
    } else if (item.daysSinceLastIssue !== null && item.daysSinceLastIssue >= nonMovingDays) {
      category = 'non_moving';
      reason = `Last issue ${item.daysSinceLastIssue} days ago (≥ ${nonMovingDays}-day threshold).`;
    } else if (item.daysSinceLastIssue !== null && item.daysSinceLastIssue >= slowMovingDays) {
      category = 'slow_moving';
      reason = `Last issue ${item.daysSinceLastIssue} days ago (≥ ${slowMovingDays}-day slow-moving threshold).`;
    } else if (turnover !== null && turnover < slowTurnover && item.stockQty > 0) {
      category = 'slow_moving';
      reason = `Annualised turnover ${round(turnover, 2)} below the slow-moving threshold of ${slowTurnover}.`;
    } else {
      category = 'active';
      reason = turnover !== null
        ? `Recent issues and annualised turnover ${round(turnover, 2)}.`
        : 'Recent issue activity.';
    }

    return {
      material: item.material,
      category,
      annualizedTurnover: turnover === null ? null : round(turnover, 3),
      daysSinceLastIssue: item.daysSinceLastIssue,
      reason,
      stockQty: item.stockQty,
      stockValue: round(item.stockValue, 2),
    };
  });
}
