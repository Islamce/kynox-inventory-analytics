import {
  actualTransitMinutes,
  evaluateDeliveryTimeliness,
  evaluatePickupTimeliness,
  plannedTransitMinutes,
  totalFreightByCurrency,
  transitVarianceMinutes,
  type FreightCharge,
  type ShipmentTiming,
  type TimelinessResult,
} from './index';

export const LOGISTICS_COMPATIBILITY_CONTRACT_VERSION = '1.0.0';
export const LOGISTICS_FORMULA_VERSION = '1.0.0';

export interface CompatibilityTimingOutput {
  contractVersion: string;
  formulaVersion: string;
  pickup: TimelinessResult;
  delivery: TimelinessResult;
  actualTransitMinutes: number | null;
  plannedTransitMinutes: number | null;
  transitVarianceMinutes: number | null;
}

export interface LogisticsCompatibilityAdapter {
  readonly contractVersion: string;
  readonly formulaVersion: string;
  evaluateTiming(input: ShipmentTiming, toleranceMinutes?: number): CompatibilityTimingOutput;
  totalFreightByCurrency(input: FreightCharge[]): Record<string, number>;
}

/**
 * Compatibility boundary only. This adapter delegates to the existing local
 * implementation; it does not own tenants, sessions, storage, deployment, UI,
 * or commercial workflows.
 */
export function createLogisticsCompatibilityAdapter(): LogisticsCompatibilityAdapter {
  return {
    contractVersion: LOGISTICS_COMPATIBILITY_CONTRACT_VERSION,
    formulaVersion: LOGISTICS_FORMULA_VERSION,
    evaluateTiming(input, toleranceMinutes = 0) {
      return {
        contractVersion: LOGISTICS_COMPATIBILITY_CONTRACT_VERSION,
        formulaVersion: LOGISTICS_FORMULA_VERSION,
        pickup: evaluatePickupTimeliness(input, toleranceMinutes),
        delivery: evaluateDeliveryTimeliness(input, toleranceMinutes),
        actualTransitMinutes: actualTransitMinutes(input),
        plannedTransitMinutes: plannedTransitMinutes(input),
        transitVarianceMinutes: transitVarianceMinutes(input),
      };
    },
    totalFreightByCurrency,
  };
}
