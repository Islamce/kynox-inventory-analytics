import { describe, expect, it } from 'vitest';
import {
  actualTransitMinutes,
  evaluateDeliveryTimeliness,
  evaluateMaterialAvailabilityRisk,
  evaluatePickupTimeliness,
  totalFreightByCurrency,
  transitVarianceMinutes,
} from './index';

describe('logistics metric primitives', () => {
  it('evaluates pickup and delivery timeliness independently', () => {
    const timing = {
      plannedPickupAt: '2026-08-01T08:00:00Z',
      actualPickupAt: '2026-08-01T08:20:00Z',
      plannedDeliveryAt: '2026-08-02T08:00:00Z',
      actualDeliveryAt: '2026-08-02T09:00:00Z',
    };
    expect(evaluatePickupTimeliness(timing, 30).onTime).toBe(true);
    expect(evaluateDeliveryTimeliness(timing, 30).onTime).toBe(false);
  });

  it('does not silently evaluate missing timestamps', () => {
    expect(evaluateDeliveryTimeliness({ plannedDeliveryAt: '2026-08-02T08:00:00Z' })).toEqual({
      evaluable: false,
      onTime: null,
      varianceMinutes: null,
    });
  });

  it('calculates transit and variance using actual versus planned windows', () => {
    const timing = {
      plannedPickupAt: '2026-08-01T08:00:00Z',
      actualPickupAt: '2026-08-01T08:00:00Z',
      plannedDeliveryAt: '2026-08-02T08:00:00Z',
      actualDeliveryAt: '2026-08-02T10:00:00Z',
    };
    expect(actualTransitMinutes(timing)).toBe(1560);
    expect(transitVarianceMinutes(timing)).toBe(120);
  });

  it('keeps freight totals separated by currency', () => {
    expect(totalFreightByCurrency([
      { amount: 100, currency: 'SAR' },
      { amount: 50, currency: 'sar' },
      { amount: 20, currency: 'USD' },
    ])).toEqual({ SAR: 150, USD: 20 });
  });

  it('flags material risk only when lateness and uncovered quantity coexist', () => {
    expect(evaluateMaterialAvailabilityRisk({
      requiredDate: '2026-08-10T00:00:00Z',
      expectedAvailabilityDate: '2026-08-13T00:00:00Z',
      requiredQuantity: 100,
      availableOnTimeQuantity: 25,
    })).toEqual({ scheduleGapDays: 3, quantityGap: 75, atRisk: true });

    expect(evaluateMaterialAvailabilityRisk({
      requiredDate: '2026-08-10T00:00:00Z',
      expectedAvailabilityDate: '2026-08-13T00:00:00Z',
      requiredQuantity: 100,
      availableOnTimeQuantity: 100,
    }).atRisk).toBe(false);
  });
});
