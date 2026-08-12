import { describe, expect, it } from 'vitest';
import { evaluateCarrierPerformance, scoreCarrierPerformance } from './carrier-performance';

describe('Carrier Performance Intelligence', () => {
  const rows = [
    { sourceRecordId: 'r1', shipmentId: 'S1', carrierCode: 'C1', plannedPickupAt: '2026-08-10T10:00:00Z', actualPickupAt: '2026-08-10T10:15:00Z', plannedDeliveryAt: '2026-08-11T10:00:00Z', actualDeliveryAt: '2026-08-11T10:20:00Z', requiredQuantity: 10, deliveredQuantity: 10, claimOrDamage: false, cancelled: false, failedDelivery: false },
    { sourceRecordId: 'r2', shipmentId: 'S2', carrierCode: 'C1', plannedPickupAt: '2026-08-10T10:00:00Z', actualPickupAt: '2026-08-10T10:45:00Z', plannedDeliveryAt: '2026-08-11T10:00:00Z', actualDeliveryAt: '2026-08-12T10:00:00Z', requiredQuantity: 10, deliveredQuantity: 8, claimOrDamage: true, cancelled: false, failedDelivery: true },
    { sourceRecordId: 'r3', shipmentId: 'S3', carrierCode: 'C1', plannedDeliveryAt: '2026-08-11T10:00:00Z', actualDeliveryAt: '2026-08-11T10:00:00Z' },
  ];
  const options = { dateWindow: { start: '2026-08-01', end: '2026-08-31' }, pickupToleranceMinutes: 30, deliveryToleranceMinutes: 30 };

  it('keeps OTP, OTD, and evidence-valid OTIF distinct with full counts', () => {
    const result = evaluateCarrierPerformance(rows, options)[0];
    expect(result.metrics.find((metric) => metric.key === 'otp')).toMatchObject({ numerator: 1, denominator: 2, value: 0.5, toleranceMinutes: 30, excludedRecords: ['r3'] });
    expect(result.metrics.find((metric) => metric.key === 'otd')).toMatchObject({ numerator: 2, denominator: 3, value: 2 / 3 });
    expect(result.metrics.find((metric) => metric.key === 'otif')).toMatchObject({ numerator: 1, denominator: 2, value: 0.5, excludedRecords: ['r3'] });
  });

  it('does not invent OTIF when quantity evidence is absent', () => {
    const metric = evaluateCarrierPerformance([rows[2]], options)[0].metrics.find((item) => item.key === 'otif')!;
    expect(metric).toMatchObject({ numerator: 0, denominator: 0, value: null, excludedRecords: ['r3'] });
  });

  it('exposes transit and event-rate evidence', () => {
    const metrics = evaluateCarrierPerformance(rows, options)[0].metrics;
    expect(metrics.find((metric) => metric.key === 'transit_variance')).toMatchObject({ numerator: 1400, denominator: 2, value: 700 });
    expect(metrics.find((metric) => metric.key === 'claim_damage_rate')).toMatchObject({ numerator: 1, denominator: 2, value: 0.5, excludedRecords: ['r3'] });
  });

  it('produces a decomposable score only from caller-supplied weights', () => {
    const result = evaluateCarrierPerformance(rows, options)[0];
    const score = scoreCarrierPerformance(result, { otp: 2, otd: 1, claim_damage_rate: 1 });
    expect(score.components).toHaveLength(3);
    expect(score.score).toBeCloseTo((0.5 * 2 + (2 / 3) + 0.5) / 4);
  });
});
