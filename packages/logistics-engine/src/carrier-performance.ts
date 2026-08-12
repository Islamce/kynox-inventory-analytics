import {
  evaluateDeliveryTimeliness,
  evaluatePickupTimeliness,
  transitVarianceMinutes,
} from './index';

export interface CarrierShipmentEvidence {
  sourceRecordId: string;
  shipmentId: string;
  carrierCode: string;
  plannedPickupAt?: string | null;
  actualPickupAt?: string | null;
  plannedDeliveryAt?: string | null;
  actualDeliveryAt?: string | null;
  requiredQuantity?: number | null;
  deliveredQuantity?: number | null;
  claimOrDamage?: boolean | null;
  cancelled?: boolean | null;
  failedDelivery?: boolean | null;
}

export interface CarrierMetric {
  key: 'otp' | 'otd' | 'otif' | 'transit_variance' | 'claim_damage_rate' | 'cancellation_rate' | 'failed_delivery_rate';
  label: string;
  value: number | null;
  unit: 'ratio' | 'minutes';
  numerator: number;
  denominator: number;
  excludedRecords: string[];
  includedRecords: string[];
  dateWindow: { start: string; end: string };
  toleranceMinutes: number | null;
  assumptions: string[];
}

export interface CarrierPerformanceResult {
  carrierCode: string;
  metrics: CarrierMetric[];
}

export interface CarrierPerformanceOptions {
  dateWindow: { start: string; end: string };
  pickupToleranceMinutes?: number;
  deliveryToleranceMinutes?: number;
}

function observedDate(row: CarrierShipmentEvidence): string | null {
  return row.actualDeliveryAt ?? row.plannedDeliveryAt ?? row.actualPickupAt ?? row.plannedPickupAt ?? null;
}

function ratioMetric(
  key: CarrierMetric['key'], label: string, rows: CarrierShipmentEvidence[],
  eligible: (row: CarrierShipmentEvidence) => boolean,
  passed: (row: CarrierShipmentEvidence) => boolean,
  options: CarrierPerformanceOptions, toleranceMinutes: number | null, assumptions: string[],
): CarrierMetric {
  const included = rows.filter(eligible);
  const numerator = included.filter(passed).length;
  return {
    key, label, value: included.length ? numerator / included.length : null, unit: 'ratio',
    numerator, denominator: included.length,
    excludedRecords: rows.filter((row) => !eligible(row)).map((row) => row.sourceRecordId),
    includedRecords: included.map((row) => row.sourceRecordId),
    dateWindow: options.dateWindow, toleranceMinutes, assumptions,
  };
}

