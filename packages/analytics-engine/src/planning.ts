import { normInv, round, stdDev, mean } from './stats';

/**
 * Safety-stock, reorder-point and min/max planning calculations.
 * All results are recommendations that require user review; formulas and
 * assumptions are returned alongside every number.
 */

export type SafetyStockMethod =
  | 'fixed_quantity'
  | 'days_of_supply'
  | 'max_consumption'
  | 'statistical_service_level'
  | 'demand_and_leadtime_variability';

export interface SafetyStockInput {
  /** Demand history per period (chronological). */
  demandSeries: number[];
  /** Length of one demand period in days (e.g. 30 for monthly). */
  periodDays: number;
  leadTimeDays: number;
  /** Standard deviation of lead time in days (for the variability method). */
  leadTimeStdDevDays?: number;
  serviceLevel?: number;         // e.g. 0.95
  fixedQuantity?: number;
  daysOfSupply?: number;
}

export interface SafetyStockRecommendation {
  method: SafetyStockMethod;
  safetyStock: number;
  formula: string;
  assumptions: string[];
  inputs: Record<string, number>;
}

export function safetyStock(method: SafetyStockMethod, input: SafetyStockInput): SafetyStockRecommendation {
  const dailyDemands = input.demandSeries.map((d) => d / input.periodDays);
  const avgDaily = mean(dailyDemands);
  const sdPeriod = stdDev(input.demandSeries);
  const sdDaily = input.periodDays > 0 ? sdPeriod / Math.sqrt(input.periodDays) : 0;
  const assumptions = [
    `Average daily demand derived from ${input.demandSeries.length} periods of ${input.periodDays} days.`,
  ];

  switch (method) {
    case 'fixed_quantity': {
      const qty = input.fixedQuantity ?? 0;
      return {
        method, safetyStock: round(qty, 3),
        formula: 'SS = fixed quantity (user defined)',
        assumptions: ['User-defined fixed quantity; no statistical basis.'],
        inputs: { fixedQuantity: qty },
      };
    }
    case 'days_of_supply': {
      const days = input.daysOfSupply ?? 0;
      const ss = avgDaily * days;
      return {
        method, safetyStock: round(ss, 3),
        formula: 'SS = average daily demand × days of supply',
        assumptions: [...assumptions, `Coverage of ${days} days at average demand.`],
        inputs: { avgDailyDemand: round(avgDaily, 4), daysOfSupply: days },
      };
    }
    case 'max_consumption': {
      const maxPeriod = input.demandSeries.length ? Math.max(...input.demandSeries) : 0;
      const maxDaily = maxPeriod / input.periodDays;
      const ss = (maxDaily - avgDaily) * input.leadTimeDays;
      return {
        method, safetyStock: round(Math.max(0, ss), 3),
        formula: 'SS = (max daily demand − average daily demand) × lead time',
        assumptions: [...assumptions, 'Covers the historical worst-case demand rate over one lead time.'],
        inputs: { maxDailyDemand: round(maxDaily, 4), avgDailyDemand: round(avgDaily, 4), leadTimeDays: input.leadTimeDays },
      };
    }
    case 'statistical_service_level': {
      const sl = input.serviceLevel ?? 0.95;
      const z = normInv(sl);
      const ss = z * sdDaily * Math.sqrt(input.leadTimeDays);
      return {
        method, safetyStock: round(Math.max(0, ss), 3),
        formula: 'SS = z(service level) × σ_daily_demand × √(lead time)',
        assumptions: [
          ...assumptions,
          `Service level ${round(sl * 100, 1)}% → z = ${round(z, 3)}.`,
          'Demand assumed approximately normal and independent across days.',
        ],
        inputs: { serviceLevel: sl, z: round(z, 4), sigmaDaily: round(sdDaily, 4), leadTimeDays: input.leadTimeDays },
      };
    }
    case 'demand_and_leadtime_variability': {
      const sl = input.serviceLevel ?? 0.95;
      const z = normInv(sl);
      const sdLt = input.leadTimeStdDevDays ?? 0;
      const ss = z * Math.sqrt(
        input.leadTimeDays * sdDaily ** 2 + avgDaily ** 2 * sdLt ** 2,
      );
      return {
        method, safetyStock: round(Math.max(0, ss), 3),
        formula: 'SS = z × √(LT × σ_d² + d̄² × σ_LT²)',
        assumptions: [
          ...assumptions,
          `Service level ${round(sl * 100, 1)}%; lead-time std dev ${sdLt} days.`,
          'Demand and lead time assumed independent.',
        ],
        inputs: {
          serviceLevel: sl, z: round(z, 4), sigmaDaily: round(sdDaily, 4),
          avgDailyDemand: round(avgDaily, 4), leadTimeDays: input.leadTimeDays, sigmaLeadTime: sdLt,
        },
      };
    }
  }
}

export interface ReorderPointResult {
  leadTimeDemand: number;
  safetyStock: number;
  reorderPoint: number;
  formula: string;
}

export function reorderPoint(avgDailyDemand: number, leadTimeDays: number, safetyStockQty: number): ReorderPointResult {
  const ltd = avgDailyDemand * leadTimeDays;
  return {
    leadTimeDemand: round(ltd, 3),
    safetyStock: round(safetyStockQty, 3),
    reorderPoint: round(ltd + safetyStockQty, 3),
    formula: 'ROP = average daily demand × lead time + safety stock',
  };
}

export interface MinMaxResult {
  minStock: number;
  maxStock: number;
  orderQuantity: number;
  coverageTargetDays: number;
  formula: string;
}

export function minMaxPlan(
  avgDailyDemand: number, leadTimeDays: number, safetyStockQty: number, coverageTargetDays: number,
): MinMaxResult {
  const min = avgDailyDemand * leadTimeDays + safetyStockQty;
  const max = min + avgDailyDemand * coverageTargetDays;
  return {
    minStock: round(min, 3),
    maxStock: round(max, 3),
    orderQuantity: round(max - min, 3),
    coverageTargetDays,
    formula: 'Min = daily demand × lead time + SS; Max = Min + daily demand × coverage target',
  };
}
