export type Timestamp = string;

export interface ShipmentTiming {
  plannedPickupAt?: Timestamp | null;
  actualPickupAt?: Timestamp | null;
  plannedDeliveryAt?: Timestamp | null;
  actualDeliveryAt?: Timestamp | null;
}

export interface TimelinessResult {
  evaluable: boolean;
  onTime: boolean | null;
  varianceMinutes: number | null;
}

export interface FreightCharge {
  amount: number;
  currency: string;
  chargeType?: string | null;
}

function toMillis(value: Timestamp): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`Invalid timestamp: ${value}`);
  return ms;
}

function timeliness(planned?: Timestamp | null, actual?: Timestamp | null, toleranceMinutes = 0): TimelinessResult {
  if (!planned || !actual) return { evaluable: false, onTime: null, varianceMinutes: null };
  const varianceMinutes = (toMillis(actual) - toMillis(planned)) / 60000;
  return {
    evaluable: true,
    onTime: varianceMinutes <= toleranceMinutes,
    varianceMinutes,
  };
}

export function evaluatePickupTimeliness(timing: ShipmentTiming, toleranceMinutes = 0): TimelinessResult {
  return timeliness(timing.plannedPickupAt, timing.actualPickupAt, toleranceMinutes);
}

export function evaluateDeliveryTimeliness(timing: ShipmentTiming, toleranceMinutes = 0): TimelinessResult {
  return timeliness(timing.plannedDeliveryAt, timing.actualDeliveryAt, toleranceMinutes);
}

export function actualTransitMinutes(timing: ShipmentTiming): number | null {
  if (!timing.actualPickupAt || !timing.actualDeliveryAt) return null;
  const value = (toMillis(timing.actualDeliveryAt) - toMillis(timing.actualPickupAt)) / 60000;
  if (value < 0) throw new Error('Actual delivery cannot precede actual pickup');
  return value;
}

export function plannedTransitMinutes(timing: ShipmentTiming): number | null {
  if (!timing.plannedPickupAt || !timing.plannedDeliveryAt) return null;
  const value = (toMillis(timing.plannedDeliveryAt) - toMillis(timing.plannedPickupAt)) / 60000;
  if (value < 0) throw new Error('Planned delivery cannot precede planned pickup');
  return value;
}

export function transitVarianceMinutes(timing: ShipmentTiming): number | null {
  const actual = actualTransitMinutes(timing);
  const planned = plannedTransitMinutes(timing);
  return actual === null || planned === null ? null : actual - planned;
}

export function totalFreightByCurrency(charges: FreightCharge[]): Record<string, number> {
  return charges.reduce<Record<string, number>>((totals, charge) => {
    if (!charge.currency?.trim()) throw new Error('Freight charge currency is required');
    if (!Number.isFinite(charge.amount)) throw new Error('Freight charge amount must be finite');
    const currency = charge.currency.trim().toUpperCase();
    totals[currency] = (totals[currency] ?? 0) + charge.amount;
    return totals;
  }, {});
}

export interface MaterialAvailabilityRiskInput {
  requiredDate: Timestamp;
  requiredQuantity: number;
  availableQuantity: number;
  confirmedInboundQuantity: number;
  inboundEta?: Timestamp | null;
}

export interface MaterialAvailabilityRisk {
  scheduleGapDays: number;
  quantityGap: number;
  atRisk: boolean;
}

export function evaluateMaterialAvailabilityRisk(input: MaterialAvailabilityRiskInput): MaterialAvailabilityRisk {
  const quantities = [input.requiredQuantity, input.availableQuantity, input.confirmedInboundQuantity];
  if (quantities.some((quantity) => !Number.isFinite(quantity) || quantity < 0)) {
    throw new Error('Material availability quantities must be finite and non-negative');
  }

  const quantityGap = Math.max(
    0,
    input.requiredQuantity - input.availableQuantity - input.confirmedInboundQuantity,
  );
  const inboundNeeded = input.availableQuantity < input.requiredQuantity && input.confirmedInboundQuantity > 0;
  const scheduleGapDays = inboundNeeded && input.inboundEta
    ? Math.max(0, Math.ceil((toMillis(input.inboundEta) - toMillis(input.requiredDate)) / 86400000))
    : 0;
  return {
    scheduleGapDays,
    quantityGap,
    atRisk: scheduleGapDays > 0 || quantityGap > 0,
  };
}

export * from './spend';
export * from './carrier-performance';
export * from './risk';