export function evaluateCarrierPerformance(
  allRows: CarrierShipmentEvidence[], options: CarrierPerformanceOptions,
): CarrierPerformanceResult[] {
  const pickupToleranceMinutes = options.pickupToleranceMinutes ?? 0;
  const deliveryToleranceMinutes = options.deliveryToleranceMinutes ?? 0;
  if (pickupToleranceMinutes < 0 || deliveryToleranceMinutes < 0) throw new Error('Tolerance must be non-negative');
  const start = Date.parse(options.dateWindow.start);
  const end = Date.parse(options.dateWindow.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('A valid date window is required');

  const windowRows = allRows.filter((row) => {
    const date = observedDate(row);
    if (!date) return false;
    const value = Date.parse(date);
    return Number.isFinite(value) && value >= start && value <= end;
  });
  const carrierCodes = [...new Set(allRows.map((row) => row.carrierCode.trim()).filter(Boolean))].sort();

  return carrierCodes.map((carrierCode) => {
    const sourceRows = allRows.filter((row) => row.carrierCode.trim() === carrierCode);
    const rows = windowRows.filter((row) => row.carrierCode.trim() === carrierCode);
    const outsideWindow = sourceRows.filter((row) => !rows.includes(row)).map((row) => row.sourceRecordId);
    const metrics: CarrierMetric[] = [];
    const otp = ratioMetric('otp', 'On-Time Pickup', rows,
      (row) => !!row.plannedPickupAt && !!row.actualPickupAt,
      (row) => evaluatePickupTimeliness(row, pickupToleranceMinutes).onTime === true,
      options, pickupToleranceMinutes, ['OTP requires both planned and actual pickup timestamps.']);
    const otd = ratioMetric('otd', 'On-Time Delivery', rows,
      (row) => !!row.plannedDeliveryAt && !!row.actualDeliveryAt,
      (row) => evaluateDeliveryTimeliness(row, deliveryToleranceMinutes).onTime === true,
      options, deliveryToleranceMinutes, ['OTD requires both planned and actual delivery timestamps.']);
    const otif = ratioMetric('otif', 'On-Time In-Full', rows,
      (row) => !!row.plannedDeliveryAt && !!row.actualDeliveryAt
        && row.requiredQuantity != null && row.deliveredQuantity != null,
      (row) => evaluateDeliveryTimeliness(row, deliveryToleranceMinutes).onTime === true
        && row.deliveredQuantity! >= row.requiredQuantity!,
      options, deliveryToleranceMinutes, ['OTIF requires delivery timing and explicit required/delivered quantity evidence; OTD alone is never treated as OTIF.']);
    for (const metric of [otp, otd, otif]) {
      metric.excludedRecords = [...outsideWindow, ...metric.excludedRecords];
      metrics.push(metric);
    }

    const transitRows = rows.map((row) => ({ row, variance: transitVarianceMinutes(row) }))
      .filter((item): item is { row: CarrierShipmentEvidence; variance: number } => item.variance !== null);
    const varianceSum = transitRows.reduce((sum, item) => sum + item.variance, 0);
    metrics.push({
      key: 'transit_variance', label: 'Average Transit Variance',
      value: transitRows.length ? varianceSum / transitRows.length : null, unit: 'minutes',
      numerator: varianceSum, denominator: transitRows.length,
      excludedRecords: [...outsideWindow, ...rows.filter((row) => !transitRows.some((item) => item.row === row)).map((row) => row.sourceRecordId)],
      includedRecords: transitRows.map((item) => item.row.sourceRecordId),
      dateWindow: options.dateWindow, toleranceMinutes: null,
      assumptions: ['Transit variance is actual transit minutes minus planned transit minutes.'],
    });

    const eventMetrics: [CarrierMetric['key'], string, keyof CarrierShipmentEvidence][] = [
      ['claim_damage_rate', 'Claim / Damage Rate', 'claimOrDamage'],
      ['cancellation_rate', 'Cancellation Rate', 'cancelled'],
      ['failed_delivery_rate', 'Failed Delivery Rate', 'failedDelivery'],
    ];
    for (const [key, label, field] of eventMetrics) {
      const metric = ratioMetric(key, label, rows,
        (row) => typeof row[field] === 'boolean', (row) => row[field] === true,
        options, null, [`${label} includes only records with explicit true/false evidence.`]);
      metric.excludedRecords = [...outsideWindow, ...metric.excludedRecords];
      metrics.push(metric);
    }
    return { carrierCode, metrics };
  });
}

export interface CarrierScoreComponent {
  metricKey: CarrierMetric['key'];
  normalizedValue: number;
  weight: number;
  contribution: number;
}

export function scoreCarrierPerformance(
  result: CarrierPerformanceResult,
  weights: Partial<Record<CarrierMetric['key'], number>>,
): { score: number; components: CarrierScoreComponent[] } {
  const components: CarrierScoreComponent[] = [];
  for (const metric of result.metrics) {
    const weight = weights[metric.key] ?? 0;
    if (weight <= 0 || metric.value === null || metric.unit !== 'ratio') continue;
    const adverse = new Set<CarrierMetric['key']>(['claim_damage_rate', 'cancellation_rate', 'failed_delivery_rate']);
    const normalizedValue = adverse.has(metric.key) ? 1 - metric.value : metric.value;
    components.push({ metricKey: metric.key, normalizedValue, weight, contribution: normalizedValue * weight });
  }
  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) throw new Error('At least one evaluable ratio metric must have a positive weight');
  return { score: components.reduce((sum, item) => sum + item.contribution, 0) / totalWeight, components };
}
